import { mkdir, writeFile } from 'node:fs/promises';

const url = new URL(
  'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/traces-des-lignes-de-transport-en-commun-idfm/records',
);
url.search = new URLSearchParams({
  where:
    "route_type = 'Subway' OR (route_type = 'Rail' AND route_short_name IN ('A', 'B', 'C', 'D', 'E')) OR (route_type = 'Tram' AND startswith(route_short_name, 'T'))",
  select: 'route_id,route_short_name,route_type,route_color,shape',
  limit: '100',
});
const response = await fetch(url);
if (!response.ok) throw new Error(`Transit data request failed: ${response.status}`);
const { results, total_count } = await response.json();
if (!results?.length || results.length !== total_count)
  throw new Error('Transit data is empty or incomplete.');

await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
for (const [mode, type] of Object.entries({ metro: 'Subway', rer: 'Rail', tram: 'Tram' })) {
  const features = results
    .filter((line) => line.route_type === type)
    .map((line) => {
      if (!line.shape?.geometry || !/^[0-9a-f]{6}$/i.test(line.route_color))
        throw new Error(`Missing geometry or color for ${line.route_id}`);
      return {
        type: 'Feature',
        properties: { name: line.route_short_name, color: `#${line.route_color}` },
        geometry: line.shape.geometry,
      };
    });
  if (!features.length) throw new Error(`No routes found for ${mode}`);
  await writeFile(
    new URL(`../public/data/${mode}.geojson`, import.meta.url),
    JSON.stringify({ type: 'FeatureCollection', features }),
  );
  console.log(`${mode}: ${features.length} lines`);
}
