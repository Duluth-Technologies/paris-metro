import L from 'leaflet';
import 'leaflet.markercluster';
import type { FeatureCollection, Point } from 'geojson';

export type TransitMode = 'metro' | 'rer' | 'tram';
export interface EntranceProperties {
  stationId: string;
  name: string | null;
  ref: string | null;
  stations: string[];
  modes: TransitMode[];
  lines: string[];
  osmUrl: string;
  access: string | null;
  entrance: string | null;
}
export type EntranceCollection = FeatureCollection<Point, EntranceProperties>;

export class EntranceLayer {
  private readonly groups = new Map<string, L.MarkerClusterGroup>();
  private readonly entries: { stationId: string; modes: TransitMode[]; marker: L.Marker }[];

  constructor(
    private readonly map: L.Map,
    data: EntranceCollection,
  ) {
    const icon = L.divIcon({ className: 'entrance-dot', iconSize: [8, 8], iconAnchor: [4, 4] });
    this.entries = data.features.map((feature) => {
      const properties = feature.properties;
      const [lon, lat] = feature.geometry.coordinates;
      const description = [
        properties.stations.join(' / '),
        properties.ref ? `Entrance ${properties.ref}` : 'Entrance',
        properties.name,
      ]
        .filter(Boolean)
        .join(' · ');
      const popup = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = description;
      popup.append(name);
      if (properties.lines.length) {
        const lines = document.createElement('p');
        lines.textContent = properties.lines.join(', ');
        popup.append(lines);
      }
      if (properties.entrance === 'exit' || ['private', 'no'].includes(properties.access ?? '')) {
        const access = document.createElement('p');
        access.textContent =
          properties.entrance === 'exit' ? 'Exit only' : `Access: ${properties.access}`;
        popup.append(access);
      }
      const source = document.createElement('a');
      source.href = properties.osmUrl;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.textContent = 'View entrance on OpenStreetMap';
      popup.append(source);
      const tooltip = document.createElement('span');
      tooltip.textContent = description;
      const marker = L.marker([lat, lon], { icon, title: description, alt: description })
        .bindTooltip(tooltip)
        .bindPopup(popup);
      const stationId = properties.stationId || String(feature.id);
      if (!this.groups.has(stationId)) {
        const stationName = properties.stations.join(' / ') || 'Station';
        this.groups.set(
          stationId,
          L.markerClusterGroup({
            maxClusterRadius: 40,
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true,
            zoomToBoundsOnClick: true,
            iconCreateFunction: () => {
              const label = document.createElement('span');
              label.title = `${stationName} · Click to expand entrances`;
              label.setAttribute('aria-label', label.title);
              return L.divIcon({
                html: label,
                className: 'entrance-dot entrance-cluster',
                iconSize: [8, 8],
                iconAnchor: [4, 4],
              });
            },
          }),
        );
      }
      return { stationId, modes: properties.modes, marker };
    });
  }

  showModes(modes: TransitMode[]): void {
    const visibleByStation = new Map<string, L.Marker[]>();
    for (const entry of this.entries) {
      if (!entry.modes.some((mode) => modes.includes(mode))) continue;
      const markers = visibleByStation.get(entry.stationId) ?? [];
      markers.push(entry.marker);
      visibleByStation.set(entry.stationId, markers);
    }
    for (const [stationId, group] of this.groups) {
      group.clearLayers();
      const markers = visibleByStation.get(stationId);
      if (markers?.length) {
        if (!this.map.hasLayer(group)) group.addTo(this.map);
        group.addLayers(markers);
      } else if (this.map.hasLayer(group)) {
        this.map.removeLayer(group);
      }
    }
  }
}
