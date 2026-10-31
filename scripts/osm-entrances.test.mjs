import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEntrances } from './osm-entrances.mjs';

const member = (ref) => ({ type: 'node', ref, role: '' });
const node = (id, railway = 'subway_entrance') => ({
  type: 'node',
  id,
  lat: 48.8566001 + id / 1e7,
  lon: 2.3522001,
  tags: { railway },
});
const area = (id, refs) => ({
  type: 'relation',
  id,
  tags: { public_transport: 'stop_area', name: 'Station' },
  members: refs.map(member),
});
const route = (id, type, ref, stop) => ({
  type: 'relation',
  id,
  tags: { type: 'route', route: type, ref },
  members: [member(stop)],
});
const data = {
  elements: [
    node(1),
    node(2),
    node(3, 'train_station_entrance'),
    node(4, 'train_station_entrance'),
    node(5, 'station'),
    node(6, 'train_station_entrance'),
    area(10, [1, 2, 101]),
    area(11, [1, 3, 102]),
    area(12, [4, 103]),
    area(13, [6, 104]),
    route(20, 'subway', '4', 101),
    route(21, 'train', 'A', 102),
    route(22, 'train', 'H', 103),
    route(23, 'tram', 'T2', 104),
  ],
};

test('keeps nearby entrance nodes separate and preserves their exact coordinates', () => {
  const { features } = buildEntrances(data);
  for (const id of [1, 2]) {
    const source = data.elements.find((element) => element.type === 'node' && element.id === id);
    const feature = features.find((feature) => feature.id === `node/${id}`);
    assert.deepEqual(feature.geometry.coordinates, [source.lon, source.lat]);
  }
  assert.notDeepEqual(
    features.find((f) => f.id === 'node/1').geometry.coordinates,
    features.find((f) => f.id === 'node/2').geometry.coordinates,
  );
});

test('assigns shared entrances to both modes without duplicating the entrance', () => {
  const { features } = buildEntrances({ ...data, elements: [...data.elements, node(1)] });
  const shared = features.filter((feature) => feature.id === 'node/1');
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0].properties.modes, ['metro', 'rer']);
  assert.deepEqual(shared[0].properties.lines, ['Métro 4', 'RER A']);
});

test('includes actual tram entrances and excludes unrelated trains and station centers', () => {
  const { features } = buildEntrances(data);
  assert.equal(
    features.some((feature) => feature.id === 'node/4'),
    false,
  );
  assert.equal(
    features.some((feature) => feature.id === 'node/5'),
    false,
  );
  assert.deepEqual(features.find((feature) => feature.id === 'node/6').properties.modes, ['tram']);
});

test('rejects partial Overpass responses instead of publishing incomplete data', () => {
  assert.throws(() => buildEntrances({ ...data, remark: 'Query timed out' }), /Incomplete/);
});
