# Walking street highlights

The Python generator computes reachable **street/path segments**, not filled
polygons or distance circles. It generates the files used by the Métro, RER, and
Tramway checkboxes, including future stations.

## Run

Use Python 3.10–3.13:

```bash
python3 -m venv .venv-walking
.venv-walking/bin/python -m pip install -r scripts/walking-requirements.txt
.venv-walking/bin/python scripts/compute-walking-streets.py --include-construction
```

The first run downloads the [Geofabrik Île-de-France OSM extract](https://download.geofabrik.de/europe/france/ile-de-france.html)
(about 325 MB) into `.cache/walking/`. No API key is needed. Processing the regional
extract takes several minutes. Later runs reuse the download. To refresh the OSM
network, replace the cached PBF or pass a newer local extract:

```bash
.venv-walking/bin/python scripts/compute-walking-streets.py \
  --pbf /path/to/ile-de-france.osm.pbf \
  --include-construction \
  --speed-kmh 4.8
```

Refresh `entrances.geojson`, the operating routes, and construction route/station
snapshots using their existing update scripts before recomputing, if required.
`--output` can target a separate directory for reviewing a new generation.

The output is `public/data/walking/index.json` and spatial GeoJSON chunks under
`public/data/walking/{metro,rer,tram}/`. These are app assets and must be kept with
the app. Python, the PBF, and the cache are not required to serve the generated
highlights. `npm run build` copies the assets into the production build.

If `ng serve` was already running before the walking folder was first generated,
restart the dev server afterward. Angular may not register an entirely new asset
directory until restart; a missing `data/walking/index.json` then returns HTTP 404.

## Calculation

- Green: 0–5 minutes along the walking network, at 4.8 km/h (400 metres).
- Blue: more than 5 and up to 10 minutes (800 metres).
- OSM ways supply the real street/path geometry and connectivity. Crossings,
  bridges, tunnels, and disconnected paths follow shared OSM node IDs. Geometric
  intersections are not automatically treated as crossings.
- Private and explicitly prohibited pedestrian ways/nodes are excluded.
  Motorways, trunk roads, roads under construction, and proposed ways are excluded.
  Automobile one-way restrictions do not apply to pedestrians; explicit
  `oneway:foot` restrictions do.
- Existing mapped station entrances are used as access points. OSM transit stop
  areas and route membership add surface tram stops and stations without mapped
  entrances. Station/platform positions are a fallback where entrance data is
  missing, rather than dropping those stations from coverage.
- `--include-construction` also uses the published future-station locations from
  the construction snapshots. Access from those locations to the nearest mapped
  public path is an **estimate**, not a verified future entrance.
- An access point already on the network uses its OSM node. Other access points
  are snapped to the nearest walkable edge. The off-network connector distance
  counts toward walking time. The edge is split at the snapped point before
  routing, avoiding artificial detours via a distant road endpoint.
- Distances use metre coordinates in EPSG:2154 and directed multi-source Dijkstra.
  All sources in each network start together, so results are the shortest walk
  from any access point in that network. Partial edges are clipped exactly at
  each time threshold. No convex hull, buffering, or straight-line radius is used
  to turn streets into coverage areas.
- Contiguous segments of the same color are merged for smaller static files.
  This changes only the representation, not their geometry or walking times.
- In the UI, the single "Walking streets (5/10 min)" toggle controls both colors
  and starts off. When enabled, highlights follow selected networks. Green from any selected network
  is drawn above blue, giving the shortest-time color wherever networks overlap.
  Disabling a network removes its highlights. Only chunks around the map view
  are loaded, using Canvas rendering below transit lines and station dots.

The model uses a uniform walking speed. It does not include signals, stairs or
slope penalties, opening hours, temporary closures, conditional access, or
pedestrian turn-restriction relations. Snapped connectors are approximate and
can cross a barrier when the access data lacks a mapped connection; this is
particularly relevant to future stations. Sources more than `--max-snap-m`
(default 800 m) from the walking network are listed in the output manifest's
`unconnected_sources` instead of receiving fabricated circles. Coverage is
limited by the regional extract and the completeness of OSM.

The output manifest records the speed, generation time, source, whether future
stations were included, input access-point counts, and unconnected sources.
The OSM-derived street geometry is licensed under ODbL; the map displays OSM
attribution. Future station locations retain their Île-de-France Mobilités /
Etalab provenance.
