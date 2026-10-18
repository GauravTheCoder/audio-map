// What kind of ground a point is on: buildings, water, parks and land use, read from the same
// OpenFreeMap vector tiles the road map is built from. Used by grid mode.

import type { VectorTile } from '@mapbox/vector-tile';
import type { LatLon } from './geo';
import { EXTENT, fetchTile, tileX, tileY } from './tiles';
import { humanize } from './world';

/** Which short sound plays for an area. */
export type AreaSound = 'road' | 'path' | 'building' | 'water' | 'green' | 'sport' | 'residential' | 'commercial' | 'industrial' | 'civic' | 'farm' | 'bare' | 'open';

export interface Area {
  /** stays the same while you remain in the same area */
  key: string;
  /** what it is, e.g. "park" or "building" */
  kind: string;
  name?: string;
  sound: AreaSound;
}

interface Pt {
  x: number;
  y: number;
}

export interface AreaPoly {
  id: string;
  kind: string;
  sound: AreaSound;
  building: boolean;
  rings: Pt[][];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** in square tile units; the smallest area containing a point is the most specific */
  size: number;
  name?: string;
  /** name found from the labels inside it (null: none), worked out on first use */
  labelled?: string | null;
}

export interface AreaTile {
  polys: AreaPoly[];
  /** named points (shops, parks, lakes), used to name the area they sit in */
  labels: { x: number; y: number; name: string; rank: number }[];
}

const COVER: Record<string, [string, AreaSound]> = {
  park: ['park', 'green'],
  garden: ['garden', 'green'],
  grass: ['grass', 'green'],
  grassland: ['grass', 'green'],
  meadow: ['meadow', 'green'],
  village_green: ['green', 'green'],
  recreation_ground: ['recreation ground', 'green'],
  flowerbed: ['flower bed', 'green'],
  allotments: ['allotments', 'green'],
  golf_course: ['golf course', 'green'],
  scrub: ['scrubland', 'green'],
  heath: ['heath', 'green'],
  wood: ['woods', 'green'],
  forest: ['woods', 'green'],
  wetland: ['wetland', 'green'],
  beach: ['beach', 'bare'],
  sand: ['sand', 'bare'],
  bare_rock: ['rock', 'bare'],
  scree: ['rock', 'bare'],
  glacier: ['ice', 'bare'],
  farmland: ['farmland', 'farm'],
  farm: ['farmland', 'farm'],
  orchard: ['orchard', 'farm'],
  vineyard: ['vineyard', 'farm'],
};

const LANDUSE: Record<string, [string, AreaSound]> = {
  residential: ['residential area', 'residential'],
  commercial: ['commercial area', 'commercial'],
  retail: ['shopping area', 'commercial'],
  industrial: ['industrial area', 'industrial'],
  garages: ['garages', 'industrial'],
  railway: ['railway land', 'industrial'],
  military: ['military area', 'industrial'],
  quarry: ['quarry', 'industrial'],
  school: ['school grounds', 'civic'],
  kindergarten: ['kindergarten grounds', 'civic'],
  college: ['college grounds', 'civic'],
  university: ['university grounds', 'civic'],
  library: ['library grounds', 'civic'],
  hospital: ['hospital grounds', 'civic'],
  bus_station: ['bus station', 'civic'],
  cemetery: ['cemetery', 'civic'],
  zoo: ['zoo', 'civic'],
  theme_park: ['theme park', 'civic'],
  pitch: ['sports pitch', 'sport'],
  playground: ['playground', 'sport'],
  track: ['running track', 'sport'],
  stadium: ['stadium', 'sport'],
};

const WATER: Record<string, string> = { lake: 'lake', river: 'river', pond: 'pond', ocean: 'sea', swimming_pool: 'swimming pool', dock: 'dock' };
const PARK = new Set(['national_park', 'nature_reserve', 'protected_area']);

function ringArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x - r[i].x) * (r[j].y + r[i].y);
  return a / 2;
}

/** Even-odd test over all rings, so holes and multi-part areas both work. */
export function inRings(rings: Pt[][], x: number, y: number): boolean {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i];
      const b = r[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  return inside;
}

export function makePoly(id: string, kind: string, sound: AreaSound, rings: Pt[][], name?: string): AreaPoly {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings)
    for (const p of r) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  const size = Math.abs(rings.reduce((s, r) => s + ringArea(r), 0));
  return { id, kind, sound, building: sound === 'building', rings, minX, minY, maxX, maxY, size, name };
}

function readTile(vt: VectorTile): AreaTile {
  const polys: AreaPoly[] = [];
  const labels: AreaTile['labels'] = [];
  const each = (layer: string, fn: (p: Record<string, unknown>, rings: () => Pt[][], i: number, type: number) => void) => {
    const l = vt.layers[layer];
    for (let i = 0; i < (l?.length ?? 0); i++) {
      const f = l.feature(i);
      fn(f.properties, () => f.loadGeometry(), i, f.type);
    }
  };
  each('building', (_p, rings, i, type) => {
    if (type === 3) polys.push(makePoly(`b${i}`, 'building', 'building', rings()));
  });
  each('water', (p, rings, i, type) => {
    if (type === 3) polys.push(makePoly(`w${i}`, WATER[String(p.class)] ?? 'water', 'water', rings()));
  });
  each('landcover', (p, rings, i, type) => {
    const c = COVER[String(p.subclass ?? '')] ?? COVER[String(p.class ?? '')];
    if (type === 3 && c) polys.push(makePoly(`c${i}`, c[0], c[1], rings()));
  });
  each('landuse', (p, rings, i, type) => {
    const c = LANDUSE[String(p.class ?? '')];
    if (type === 3 && c) polys.push(makePoly(`u${i}`, c[0], c[1], rings()));
  });
  each('park', (p, rings, i, type) => {
    const cls = String(p.class ?? '');
    if (type === 3 && PARK.has(cls)) polys.push(makePoly(`p${i}`, humanize(cls), 'green', rings(), p.name ? String(p.name) : undefined));
  });
  for (const layer of ['poi', 'water_name']) {
    each(layer, (p, rings, _i, type) => {
      const q = rings()[0]?.[0];
      if (type === 1 && q && p.name) labels.push({ x: q.x, y: q.y, name: String(p.name), rank: Number(p.rank ?? 0) });
    });
  }
  labels.sort((a, b) => a.rank - b.rank);
  return { polys, labels };
}

/** A building if (x, y) is in one, otherwise the smallest area around it. */
function innermost(tile: AreaTile, x: number, y: number): AreaPoly | null {
  let best: AreaPoly | null = null;
  for (const p of tile.polys) {
    if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY || !inRings(p.rings, x, y)) continue;
    if (!best || (p.building && !best.building) || (p.building === best.building && p.size < best.size)) best = p;
  }
  return best;
}

/** The area at tile point (x, y), named by a label that belongs to it and not to something inside it. */
export function pickArea(tile: AreaTile, tileKey: string, x: number, y: number): Area {
  const b = innermost(tile, x, y);
  if (!b) return { key: 'open', kind: 'open ground', sound: 'open' };
  if (b.labelled === undefined) {
    const inside = (l: { x: number; y: number }) => l.x >= b.minX && l.x <= b.maxX && l.y >= b.minY && l.y <= b.maxY && inRings(b.rings, l.x, l.y);
    b.labelled = tile.labels.find((l) => inside(l) && innermost(tile, l.x, l.y) === b)?.name ?? null;
  }
  return { key: `${tileKey}/${b.id}`, kind: b.kind, name: b.name ?? b.labelled ?? undefined, sound: b.sound };
}

/** "Hyde Park" rather than "Hyde Park, park"; "Tesco, building"; "park". */
export function areaText(a: Area): string {
  if (!a.name) return a.kind;
  const last = a.kind.split(' ')[0];
  return a.name.toLowerCase().includes(last) ? a.name : `${a.name}, ${a.kind}`;
}

/** Tiles read so far, kept for the few most recently used. */
export class AreaMap {
  private tiles = new Map<string, Promise<AreaTile>>();

  async at(p: LatLon): Promise<Area> {
    const gx = tileX(p.lon);
    const gy = tileY(p.lat);
    const tx = Math.floor(gx);
    const ty = Math.floor(gy);
    const key = `${tx},${ty}`;
    let t = this.tiles.get(key);
    if (t) this.tiles.delete(key); // re-insert as most recent
    else {
      t = fetchTile(tx, ty).then(readTile);
      t.catch(() => this.tiles.delete(key)); // try again next time
    }
    this.tiles.set(key, t);
    while (this.tiles.size > 12) this.tiles.delete(this.tiles.keys().next().value!);
    return pickArea(await t, key, (gx - tx) * EXTENT, (gy - ty) * EXTENT);
  }

  /** True if the tile under p has been read already. */
  has(p: LatLon): boolean {
    return this.tiles.has(`${Math.floor(tileX(p.lon))},${Math.floor(tileY(p.lat))}`);
  }
}
