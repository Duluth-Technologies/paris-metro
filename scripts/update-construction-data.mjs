import { mkdir, writeFile } from 'node:fs/promises';

const catalog = 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/';
const routeSource = 'https://data.iledefrance-mobilites.fr/explore/dataset/projets_lignes_idf/';
const stationSource = 'https://data.iledefrance-mobilites.fr/explore/dataset/projets_arrets_idf/';
const where =
  "statut = 'Travaux' AND (mode = 'métro' OR sous_mode = 'RER' OR mode = 'tram') AND (creation = 1 OR prolong = 1)";

async function records(dataset, select) {
  const url = new URL(`${catalog}${dataset}/exports/json`);
  url.search = new URLSearchParams({ where, select });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Construction ${dataset} request failed: ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data) || !data.length)
    throw new Error(`Construction ${dataset} data is empty or invalid.`);
  return data;
}
const [routes, stations] = await Promise.all([
  records(
    'projets_lignes_idf',
    'id_ligne,id_projet,id_operati,operation,mode,sous_mode,indice,statut,mes_off_tx,rvb,geo_shape',
  ),
  records(
    'projets_arrets_idf',
    'nom_arret,id_projet,id_operati,operation,mode,sous_mode,indice,geo_shape',
  ),
]);
const matchesMode = (record, mode) =>
  mode === 'metro'
    ? record.mode === 'métro'
    : mode === 'rer'
      ? record.sous_mode === 'RER'
      : record.mode === 'tram';
const snapshots = [];
for (const mode of ['metro', 'rer', 'tram']) {
  const modeRoutes = routes.filter((record) => matchesMode(record, mode));
  const operations = new Set(
    modeRoutes.map((record) => `${record.id_projet}/${record.id_operati}`),
  );
  const features = modeRoutes.map((record, index) => {
    const geometry = record.geo_shape?.geometry;
    if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.type))
      throw new Error(`Missing route geometry for ${record.id_ligne}`);
    return {
      type: 'Feature',
      id: `${record.id_ligne}/${index}`,
      properties: {
        name: record.indice,
        title: record.operation,
        color: record.rvb || '#64748b',
        status: 'under_construction',
        expectedOpening: /^(NC|N\/A|inconnue?)?$/i.test(record.mes_off_tx?.trim() ?? '')
          ? null
          : record.mes_off_tx.trim(),
        sourceUrl: routeSource,
      },
      geometry,
    };
  });
  const stationFeatures = new Map();
  for (const station of stations.filter(
    (record) =>
      matchesMode(record, mode) && operations.has(`${record.id_projet}/${record.id_operati}`),
  )) {
    const geometry = station.geo_shape?.geometry;
    if (
      geometry?.type !== 'Point' ||
      geometry.coordinates.length !== 2 ||
      !geometry.coordinates.every(Number.isFinite)
    )
      throw new Error(`Invalid station geometry for ${station.nom_arret}`);
    // Only collapse duplicate records at the same named station location.
    const key = `${station.nom_arret ?? ''}/${geometry.coordinates.join('/')}`;
    if (!stationFeatures.has(key))
      stationFeatures.set(key, {
        type: 'Feature',
        id: `station/${key}`,
        properties: {
          name: station.nom_arret || 'Future station',
          lines: [],
          title: station.nom_arret || 'Future station',
          status: 'under_construction',
          sourceUrl: stationSource,
        },
        geometry,
      });
    const feature = stationFeatures.get(key);
    if (!feature.properties.lines.includes(station.indice))
      feature.properties.lines.push(station.indice);
  }
  snapshots.push({
    mode,
    data: {
      type: 'FeatureCollection',
      source: routeSource,
      stationSource,
      retrieved: new Date().toISOString(),
      features: [...features, ...stationFeatures.values()],
    },
  });
  console.log(
    `${mode}: ${features.length} construction route sections, ${stationFeatures.size} station dots`,
  );
}
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
for (const { mode, data } of snapshots)
  await writeFile(
    new URL(`../public/data/${mode}-construction.geojson`, import.meta.url),
    JSON.stringify(data),
  );
