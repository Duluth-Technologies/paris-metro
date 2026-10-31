#!/usr/bin/env python3
"""Compute 5/10-minute walking street segments from transit access points.

Uses an OSM PBF (downloaded once from Geofabrik), actual connected walkable
ways, and multi-source shortest paths. No radius circles or area polygons.
See scripts/WALKING.md for assumptions, installation, and usage.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import urllib.request
from array import array
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import osmium
import shapely
from pyproj import Transformer
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from shapely import STRtree
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parent.parent
MODES = ("metro", "rer", "tram")
DOWNLOAD = "https://download.geofabrik.de/europe/france/ile-de-france-latest.osm.pbf"
ENTRANCES = {"subway_entrance", "train_station_entrance"}
PUBLIC_FOOT = {"yes", "designated", "permissive", "official"}
EXCLUDED_HIGHWAYS = {
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "construction",
    "proposed",
    "raceway",
    "bus_guideway",
    "busway",
}


def log(message):
    print(message, flush=True)


def public_access(tags):
    foot = tags.get("foot")
    return foot not in {"no", "private"} and (
        tags.get("access") not in {"no", "private"} or foot in PUBLIC_FOOT
    )


def walkable(tags):
    highway = tags.get("highway")
    return bool(highway) and highway not in EXCLUDED_HIGHWAYS and public_access(tags)


def mode_for_route(tags, active):
    ref = (tags.get("ref") or "").upper().replace("BIS", "B")
    mode = {
        "subway": "metro",
        "train": "rer",
        "tram": "tram",
        "light_rail": "tram",
    }.get(tags.get("route"))
    return mode if mode and ref in active[mode] else None


class Network(osmium.SimpleHandler):
    def __init__(self, active):
        super().__init__()
        self.active = active
        self.node_index = {}
        self.lon = array("d")
        self.lat = array("d")
        self.u = array("I")
        self.v = array("I")
        self.direction = array("B")
        self.blocked = set()
        self.candidates = {}
        self.areas = []
        self.route_modes = defaultdict(set)

    def node(self, node):
        tags = dict(node.tags)
        if not public_access(tags):
            self.blocked.add(node.id)
        if tags.get("railway") in ENTRANCES | {
            "station",
            "halt",
            "tram_stop",
        } or tags.get("public_transport") in {"station", "platform", "stop_position"}:
            if public_access(tags) and node.location.valid():
                self.candidates[node.id] = {
                    "id": f"node/{node.id}",
                    "lon": node.location.lon,
                    "lat": node.location.lat,
                    "tags": tags,
                }

    def index(self, node):
        if node.ref not in self.node_index:
            self.node_index[node.ref] = len(self.lon)
            self.lon.append(node.location.lon)
            self.lat.append(node.location.lat)
        return self.node_index[node.ref]

    def way(self, way):
        tags = dict(way.tags)
        if not walkable(tags):
            return
        direction = {"yes": 1, "1": 1, "-1": 2}.get(tags.get("oneway:foot"), 3)
        previous = None
        for node in way.nodes:
            if not node.location.valid() or node.ref in self.blocked:
                previous = None
                continue
            current = self.index(node)
            if previous is not None and previous != current:
                self.u.append(previous)
                self.v.append(current)
                self.direction.append(direction)
            previous = current

    def relation(self, relation):
        tags = dict(relation.tags)
        if tags.get("type") == "route":
            mode = mode_for_route(tags, self.active)
            if mode:
                for member in relation.members:
                    self.route_modes[(member.type, member.ref)].add(mode)
        elif tags.get("public_transport") == "stop_area":
            self.areas.append((tags, [(m.type, m.ref) for m in relation.members]))


def sources_from_stations(network, data_dir, include_construction):
    sources = {}

    def add(key, lon, lat, modes, kind, osm_node=None, name=None):
        if not modes:
            return
        if key not in sources:
            sources[key] = {
                "id": key,
                "lon": lon,
                "lat": lat,
                "modes": set(),
                "kind": kind,
                "osm_node": osm_node,
                "name": name,
            }
        sources[key]["modes"].update(modes)

    entrances = json.loads((data_dir / "entrances.geojson").read_text())["features"]
    for feature in entrances:
        properties = feature["properties"]
        if properties.get("access") in {"no", "private"}:
            continue
        lon, lat = feature["geometry"]["coordinates"]
        add(
            feature["id"],
            lon,
            lat,
            properties["modes"],
            "entrance",
            int(feature["id"].split("/")[1]),
        )

    in_area = set()
    for tags, members in network.areas:
        modes = set().union(
            *(network.route_modes.get(member, set()) for member in members)
        )
        if tags.get("subway") == "yes" or "métro" in tags.get("network", "").lower():
            modes.add("metro")
        if "RER" in tags.get("network", "").upper():
            modes.add("rer")
        if not modes:
            continue
        candidates = [
            network.candidates[ref]
            for kind, ref in members
            if kind == "n" and ref in network.candidates
        ]
        in_area.update(candidate["id"] for candidate in candidates)
        accesses = [
            candidate
            for candidate in candidates
            if candidate["tags"].get("railway") in ENTRANCES
        ]
        if not accesses:
            accesses = [
                candidate
                for candidate in candidates
                if candidate["tags"].get("railway") in {"station", "halt", "tram_stop"}
            ]
        if not accesses:
            accesses = candidates
        for candidate in accesses:
            add(
                candidate["id"],
                candidate["lon"],
                candidate["lat"],
                modes,
                "entrance"
                if candidate["tags"].get("railway") in ENTRANCES
                else "surface_or_station",
                int(candidate["id"].split("/")[1]),
                tags.get("name"),
            )

    for node_id, candidate in network.candidates.items():
        if candidate["id"] in in_area or candidate["tags"].get("railway") in ENTRANCES:
            continue
        modes = network.route_modes.get(("n", node_id), set()).copy()
        if candidate["tags"].get("railway") == "tram_stop":
            modes.add("tram")
        if (
            candidate["tags"].get("station") == "subway"
            or candidate["tags"].get("subway") == "yes"
        ):
            modes.add("metro")
        add(
            candidate["id"],
            candidate["lon"],
            candidate["lat"],
            modes,
            "surface_or_station",
            node_id,
            candidate["tags"].get("name"),
        )

    if include_construction:
        for mode in MODES:
            for feature in json.loads(
                (data_dir / f"{mode}-construction.geojson").read_text()
            )["features"]:
                if feature["geometry"]["type"] == "Point":
                    lon, lat = feature["geometry"]["coordinates"]
                    add(
                        f"future/{mode}/{feature['id']}",
                        lon,
                        lat,
                        [mode],
                        "construction_estimate",
                        name=feature["properties"].get("name"),
                    )
    return list(sources.values())


def prepare_graph(network, sources, max_snap):
    project = Transformer.from_crs(4326, 2154, always_xy=True)
    x, y = project.transform(np.asarray(network.lon), np.asarray(network.lat))
    xy = np.column_stack((x, y))
    u, v, direction = (
        np.asarray(network.u),
        np.asarray(network.v),
        np.asarray(network.direction),
    )
    # Collapse identical physical segments, preserving all allowed directions.
    pairs = np.column_stack((np.minimum(u, v), np.maximum(u, v)))
    flags = np.where(u <= v, direction, ((direction & 1) << 1) | ((direction & 2) >> 1))
    pairs, inverse = np.unique(pairs, axis=0, return_inverse=True)
    directions = np.zeros(len(pairs), dtype=np.uint8)
    np.bitwise_or.at(directions, inverse, flags)
    segments = shapely.linestrings(xy[pairs])
    lengths = shapely.length(segments)
    tree = STRtree(segments)
    extra_xy = []
    split_points = defaultdict(dict)
    seed_nodes = defaultdict(dict)
    skipped = []
    for source in sources:
        node = network.node_index.get(source.get("osm_node"))
        connector = 0.0
        if node is None:
            px, py = project.transform(source["lon"], source["lat"])
            point = shapely.Point(px, py)
            edge = int(tree.nearest(point))
            line = segments[edge]
            connector = point.distance(line)
            if connector > max_snap:
                skipped.append(
                    {
                        "id": source["id"],
                        "name": source.get("name"),
                        "reason": "no nearby walkable path",
                        "distance_m": round(connector, 1),
                    }
                )
                continue
            fraction = float(shapely.line_locate_point(line, point, normalized=True))
            if fraction * lengths[edge] < 0.01:
                node = int(pairs[edge, 0])
            elif (1 - fraction) * lengths[edge] < 0.01:
                node = int(pairs[edge, 1])
            else:
                fraction = round(fraction, 10)
                if fraction not in split_points[edge]:
                    node = len(xy) + len(extra_xy)
                    split_points[edge][fraction] = node
                    extra_xy.append(
                        tuple(
                            shapely.line_interpolate_point(
                                line, fraction, normalized=True
                            ).coords[0]
                        )
                    )
                node = split_points[edge][fraction]
        for mode in source["modes"]:
            seed_nodes[mode][node] = min(
                connector, seed_nodes[mode].get(node, math.inf)
            )

    all_xy = np.vstack((xy, extra_xy)) if extra_xy else xy
    result_pairs, result_directions = [], []
    for edge, (a, b) in enumerate(pairs):
        points = [
            (0.0, int(a)),
            *sorted(split_points.get(edge, {}).items()),
            (1.0, int(b)),
        ]
        for (_, start), (_, end) in zip(points, points[1:]):
            result_pairs.append((start, end))
            result_directions.append(directions[edge])
    pairs = np.asarray(result_pairs, dtype=np.int32)
    directions = np.asarray(result_directions, dtype=np.uint8)
    lengths = np.linalg.norm(all_xy[pairs[:, 1]] - all_xy[pairs[:, 0]], axis=1)
    return all_xy, pairs, directions, lengths, seed_nodes, skipped


def shortest_distances(xy, pairs, directions, lengths, seeds, cutoff):
    forward, backward = directions & 1 != 0, directions & 2 != 0
    rows = [pairs[forward, 0], pairs[backward, 1]]
    cols = [pairs[forward, 1], pairs[backward, 0]]
    weights = [lengths[forward], lengths[backward]]
    for index, mode in enumerate(MODES):
        mode_seeds = seeds[mode]
        if not mode_seeds:
            raise ValueError(f"No station access points for {mode}")
        rows.append(np.full(len(mode_seeds), len(xy) + index))
        cols.append(np.fromiter(mode_seeds, dtype=np.int32))
        weights.append(np.fromiter(mode_seeds.values(), dtype=float))
    graph = coo_matrix(
        (np.concatenate(weights), (np.concatenate(rows), np.concatenate(cols))),
        shape=(len(xy) + 3, len(xy) + 3),
    ).tocsr()
    return dijkstra(
        graph, directed=True, indices=np.arange(len(xy), len(xy) + 3), limit=cutoff
    )[:, : len(xy)]


def intervals(distance_u, distance_v, length, flags, cutoff):
    """Exactly reachable intervals along an edge, including partial edges."""
    ranges = []
    if flags & 1 and distance_u < cutoff:
        ranges.append((0.0, min(length, cutoff - distance_u)))
    if flags & 2 and distance_v < cutoff:
        ranges.append((max(0.0, length - (cutoff - distance_v)), length))
    ranges.sort()
    merged = []
    for start, end in ranges:
        if end - start < 1e-6:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def difference(outer, inner):
    result = []
    for start, end in outer:
        cursor = start
        for a, b in inner:
            if a > cursor:
                result.append((cursor, min(a, end)))
            cursor = max(cursor, b)
            if cursor >= end:
                break
        if cursor < end:
            result.append((cursor, end))
    return [(a, b) for a, b in result if b - a > 1e-6]


def tile_xy(lon, lat, zoom):
    scale = 2**zoom
    return (lon + 180) / 360 * scale, (
        1 - math.asinh(math.tan(math.radians(lat))) / math.pi
    ) / 2 * scale


def tile_bounds(x, y, zoom):
    scale = 2**zoom
    return [
        x / scale * 360 - 180,
        math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / scale)))),
        (x + 1) / scale * 360 - 180,
        math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / scale)))),
    ]


def export_tiles(xy, pairs, flags, lengths, distances, output, speed, zoom, metadata):
    inverse = Transformer.from_crs(2154, 4326, always_xy=True)
    output.mkdir(parents=True, exist_ok=True)
    manifest = {
        **metadata,
        "speed_kmh": speed,
        "minutes": [5, 10],
        "tile_zoom": zoom,
        "networks": {},
    }
    five, ten = speed / 3.6 * 300, speed / 3.6 * 600
    for mode_index, mode in enumerate(MODES):
        tiles = defaultdict(lambda: {5: [], 10: []})
        d = distances[mode_index]
        edge_indices = np.flatnonzero(np.minimum(d[pairs[:, 0]], d[pairs[:, 1]]) < ten)
        count = 0
        for edge in edge_indices:
            u, v = pairs[edge]
            length = lengths[edge]
            if length <= 0:
                continue
            near = intervals(d[u], d[v], length, int(flags[edge]), five)
            far = difference(intervals(d[u], d[v], length, int(flags[edge]), ten), near)
            for minutes, ranges in [(5, near), (10, far)]:
                for start, end in ranges:
                    endpoints = xy[u] + np.array([[start / length], [end / length]]) * (
                        xy[v] - xy[u]
                    )
                    lons, lats = inverse.transform(endpoints[:, 0], endpoints[:, 1])
                    line = [
                        [round(float(lons[i]), 6), round(float(lats[i]), 6)]
                        for i in range(2)
                    ]
                    if line[0] == line[1]:
                        continue
                    tile_coords = [tile_xy(lon, lat, zoom) for lon, lat in line]
                    for tx in range(
                        math.floor(min(p[0] for p in tile_coords)),
                        math.floor(max(p[0] for p in tile_coords)) + 1,
                    ):
                        for ty in range(
                            math.floor(min(p[1] for p in tile_coords)),
                            math.floor(max(p[1] for p in tile_coords)) + 1,
                        ):
                            tiles[(tx, ty)][minutes].append(line)
                    count += 1
        folder = output / mode
        folder.mkdir(exist_ok=True)
        index = []
        for (tx, ty), bands in sorted(tiles.items()):
            features = [
                {
                    "type": "Feature",
                    "properties": {"minutes": minutes},
                    "geometry": mapping(
                        shapely.line_merge(shapely.multilinestrings(lines))
                    ),
                }
                for minutes, lines in bands.items()
                if lines
            ]
            filename = f"{tx}-{ty}.geojson"
            temporary = folder / f"{filename}.tmp"
            temporary.write_text(
                json.dumps(
                    {"type": "FeatureCollection", "features": features},
                    separators=(",", ":"),
                )
            )
            temporary.replace(folder / filename)
            index.append(
                {"file": f"{mode}/{filename}", "bounds": tile_bounds(tx, ty, zoom)}
            )
        manifest["networks"][mode] = {"tiles": index, "segments": count}
        log(f"{mode}: wrote {count:,} reachable street segments in {len(index)} tiles")
    # Publish the manifest last so an interrupted run never advertises missing tiles.
    temporary = output / "index.json.tmp"
    temporary.write_text(json.dumps(manifest, separators=(",", ":")))
    temporary.replace(output / "index.json")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pbf",
        type=Path,
        help="Local OSM PBF; otherwise downloads/caches the Île-de-France extract",
    )
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".cache/walking")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "public/data")
    parser.add_argument("--output", type=Path, default=ROOT / "public/data/walking")
    parser.add_argument("--speed-kmh", type=float, default=4.8)
    parser.add_argument(
        "--include-construction",
        action="store_true",
        help="Also estimate access from published construction-station locations",
    )
    parser.add_argument(
        "--max-snap-m",
        type=float,
        default=800,
        help="Maximum off-network connector; its distance counts toward walking time",
    )
    args = parser.parse_args()
    if args.speed_kmh <= 0 or args.max_snap_m <= 0:
        parser.error("Speed and maximum snap distance must be positive")
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    pbf = args.pbf or args.cache_dir / "ile-de-france.osm.pbf"
    if not pbf.exists():
        log(f"Downloading {DOWNLOAD}")
        temporary = pbf.with_suffix(".download")
        request = urllib.request.Request(
            DOWNLOAD, headers={"User-Agent": "coliving-invest walking-street generator"}
        )
        with (
            urllib.request.urlopen(request, timeout=180) as response,
            temporary.open("wb") as target,
        ):
            shutil.copyfileobj(response, target)
        temporary.replace(pbf)
    active = {
        mode: {
            f["properties"]["name"].upper().replace("BIS", "B")
            for f in json.loads((args.data_dir / f"{mode}.geojson").read_text())[
                "features"
            ]
        }
        for mode in MODES
    }
    log("Reading OSM walking paths and transit stations…")
    network = Network(active)
    network.apply_file(
        str(pbf),
        locations=True,
        idx="flex_mem",
        # Location indexing still sees every node. Only relevant tagged objects
        # reach Python, avoiding callbacks for millions of untagged/building nodes.
        filters=[
            osmium.filter.KeyFilter(
                "highway", "railway", "public_transport", "access", "foot", "type"
            )
        ],
    )
    log(f"Parsed {len(network.lon):,} nodes and {len(network.u):,} walkable segments")
    sources = sources_from_stations(network, args.data_dir, args.include_construction)
    log(f"Connecting {len(sources):,} station entrances/stops to the walking network…")
    xy, pairs, flags, lengths, seeds, skipped = prepare_graph(
        network, sources, args.max_snap_m
    )
    del network
    log(
        f"Computing shortest walking distances; {len(skipped)} access points could not be connected"
    )
    distances = shortest_distances(
        xy, pairs, flags, lengths, seeds, args.speed_kmh / 3.6 * 600
    )
    reader = osmium.io.Reader(str(pbf), osmium.osm.osm_entity_bits.NOTHING)
    osm_timestamp = reader.header().get("osmosis_replication_timestamp")
    reader.close()
    metadata = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "source": DOWNLOAD,
        "osm_timestamp": osm_timestamp,
        "include_construction": args.include_construction,
        "source_counts": {
            mode: sum(mode in s["modes"] for s in sources) for mode in MODES
        },
        "unconnected_sources": skipped,
        "assumptions": "Uniform walking speed; mapped public paths; connectors count toward time. Future station access is estimated.",
    }
    export_tiles(
        xy, pairs, flags, lengths, distances, args.output, args.speed_kmh, 12, metadata
    )
    log(f"Finished: {args.output / 'index.json'}")


if __name__ == "__main__":
    main()
