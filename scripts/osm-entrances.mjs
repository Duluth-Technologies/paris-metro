function routeMode(tags) {
  if (tags.route === 'subway') return 'metro';
  if (['tram', 'light_rail'].includes(tags.route) && /^T\d/i.test(tags.ref ?? '')) return 'tram';
  if (tags.route === 'train' && /^[A-E]$/.test(tags.ref ?? '')) return 'rer';
}

export function buildEntrances(data) {
  if (data.remark || !Array.isArray(data.elements)) {
    throw new Error(`Incomplete Overpass response: ${data.remark ?? 'missing elements'}`);
  }
  const routesByMember = new Map();
  for (const route of data.elements) {
    if (route.type !== 'relation' || route.tags?.type !== 'route') continue;
    const mode = routeMode(route.tags);
    if (!mode) continue;
    for (const member of route.members ?? []) {
      const key = `${member.type}/${member.ref}`;
      if (!routesByMember.has(key)) routesByMember.set(key, []);
      routesByMember.get(key).push({ mode, line: route.tags.ref });
    }
  }

  const areasByEntrance = new Map();
  for (const area of data.elements) {
    if (area.type !== 'relation' || area.tags?.public_transport !== 'stop_area') continue;
    const modes = new Set();
    const lines = new Set();
    const network = area.tags.network ?? '';
    if (/métro|metro/i.test(network) || area.tags.subway === 'yes') modes.add('metro');
    if (/\bRER\b/i.test(network)) modes.add('rer');
    for (const member of area.members ?? []) {
      for (const route of routesByMember.get(`${member.type}/${member.ref}`) ?? []) {
        modes.add(route.mode);
        if (route.line)
          lines.add(
            `${route.mode === 'metro' ? 'Métro' : route.mode === 'rer' ? 'RER' : 'Tram'} ${route.line}`,
          );
      }
    }
    for (const member of area.members ?? []) {
      if (member.type !== 'node') continue;
      if (!areasByEntrance.has(member.ref)) areasByEntrance.set(member.ref, []);
      areasByEntrance
        .get(member.ref)
        .push({ id: `relation/${area.id}`, name: area.tags.name, modes, lines });
    }
  }

  // A station can have a separate stop_area per line. Link areas only when
  // they share an actual entrance, never because their coordinates are close.
  const stationParents = new Map();
  function stationRoot(id) {
    if (!stationParents.has(id)) stationParents.set(id, id);
    const parent = stationParents.get(id);
    if (parent !== id) stationParents.set(id, stationRoot(parent));
    return stationParents.get(id);
  }
  for (const entrance of data.elements) {
    if (
      entrance.type !== 'node' ||
      !['subway_entrance', 'train_station_entrance'].includes(entrance.tags?.railway)
    )
      continue;
    const areas = areasByEntrance.get(entrance.id) ?? [];
    for (const area of areas.slice(1)) {
      const roots = [stationRoot(areas[0].id), stationRoot(area.id)].sort();
      stationParents.set(roots[1], roots[0]);
    }
  }

  const features = new Map();
  for (const entrance of data.elements) {
    const tags = entrance.tags ?? {};
    if (
      entrance.type !== 'node' ||
      !['subway_entrance', 'train_station_entrance'].includes(tags.railway)
    )
      continue;
    if (!Number.isFinite(entrance.lat) || !Number.isFinite(entrance.lon))
      throw new Error(`Invalid coordinates for OSM node ${entrance.id}`);
    const areas = areasByEntrance.get(entrance.id) ?? [];
    const modes = new Set(areas.flatMap((area) => [...area.modes]));
    // Preserve unassociated subway entrances. Never substitute station centers.
    if (!modes.size && tags.railway === 'subway_entrance') modes.add('metro');
    if (!modes.size) continue; // Exclude entrances to unrelated regional/mainline trains.
    features.set(entrance.id, {
      type: 'Feature',
      id: `node/${entrance.id}`,
      properties: {
        stationId: areas.length ? stationRoot(areas[0].id) : `node/${entrance.id}`,
        name: tags.name ?? null,
        ref: tags.ref ?? null,
        stations: [...new Set(areas.map((area) => area.name).filter(Boolean))].sort(),
        modes: [...modes].sort(),
        lines: [...new Set(areas.flatMap((area) => [...area.lines]))].sort(),
        wheelchair: tags.wheelchair ?? null,
        access: tags.access ?? null,
        entrance: tags.entrance ?? null,
        osmUrl: `https://www.openstreetmap.org/node/${entrance.id}`,
      },
      geometry: { type: 'Point', coordinates: [entrance.lon, entrance.lat] },
    });
  }
  if (!features.size) throw new Error('No OSM entrances found.');
  return {
    type: 'FeatureCollection',
    source: '© OpenStreetMap contributors, ODbL 1.0',
    timestamp: data.osm3s?.timestamp_osm_base ?? null,
    features: [...features.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
