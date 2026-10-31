import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist/coliving-invest/browser');
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const requireFile = async (path) =>
  assert((await stat(resolve(root, path))).size > 0, `Missing or empty built asset: ${path}`);
const html = await readFile(resolve(root, 'index.html'), 'utf8');
assert(html.includes('<base href="/"'), 'The custom-domain build must use base href /.');
assert.equal(
  (await readFile(resolve(root, 'CNAME'), 'utf8')).trim(),
  'paris-metro.duluthtechnologies.com',
);
for (const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|ico))"/g))
  await requireFile(match[1]);
const manifest = await readJson('data/walking/index.json');
assert(manifest.speed_kmh > 0, 'Walking speed must be positive.');
assert.equal(
  manifest.include_construction,
  true,
  'The walking snapshot must include future stations.',
);
let tiles = 0;
for (const mode of ['metro', 'rer', 'tram']) {
  for (const path of [`data/${mode}.geojson`, `data/${mode}-construction.geojson`]) {
    const data = await readJson(path);
    assert(
      data.type === 'FeatureCollection' && data.features.length > 0,
      `Missing route data: ${path}`,
    );
  }
  assert(manifest.networks[mode].tiles.length > 0, `Missing walking index for ${mode}.`);
  for (const tile of manifest.networks[mode].tiles) {
    await requireFile(`data/walking/${tile.file}`);
    tiles++;
  }
}
await requireFile('data/entrances.geojson');
console.log(
  `Pages build verified: root base href, custom domain, route/entrance data, and ${tiles} precomputed walking files.`,
);
