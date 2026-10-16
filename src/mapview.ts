// Visual map (MapLibre GL + OpenFreeMap vector tiles). Purely supplementary: hidden from screen readers.

import { Map as MlMap, type GeoJSONSource } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LatLon } from './geo';

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export class MapView {
  private map: MlMap;
  private ready = false;
  private trail: [number, number][] = [];
  private lastTrail = 0;
  private routeCoords: [number, number][] = [];
  private pending: { pos: LatLon; heading: number; speed: number } | null = null;
  headingUp = true;

  constructor(container: HTMLElement, center: LatLon) {
    this.map = new MlMap({
      container,
      style: STYLE,
      center: [center.lon, center.lat],
      zoom: 17,
      interactive: false,
      attributionControl: { compact: true },
      fadeDuration: 0,
    });
    this.map.on('load', () => {
      this.map.addSource('route', { type: 'geojson', data: line(this.routeCoords) });
      this.map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#7c4dff', 'line-width': 7, 'line-opacity': 0.75 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
      this.map.addSource('trail', { type: 'geojson', data: line([]) });
      this.map.addLayer({
        id: 'trail',
        type: 'line',
        source: 'trail',
        paint: { 'line-color': '#ff3d7f', 'line-width': 4, 'line-opacity': 0.8 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
      this.map.addSource('dest', { type: 'geojson', data: points([]) });
      this.map.addLayer({
        id: 'dest',
        type: 'circle',
        source: 'dest',
        paint: { 'circle-radius': 9, 'circle-color': '#ffb300', 'circle-stroke-color': '#000', 'circle-stroke-width': 2 },
      });
      this.map.addSource('cone', { type: 'geojson', data: points([]) });
      this.map.addLayer({
        id: 'cone',
        type: 'fill',
        source: 'cone',
        paint: { 'fill-color': '#1e88e5', 'fill-opacity': 0.25 },
      });
      this.map.addSource('me', { type: 'geojson', data: points([]) });
      this.map.addLayer({
        id: 'me',
        type: 'circle',
        source: 'me',
        paint: { 'circle-radius': 8, 'circle-color': '#1e88e5', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 },
      });
      this.ready = true;
      if (this.pending) this.update(this.pending.pos, this.pending.heading, this.pending.speed);
    });
  }

  resize() {
    this.map.resize();
  }

  resetTrail() {
    this.trail = [];
  }

  /** Planned route for turn-by-turn guidance (null to clear). */
  setRoute(pts: LatLon[] | null) {
    this.routeCoords = (pts ?? []).map((p) => [p.lon, p.lat] as [number, number]);
    if (this.ready) (this.map.getSource('route') as GeoJSONSource).setData(line(this.routeCoords));
  }

  setDestination(p: LatLon | null) {
    if (!this.ready) return;
    (this.map.getSource('dest') as GeoJSONSource).setData(points(p ? [[p.lon, p.lat]] : []));
  }

  update(pos: LatLon, heading: number, speed: number) {
    if (!this.ready) {
      this.pending = { pos, heading, speed };
      return;
    }
    const now = performance.now();
    const last = this.trail[this.trail.length - 1];
    if (now - this.lastTrail > 250 && (!last || last[0] !== pos.lon || last[1] !== pos.lat)) {
      this.trail.push([pos.lon, pos.lat]);
      if (this.trail.length > 4000) this.trail.shift();
      this.lastTrail = now;
      (this.map.getSource('trail') as GeoJSONSource).setData(line(this.trail));
    }
    (this.map.getSource('me') as GeoJSONSource).setData(points([[pos.lon, pos.lat]]));
    (this.map.getSource('cone') as GeoJSONSource).setData(cone(pos, heading, 40 + speed * 3));

    const zoom = Math.max(14, Math.min(18, 18 - Math.log2(1 + speed / 4)));
    this.map.jumpTo({
      center: [pos.lon, pos.lat],
      bearing: this.headingUp ? heading : 0,
      zoom: this.map.getZoom() + (zoom - this.map.getZoom()) * 0.05,
    });
  }
}

function line(coords: [number, number][]): Feature {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
}

function points(coords: [number, number][]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: coords.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })),
  };
}

function cone(pos: LatLon, heading: number, lenM: number): Feature {
  const mLat = 1 / 110540;
  const mLon = 1 / (111320 * Math.cos((pos.lat * Math.PI) / 180));
  const pts: [number, number][] = [[pos.lon, pos.lat]];
  for (const off of [-20, -10, 0, 10, 20]) {
    const r = ((heading + off) * Math.PI) / 180;
    pts.push([pos.lon + Math.sin(r) * lenM * mLon, pos.lat + Math.cos(r) * lenM * mLat]);
  }
  pts.push([pos.lon, pos.lat]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
}
