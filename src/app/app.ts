import {
  AfterViewInit,
  Component,
  computed,
  ElementRef,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import { EntranceCollection, EntranceLayer, TransitMode } from './entrance-layer';
import { WalkingLayer, WalkingManifest } from './walking-layer';

@Component({
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements AfterViewInit, OnDestroy {
  protected readonly modes = [
    { id: 'metro', label: 'Métro' },
    { id: 'rer', label: 'RER' },
    { id: 'tram', label: 'Tramway' },
  ].map((mode) => ({
    ...mode,
    id: mode.id as TransitMode,
    enabled: signal(false),
    loading: signal(false),
    error: signal(false),
  }));

  protected readonly walkingEnabled = signal(false);
  protected readonly walkingVisible = computed(
    () => this.walkingEnabled() && this.modes.some((mode) => mode.enabled()),
  );
  protected readonly walkingSpeed = signal(4.8);
  protected readonly walkingError = signal(false);

  private readonly mapElement = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private readonly layers = new Map<TransitMode, L.GeoJSON>();
  private readonly walkingLayers = new Map<TransitMode, WalkingLayer>();
  private readonly requests = new AbortController();
  private map?: L.Map;
  private entrances?: EntranceLayer;
  private entrancesRequest?: Promise<void>;
  private walkingRequest?: Promise<WalkingManifest>;
  private walkingRenderers!: Record<5 | 10, L.Canvas>;

  ngAfterViewInit(): void {
    this.map = L.map(this.mapElement().nativeElement).setView([48.8566, 2.3522], 12);
    this.map.createPane('construction-stations').style.zIndex = '450';
    // A green segment from any selected network must stay above all blue segments.
    this.map.createPane('walking-10').style.zIndex = '310';
    this.map.createPane('walking-5').style.zIndex = '320';
    this.map.getPane('walking-10')!.style.pointerEvents = 'none';
    this.map.getPane('walking-5')!.style.pointerEvents = 'none';
    this.walkingRenderers = {
      5: L.canvas({ pane: 'walking-5' }),
      10: L.canvas({ pane: 'walking-10' }),
    };
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      className: 'muted-basemap',
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map);
    this.map.attributionControl.addAttribution(
      'Lines: <a href="https://data.iledefrance-mobilites.fr/explore/dataset/traces-des-lignes-de-transport-en-commun-idfm/">Île-de-France Mobilités</a> (ODbL)',
    );
    this.map.attributionControl.addAttribution(
      '<a href="https://data.iledefrance-mobilites.fr/explore/dataset/projets_lignes_idf/">Construction: Île-de-France Mobilités</a> (Etalab)',
    );
  }

  protected async toggleMode(id: TransitMode, enabled: boolean): Promise<void> {
    const mode = this.modes.find((mode) => mode.id === id)!;
    mode.enabled.set(enabled);
    mode.error.set(false);
    this.walkingError.set(false);
    const cached = this.layers.get(id);
    if (cached) {
      if (enabled) cached.addTo(this.map!);
      else this.map?.removeLayer(cached);
      if (enabled && this.walkingEnabled()) {
        await this.loadWalking(id);
      }
      this.syncWalkingLayers();
      this.syncEntrances();
      return;
    }
    if (!enabled || mode.loading()) {
      this.syncEntrances();
      return;
    }

    mode.loading.set(true);
    try {
      const [operating, construction] = await Promise.all([
        this.loadGeoJson<FeatureCollection>(`data/${id}.geojson`),
        this.loadGeoJson<FeatureCollection>(`data/${id}-construction.geojson`),
        this.loadEntrances(),
      ]);
      if (this.requests.signal.aborted) return;
      const data: FeatureCollection = {
        type: 'FeatureCollection',
        features: [...operating.features, ...construction.features],
      };
      const layer = L.geoJSON(data, {
        pointToLayer: (_feature, latlng) =>
          L.circleMarker(latlng, {
            pane: 'construction-stations',
            className: 'construction-station',
            radius: 4,
            color: '#334155',
            weight: 1.5,
            opacity: 1,
            fillColor: '#fff',
            fillOpacity: 1,
          }),
        style: (feature) => {
          if (feature?.geometry.type === 'Point') return {};
          const underConstruction = feature?.properties?.status === 'under_construction';
          return {
            color: feature?.properties?.color ?? '#334155',
            weight: id === 'rer' ? 5 : 4,
            opacity: 0.9,
            dashArray: underConstruction ? '8 6' : undefined,
            lineCap: underConstruction ? 'butt' : 'round',
          };
        },
        onEachFeature: (feature, route) => {
          const underConstruction = feature.properties?.status === 'under_construction';
          const station = feature.geometry.type === 'Point';
          const label = document.createElement('span');
          const name = station
            ? `${feature.properties?.name} · ${mode.label} ${feature.properties?.lines?.join(', ')}`
            : `${mode.label} ${feature.properties?.name ?? ''}`;
          label.textContent = underConstruction ? `${name} · Under construction` : name;
          if (underConstruction && !station) {
            label.append(
              document.createElement('br'),
              document.createTextNode(
                `Expected opening: ${feature.properties?.expectedOpening || 'Not announced'}`,
              ),
            );
          }
          route.bindTooltip(label, { sticky: !station });
          if (underConstruction) {
            const popup = document.createElement('div');
            const description = document.createElement('p');
            description.textContent = feature.properties?.title ?? label.textContent;
            const status = document.createElement('p');
            status.textContent = station
              ? 'Station under construction'
              : 'Route under construction';
            const source = document.createElement('a');
            source.href = station
              ? 'https://data.iledefrance-mobilites.fr/explore/dataset/projets_arrets_idf/'
              : 'https://data.iledefrance-mobilites.fr/explore/dataset/projets_lignes_idf/';
            source.target = '_blank';
            source.rel = 'noopener noreferrer';
            source.textContent = 'Source: Île-de-France Mobilités';
            popup.append(description, status, source);
            route.bindPopup(popup);
          }
        },
      });
      this.layers.set(id, layer);
      if (mode.enabled()) layer.addTo(this.map!);
      this.syncEntrances();
      if (mode.enabled() && this.walkingEnabled()) await this.loadWalking(id);
      this.syncWalkingLayers();
    } catch {
      if (!this.requests.signal.aborted) {
        mode.enabled.set(false);
        mode.error.set(true);
        this.syncEntrances();
      }
    } finally {
      mode.loading.set(false);
    }
  }

  protected async toggleWalking(enabled: boolean): Promise<void> {
    this.walkingEnabled.set(enabled);
    this.walkingError.set(false);
    this.syncWalkingLayers();
    if (!enabled) return;
    await Promise.all(
      this.modes
        .filter((mode) => mode.enabled() && this.layers.has(mode.id))
        .map((mode) => this.loadWalking(mode.id)),
    );
    this.syncWalkingLayers();
  }

  private syncWalkingLayers(): void {
    if (!this.map || this.requests.signal.aborted) return;
    for (const [id, layer] of this.walkingLayers) {
      const visible =
        this.walkingEnabled() &&
        this.modes.some((mode) => mode.id === id && mode.enabled()) &&
        this.layers.has(id);
      if (visible && !this.map.hasLayer(layer)) layer.addTo(this.map);
      else if (!visible && this.map.hasLayer(layer)) this.map.removeLayer(layer);
    }
  }

  private async loadGeoJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { signal: this.requests.signal });
    if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
    return response.json();
  }

  private async loadWalking(id: TransitMode): Promise<void> {
    if (this.walkingLayers.has(id)) return;
    try {
      this.walkingRequest ??= this.loadGeoJson<WalkingManifest>('data/walking/index.json').catch(
        (error) => {
          this.walkingRequest = undefined;
          throw error;
        },
      );
      const manifest = await this.walkingRequest;
      if (this.requests.signal.aborted || this.walkingLayers.has(id)) return;
      this.walkingSpeed.set(manifest.speed_kmh);
      this.walkingLayers.set(
        id,
        new WalkingLayer(manifest.networks[id].tiles, this.walkingRenderers, () =>
          this.walkingError.set(true),
        ),
      );
    } catch {
      if (!this.requests.signal.aborted) this.walkingError.set(true);
    }
  }

  private loadEntrances(): Promise<void> {
    this.entrancesRequest ??= this.loadGeoJson<EntranceCollection>('data/entrances.geojson')
      .then((data) => {
        if (!this.requests.signal.aborted) this.entrances = new EntranceLayer(this.map!, data);
      })
      .catch((error) => {
        this.entrancesRequest = undefined;
        throw error;
      });
    return this.entrancesRequest;
  }

  private syncEntrances(): void {
    this.entrances?.showModes(
      this.modes
        .filter((mode) => mode.enabled() && this.layers.has(mode.id))
        .map((mode) => mode.id),
    );
  }

  ngOnDestroy(): void {
    this.requests.abort();
    this.map?.remove();
  }
}
