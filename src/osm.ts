// Fetches roads and named places from OpenStreetMap (Overpass API) and geocodes via Nominatim.
// Public Overpass servers are often busy, so requests rotate across mirrors with backoff,
// and responses are kept in Cache Storage so revisiting an area is instant.

import type { LatLon } from './geo';

export interface RawWay {
  id: number;
  nodes: number[];
  tags: Record<string, string>;
}

export interface RawPlace {
  id: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
  /** doors on the outline of a place mapped as a building */
  entrances?: { lat: number; lon: number; tags: Record<string, string> }[];
}

export interface RawRoads {
  nodes: Map<number, LatLon>;
  ways: RawWay[];
  /** the area loaded (south, west, north, east): roads are cut off at its edges */
  box?: [number, number, number, number];
}

export interface RawPlaces {
  places: RawPlace[];
  signals: Set<number>;
  /** spots to warn about on foot: pedestrian crossings and level crossings */
  crossings?: { lat: number; lon: number; text: string; extras?: string[] }[];
  /** entrances, platforms and lifts, for finding your way in stations and buildings */
  access?: { lat: number; lon: number; kind: AccessKind; name?: string }[];
}

export type AccessKind = 'entrance' | 'platform' | 'lift';

export function accessKind(t: Record<string, string>): AccessKind | null {
  if (t.entrance || t.railway === 'subway_entrance') return 'entrance';
  if (t.public_transport === 'platform' || t.railway === 'platform') return 'platform';
  if (t.highway === 'elevator' || t.elevator === 'yes') return 'lift';
  return null;
}

export type RetryNotice = (attempt: number) => void;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const MAX_ATTEMPTS = 8;
const REQUEST_TIMEOUT_MS = 60_000;
const CACHE_NAME = 'audio-map-overpass-v1';
const CACHE_MAX_AGE_MS = 14 * 24 * 3600 * 1000;

export const HIGHWAYS =
  'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|' +
  'tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|' +
  'footway|path|cycleway|steps|track';

/** Bounding box around a centre snapped to a ~200 m grid so nearby loads share cache entries. */
function bbox(c: LatLon, r: number): string {
  const lat = Math.round(c.lat / 0.002) * 0.002;
  const lon = Math.round(c.lon / 0.002) * 0.002;
  const dLat = r / 110_540;
  const dLon = r / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(5)).join(',');
}

export interface OverpassEl {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  nodes?: number[];
  tags?: Record<string, string>;
}

export async function fetchRoads(center: LatLon, radius: number, signal: AbortSignal, onRetry?: RetryNotice): Promise<RawRoads> {
  return queryRoads(bbox(center, radius), HIGHWAYS, signal, onRetry);
}

/**
 * Roads inside a rectangle, e.g. the corridor between the traveller and a distant destination.
 * `types` limits the road types ("primary|residential|…") to keep large areas small.
 */
export async function fetchRoadsBox(
  south: number,
  west: number,
  north: number,
  east: number,
  types: string,
  signal: AbortSignal,
  onRetry?: RetryNotice,
): Promise<RawRoads> {
  // round outward to ~100 m so similar requests share a cache entry
  const box = [Math.floor(south * 1000) / 1000, Math.floor(west * 1000) / 1000, Math.ceil(north * 1000) / 1000, Math.ceil(east * 1000) / 1000];
  return queryRoads(box.map((v) => v.toFixed(3)).join(','), types, signal, onRetry);
}

async function queryRoads(box: string, types: string, signal: AbortSignal, onRetry?: RetryNotice): Promise<RawRoads> {
  const q = `[out:json][timeout:90][bbox:${box}];
way["highway"~"^(${types})$"]->.roads;
.roads out body qt;
.roads >;
out skel qt;`;
  const nodes = new Map<number, LatLon>();
  const ways: RawWay[] = [];
  for (const el of await overpass(q, signal, onRetry)) {
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) nodes.set(el.id, { lat: el.lat, lon: el.lon });
    else if (el.type === 'way' && el.nodes && el.tags?.highway) ways.push({ id: el.id, nodes: el.nodes, tags: el.tags });
  }
  const [s, w, n, e] = box.split(',').map(Number);
  return { nodes, ways, box: [s, w, n, e] };
}

export async function fetchPlaces(center: LatLon, radius: number, signal: AbortSignal, onRetry?: RetryNotice): Promise<RawPlaces> {
  // ways come with their node ids, so doors on a building's outline can be matched to it
  const q = `[out:json][timeout:50][bbox:${bbox(center, radius)}];
(
  nwr["amenity"]["name"];
  nwr["shop"]["name"];
  nwr["tourism"]["name"];
  nwr["leisure"]["name"];
  nwr["historic"]["name"];
  nwr["railway"="station"]["name"];
)->.named;
node.named;
out center tags qt;
rel.named;
out center tags qt;
way.named;
out body center qt;
node(w)["entrance"]["entrance"!~"^(emergency|service|exit|garage|staircase|no)$"];
out qt;
(
  node["highway"="bus_stop"];
  node["railway"~"^(tram_stop|subway_entrance|train_station_entrance)$"];
  nwr["railway"="platform"]["ref"];
  node["highway"="traffic_signals"];
  node["highway"="crossing"];
  node["railway"="level_crossing"];
  nwr["entrance"];
  node["railway"="subway_entrance"];
  nwr["public_transport"="platform"];
  nwr["railway"="platform"];
  node["highway"="elevator"];
  node["elevator"="yes"];
);
out center tags qt;`;
  return parsePlaces(await overpass(q, signal, onRetry));
}

/** Accessibility details of a crossing or signal, as spoken. */
export function crossingExtras(t: Record<string, string>): string[] {
  const out: string[] = [];
  if (t['traffic_signals:sound'] === 'yes' || t['traffic_signals:sound'] === 'walk' || t['traffic_signals:sound'] === 'locate') out.push('audible signal');
  if (t['traffic_signals:vibration'] === 'yes') out.push('vibrating button');
  else if (t.button_operated === 'yes') out.push('push button');
  if (t['crossing:island'] === 'yes' || t.crossing === 'island') out.push('island in the middle');
  if (t.tactile_paving === 'yes') out.push('tactile paving');
  return out;
}

const SKIP_DOOR = /^(emergency|service|exit|garage|staircase|no)$/;

export function parsePlaces(els: OverpassEl[]): RawPlaces {
  const places: RawPlace[] = [];
  const signals = new Set<number>();
  const crossings: NonNullable<RawPlaces['crossings']> = [];
  const access: NonNullable<RawPlaces['access']> = [];
  // door node id -> places whose outline it is on
  const doorOf = new Map<number, RawPlace[]>();
  const doors: OverpassEl[] = [];
  for (const el of els) {
    const t = el.tags;
    if (!t) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const kind = accessKind(t);
    if (kind) access.push({ lat, lon, kind, name: t.name ?? t.ref });
    if (t.entrance && el.type === 'node' && !t.amenity && !t.shop && !t.railway && !t.highway) {
      doors.push(el);
      continue;
    }
    if (t.highway === 'traffic_signals') {
      if (el.type === 'node') signals.add(el.id);
      // a crossing mapped on the signal node itself
      if ((t.crossing && t.crossing !== 'no') || crossingExtras(t).length) crossings.push({ lat, lon, text: 'Crossing with signals', extras: crossingExtras(t) });
    } else if (t.highway === 'crossing') {
      crossings.push({ lat, lon, text: t.crossing === 'traffic_signals' ? 'Crossing with signals' : 'Pedestrian crossing', extras: crossingExtras(t) });
    } else if (t.railway === 'level_crossing') {
      crossings.push({ lat, lon, text: 'Railway crossing' });
    } else if (t.highway === 'bus_stop') {
      places.push({ id: `n${el.id}`, lat, lon, tags: { ...t, name: t.name ?? 'Bus stop' } });
    } else if (t.railway === 'tram_stop') {
      places.push({ id: `n${el.id}`, lat, lon, tags: { ...t, name: t.name ?? 'Tram stop' } });
    } else if (t.railway === 'subway_entrance' || t.railway === 'train_station_entrance') {
      places.push({ id: `n${el.id}`, lat, lon, tags: t });
    } else if (t.railway === 'platform') {
      places.push({ id: `${el.type[0]}${el.id}`, lat, lon, tags: { ...t, name: t.name ?? `Platform ${t.ref}` } });
    } else if (t.name) {
      const place: RawPlace = { id: `${el.type[0]}${el.id}`, lat, lon, tags: t };
      places.push(place);
      for (const nid of el.nodes ?? []) {
        const list = doorOf.get(nid);
        if (list) list.push(place);
        else doorOf.set(nid, [place]);
      }
    }
  }
  for (const d of doors) {
    if (SKIP_DOOR.test(d.tags!.entrance)) continue;
    for (const p of doorOf.get(d.id) ?? []) (p.entrances ??= []).push({ lat: d.lat!, lon: d.lon!, tags: d.tags! });
  }
  return { places, signals, crossings, access };
}

/** A bus or tram line calling at a stop, e.g. { ref: '5E', to: 'Lincoln Square' }. */
export interface StopRoute {
  ref: string;
  to?: string;
}

/** The lines that call at one stop (an OSM node), from the route relations it belongs to. */
export async function fetchStopRoutes(nodeId: number, signal?: AbortSignal): Promise<StopRoute[]> {
  const q = `[out:json][timeout:25];
node(${nodeId});
rel(bn)["route"~"^(bus|trolleybus|tram|minibus|share_taxi|light_rail)$"];
out tags qt;`;
  const seen = new Set<string>();
  const out: StopRoute[] = [];
  for (const el of await overpass(q, signal ?? new AbortController().signal)) {
    const t = el.tags ?? {};
    const ref = t.ref ?? t.name;
    if (!ref) continue;
    const key = `${ref}|${t.to ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ref, to: t.to });
  }
  // a line listed both with and without its destination: keep the one that says where it goes
  const known = new Set(out.filter((r) => r.to).map((r) => r.ref));
  return out
    .filter((r) => r.to || !known.has(r.ref))
    .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
}

async function overpass(query: string, signal: AbortSignal, onRetry?: RetryNotice): Promise<OverpassEl[]> {
  const key = `https://audio-map.cache/overpass/${await sha1(query)}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal.aborted) throw signal.reason;
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status} from ${url}`);
      const json = (await res.json()) as { elements: OverpassEl[]; remark?: string };
      // Overpass reports timeouts and memory errors as a 200 with a remark and partial data.
      if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
      void cachePut(key, json.elements);
      return json.elements;
    } catch (e) {
      if (signal.aborted) throw e;
      lastErr = e;
      console.warn(e);
      if (attempt > 0) onRetry?.(attempt);
      // first retry immediately on another mirror, then back off
      await sleep(attempt === 0 ? 0 : Math.min(8000, 1000 * 2 ** (attempt - 1)), signal);
    }
  }
  throw lastErr ?? new Error('Map data unavailable');
}

async function cacheGet(key: string): Promise<OverpassEl[] | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(key);
    if (!res) return null;
    const saved = Number(res.headers.get('x-saved') ?? 0);
    if (Date.now() - saved > CACHE_MAX_AGE_MS) {
      void cache.delete(key);
      return null;
    }
    return (await res.json()) as OverpassEl[];
  } catch {
    return null; // Cache Storage unavailable (private mode, insecure origin)
  }
}

async function cachePut(key: string, elements: OverpassEl[]) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      key,
      new Response(JSON.stringify(elements), { headers: { 'Content-Type': 'application/json', 'x-saved': String(Date.now()) } }),
    );
  } catch {
    // ignore
  }
}

async function sha1(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export interface GeocodeResult {
  name: string;
  lat: number;
  lon: number;
  /** rough radius of the place in metres (0 for a point), from its bounding box */
  radius: number;
}

/** Search for places. With `near`, results around that point are preferred (not required). */
export async function geocode(q: string, near?: LatLon): Promise<GeocodeResult[]> {
  let url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
  if (near) {
    const d = 0.15; // ~15 km
    url += `&viewbox=${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`;
  }
  const res = await fetch(url, { headers: { 'Accept-Language': navigator.language || 'en' } });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = (await res.json()) as { display_name: string; lat: string; lon: string; boundingbox?: string[] }[];
  return json.map((r) => {
    let radius = 0;
    if (r.boundingbox?.length === 4) {
      const [s, n, w, e] = r.boundingbox.map(parseFloat);
      const lat = parseFloat(r.lat);
      const h = (n - s) * 110_540;
      const wd = (e - w) * 111_320 * Math.cos((lat * Math.PI) / 180);
      radius = Math.min(h, wd) / 2;
    }
    return { name: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon), radius };
  });
}

export async function reverseGeocode(p: LatLon): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${p.lat}&lon=${p.lon}`;
    const res = await fetch(url, { headers: { 'Accept-Language': navigator.language || 'en' } });
    if (!res.ok) return null;
    const json = (await res.json()) as { address?: Record<string, string> };
    const a = json.address ?? {};
    const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district;
    const city = a.city ?? a.town ?? a.village;
    return [area, city].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}
