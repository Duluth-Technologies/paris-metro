import L from 'leaflet';
import { EntranceCollection, EntranceLayer } from './entrance-layer';

const data: EntranceCollection = {
  type: 'FeatureCollection',
  features: [
    { id: 'node/1', modes: ['metro', 'rer'] as const },
    { id: 'node/2', modes: ['metro'] as const },
    { id: 'node/3', modes: ['tram'] as const },
  ].map(({ id, modes }) => ({
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [2.3522, 48.8566] },
    properties: {
      stationId: id === 'node/3' ? 'relation/2' : 'relation/1',
      name: 'Rue de Rivoli',
      ref: '1',
      stations: ['Châtelet'],
      lines: [],
      modes: [...modes],
      access: null,
      entrance: null,
      osmUrl: `https://www.openstreetmap.org/${id}`,
    },
  })),
};

describe('EntranceLayer', () => {
  let map: L.Map;
  let element: HTMLDivElement;
  let layer: EntranceLayer;
  const visibleMarkers = () => {
    const markers: L.Layer[] = [];
    map.eachLayer((candidate) => {
      if (candidate instanceof L.MarkerClusterGroup) markers.push(...candidate.getLayers());
    });
    return markers;
  };

  beforeEach(() => {
    element = document.createElement('div');
    document.body.append(element);
    map = L.map(element).setView([48.8566, 2.3522], 12);
    map.setMaxZoom(19);
    layer = new EntranceLayer(map, data);
  });

  afterEach(() => {
    map.remove();
    element.remove();
  });

  it('counts shared entrances once and retains their individual markers', () => {
    layer.showModes(['metro', 'rer']);
    expect(visibleMarkers()).toHaveLength(2);
    expect(visibleMarkers().every((marker) => marker instanceof L.Marker)).toBe(true);
  });

  it('removes hidden entrances while preserving entrances shared with a visible network', () => {
    layer.showModes(['metro', 'rer']);
    layer.showModes(['rer']);
    expect(visibleMarkers()).toHaveLength(1);
    layer.showModes([]);
    expect(visibleMarkers()).toHaveLength(0);
    layer.showModes(['metro', 'rer', 'tram']);
    expect(visibleMarkers()).toHaveLength(3);
  });
});
