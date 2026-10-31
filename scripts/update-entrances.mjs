import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildEntrances } from './osm-entrances.mjs';

const query = await readFile(new URL('./transit-entrances.overpass', import.meta.url), 'utf8');
let data;
if (process.argv[2] === '--from' && process.argv[3]) {
  data = JSON.parse(await readFile(process.argv[3], 'utf8'));
} else {
  const response = await fetch(
    process.env.OSM_OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter',
    {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) throw new Error(`OSM entrance request failed: ${response.status}`);
  data = await response.json();
}
const collection = buildEntrances(data);
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../public/data/entrances.geojson', import.meta.url),
  JSON.stringify(collection),
);
for (const mode of ['metro', 'rer', 'tram']) {
  console.log(
    `${mode}: ${collection.features.filter((f) => f.properties.modes.includes(mode)).length} entrances`,
  );
}
console.log(
  `${collection.features.length} unique OSM entrance nodes, source date ${collection.timestamp}`,
);
