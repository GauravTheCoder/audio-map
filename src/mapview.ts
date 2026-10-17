// Visual map (MapLibre GL + OpenFreeMap vector tiles). Purely supplementary: hidden from screen readers.

import { Map as MlMap, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature, FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LatLon } from './geo';
import { applyLowVision } from './lowvision';

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// MapLibre looks for its worker next to its own script, which bundling breaks; ship it as a file
setWorkerUrl(workerUrl);

export class MapView {
  private map: MlMap;
  private ready = false;
  private trail: [number, number][] = [];
  private lastTrail = 0;
  private routeCoords: [number, number][] = [];
  private destCoords: [number, number][] = [];
  private pending: { pos: LatLon; heading: number; speed: number } | null = null;
  private lowVision = false;
  headingUp = true;

  constructor(container: HTMLElement, center: LatLon, lowVision = false) {
    this.lowVision = lowVision;
    this.map = new MlMap({
      container,
      style: STYLE,
      center: [center.lon, center.lat],
      zoom: 17,
      interactive: false,
      attributionControl: { compact: true },
      fadeDuration: 0,
    });
    // fires for the first style and again after every style switch, which drops our layers
    this.map.on('style.load', () => {
      if (this.lowVision) applyLowVision(this.map);
      this.addOverlays();
      this.ready = true;
      if (this.pending) this.update(this.pending.pos, this.pending.heading, this.pending.speed);
    });
  }

  /** Switch between the default look and the high-contrast low-vision look. */
  setLowVision(on: boolean) {
    if (on === this.lowVision) return;
    this.lowVision = on;
    this.ready = false;
    this.map.setStyle(STYLE, { diff: false });
  }

  /** Route, trail, destination, heading cone and position marker; larger and bolder in low vision. */
  private addOverlays() {
    const lv = this.lowVision;
    const m = this.map;
    m.addSource('route', { type: 'geojson', data: line(this.routeCoords) });
    if (lv) {
      m.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#000', 'line-width': 18 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
    }
    m.addLayer({
      id: 'route',
      type: 'line',
      source: 'route',
      paint: { 'line-color': lv ? '#ff2bd6' : '#7c4dff', 'line-width': lv ? 12 : 7, 'line-opacity': lv ? 1 : 0.75 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    m.addSource('trail', { type: 'geojson', data: line(this.trail) });
    m.addLayer({
      id: 'trail',
      type: 'line',
      source: 'trail',
      paint: { 'line-color': lv ? '#ff8c00' : '#ff3d7f', 'line-width': lv ? 6 : 4, 'line-opacity': lv ? 0.9 : 0.8 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    m.addSource('dest', { type: 'geojson', data: points(this.destCoords) });
    m.addLayer({
      id: 'dest',
      type: 'circle',
      source: 'dest',
      paint: lv
        ? { 'circle-radius': 16, 'circle-color': '#ff2bd6', 'circle-stroke-color': '#fff', 'circle-stroke-width': 4 }
        : { 'circle-radius': 9, 'circle-color': '#ffb300', 'circle-stroke-color': '#000', 'circle-stroke-width': 2 },
    });
    m.addSource('cone', { type: 'geojson', data: points([]) });
    m.addLayer({
      id: 'cone',
      type: 'fill',
      source: 'cone',
      paint: { 'fill-color': lv ? '#00ff66' : '#1e88e5', 'fill-opacity': lv ? 0.4 : 0.25 },
    });
    m.addSource('me', { type: 'geojson', data: points([]) });
    m.addLayer({
      id: 'me',
      type: 'circle',
      source: 'me',
      paint: lv
        ? { 'circle-radius': 15, 'circle-color': '#00ff66', 'circle-stroke-color': '#000', 'circle-stroke-width': 5 }
        : { 'circle-radius': 8, 'circle-color': '#1e88e5', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 },
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
    this.destCoords = p ? [[p.lon, p.lat]] : [];
    if (this.ready) (this.map.getSource('dest') as GeoJSONSource).setData(points(this.destCoords));
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
    (this.map.getSource('cone') as GeoJSONSource).setData(cone(pos, heading, (this.lowVision ? 30 : 40) + speed * 3));

    // low vision: a little closer in, so streets and names are bigger on screen
    const near = this.lowVision ? 18.6 : 18;
    const zoom = Math.max(14.5, Math.min(near, near - Math.log2(1 + speed / 4)));
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
