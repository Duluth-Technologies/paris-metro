import L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import type { TransitMode } from './entrance-layer';

interface WalkingTile {
  file: string;
  bounds: [number, number, number, number];
}
export interface WalkingManifest {
  speed_kmh: number;
  include_construction: boolean;
  networks: Record<TransitMode, { tiles: WalkingTile[] }>;
}
interface TileEntry {
  started: boolean;
  controller: AbortController;
  layer?: L.GeoJSON;
}

/** Load only street segments around the current view, keeping paths below transit lines. */
export class WalkingLayer extends L.Layer {
  private map?: L.Map;
  private readonly tiles = new Map<string, TileEntry>();
  private pending = 0;

  constructor(
    private readonly index: WalkingTile[],
    private readonly renderers: Record<5 | 10, L.Canvas>,
    private readonly onError: () => void,
  ) {
    super();
  }

  override onAdd(map: L.Map): this {
    this.map = map;
    map.on('moveend', this.refresh);
    this.refresh();
    return this;
  }

  override onRemove(map: L.Map): this {
    map.off('moveend', this.refresh);
    this.map = undefined;
    for (const entry of this.tiles.values()) {
      entry.controller.abort();
      if (entry.layer) map.removeLayer(entry.layer);
    }
    this.tiles.clear();
    return this;
  }

  private readonly refresh = (): void => {
    if (!this.map) return;
    const bounds = this.map.getBounds().pad(0.1);
    const visible = new Set(
      this.index
        .filter(({ bounds: [west, south, east, north] }) =>
          bounds.intersects([
            [south, west],
            [north, east],
          ]),
        )
        .map((tile) => tile.file),
    );
    for (const [file, entry] of this.tiles) {
      if (visible.has(file)) continue;
      entry.controller.abort();
      if (entry.layer) this.map.removeLayer(entry.layer);
      this.tiles.delete(file);
    }
    for (const file of visible) {
      if (!this.tiles.has(file)) {
        this.tiles.set(file, { started: false, controller: new AbortController() });
      }
    }
    this.drain();
  };

  private drain(): void {
    if (!this.map) return;
    for (const [file, entry] of this.tiles) {
      if (this.pending >= 4) break;
      if (entry.started) continue;
      entry.started = true;
      this.pending++;
      void this.load(file, entry).finally(() => {
        this.pending--;
        this.drain();
      });
    }
  }

  private async load(file: string, entry: TileEntry): Promise<void> {
    try {
      const response = await fetch(`data/walking/${file}`, { signal: entry.controller.signal });
      if (!response.ok) throw new Error(`Walking streets request failed: ${response.status}`);
      const data: FeatureCollection = await response.json();
      if (!this.map || this.tiles.get(file) !== entry) return;
      entry.layer = L.geoJSON(data, {
        interactive: false,
        style: (feature) => {
          const minutes = feature?.properties?.minutes === 5 ? 5 : 10;
          return {
            renderer: this.renderers[minutes],
            pane: `walking-${minutes}`,
            color: minutes === 5 ? '#16a34a' : '#3b82f6',
            weight: 4,
            opacity: minutes === 5 ? 0.85 : 0.65,
            lineCap: 'round',
          };
        },
      }).addTo(this.map);
    } catch {
      if (entry.controller.signal.aborted) return;
      // Keep the failed tile until the layer is toggled off/on: avoid retry loops.
      this.onError();
    }
  }
}
