// What kind of ground a point is on: buildings, water, parks and land use, read from the same
// OpenFreeMap vector tiles the road map is built from. Used by grid mode.

import type { VectorTile } from '@mapbox/vector-tile';
import type { LatLon } from './geo';
import { EXTENT, Z, fetchTile, tileX, tileY } from './tiles';
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
  /** a building's house number, when it has no name */
  number?: string;
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
  /** the label classes that can name it (a university from a university, a park from a park); any for a building */
  namedBy?: string[];
  /** name found from the labels inside it (null: none), worked out on first use */
  labelled?: string | null;
  /** house number found inside it (null: none), worked out on first use */
  numbered?: string | null;
}

export interface Label {
  x: number;
  y: number;
  name: string;
  rank: number;
  /** its class and subclass in the tiles, e.g. "college" and "university" */
  cls: string;
  sub: string;
}

export interface AreaTile {
  polys: AreaPoly[];
  /** named points (shops, parks, lakes), used to name the area they sit in */
  labels: Label[];
  /** neighbourhoods and suburbs, by their centre point */
  hoods?: { x: number; y: number; name: string }[];
  /** house numbers, at the address point (usually inside the building) */
  numbers?: { x: number; y: number; num: string }[];
}

/** The place classes that are neighbourhoods of a town, not towns or countries. */
// not isolated_dwelling: often one farmhouse, and "near Rose Cottage" sounds like a place you are at
const HOOD = new Set(['suburb', 'quarter', 'neighbourhood', 'hamlet', 'village']);

/** Points that are on or beside a building or campus rather than what it is called: stops, entrances, lakes. */
const NOT_A_NAME = new Set(['bus', 'railway', 'aerialway', 'entrance', 'ferry_terminal', 'water']);

function canName(p: AreaPoly, l: Label): boolean {
  return p.namedBy ? p.namedBy.includes(l.cls) : !NOT_A_NAME.has(l.cls);
}

/** Label classes that name each kind of ground; the rest (homes, shops, industry) stay unnamed. */
const LANDUSE_LABEL: Record<string, string[]> = {
  school: ['school'],
  kindergarten: ['school'],
  college: ['college'],
  university: ['college'],
  hospital: ['hospital'],
  cemetery: ['cemetery'],
  stadium: ['stadium'],
  zoo: ['zoo'],
  pitch: ['pitch'],
  playground: ['playground'],
};

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

/**
 * The tiles merge alike areas (all of a campus, a street of buildings) into one feature. Split it
 * into each outline with its holes: an outline turns the same way as the first, a hole the other way.
 */
export function splitPolygons(rings: Pt[][]): Pt[][][] {
  const out: Pt[][][] = [];
  let sign = 0;
  for (const r of rings) {
    const a = ringArea(r);
    if (!a) continue;
    sign ||= Math.sign(a);
    if (Math.sign(a) === sign) out.push([r]);
    else out[out.length - 1]?.push(r);
  }
  return out;
}

export function makePoly(id: string, kind: string, sound: AreaSound, rings: Pt[][], name?: string, namedBy?: string[]): AreaPoly {
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
  return { id, kind, sound, building: sound === 'building', rings, minX, minY, maxX, maxY, size, name, namedBy };
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
  const add = (id: string, kind: string, sound: AreaSound, rings: Pt[][], name?: string, namedBy?: string[]) =>
    splitPolygons(rings).forEach((part, k) => polys.push(makePoly(`${id}.${k}`, kind, sound, part, name, namedBy)));
  each('building', (_p, rings, i, type) => {
    if (type === 3) add(`b${i}`, 'building', 'building', rings());
  });
  each('water', (p, rings, i, type) => {
    const cls = String(p.class ?? '');
    if (type === 3) add(`w${i}`, WATER[cls] ?? 'water', 'water', rings(), undefined, ['water']);
  });
  each('landcover', (p, rings, i, type) => {
    const sub = String(p.subclass ?? '');
    const cls = String(p.class ?? '');
    const c = COVER[sub] ?? COVER[cls];
    if (type === 3 && c) add(`c${i}`, c[0], c[1], rings(), undefined, sub === 'park' || sub === 'garden' ? ['park', 'garden'] : []);
  });
  each('landuse', (p, rings, i, type) => {
    const cls = String(p.class ?? '');
    const c = LANDUSE[cls];
    if (type === 3 && c) add(`u${i}`, c[0], c[1], rings(), undefined, LANDUSE_LABEL[cls] ?? []);
  });
  each('park', (p, rings, i, type) => {
    const cls = String(p.class ?? '');
    if (type === 3 && PARK.has(cls)) add(`p${i}`, humanize(cls), 'green', rings(), p.name ? String(p.name) : undefined, []);
  });
  each('poi', (p, rings, _i, type) => {
    const q = rings()[0]?.[0];
    if (type === 1 && q && p.name) labels.push({ x: q.x, y: q.y, name: String(p.name), rank: Number(p.rank ?? 0), cls: String(p.class ?? ''), sub: String(p.subclass ?? '') });
  });
  each('water_name', (p, rings, _i, type) => {
    const q = rings()[0]?.[0];
    if (type === 1 && q && p.name) labels.push({ x: q.x, y: q.y, name: String(p.name), rank: 0, cls: 'water', sub: String(p.class ?? '') });
  });
  labels.sort((a, b) => a.rank - b.rank);
  const hoods: NonNullable<AreaTile['hoods']> = [];
  each('place', (p, rings, _i, type) => {
    const q = rings()[0]?.[0];
    if (type === 1 && q && p.name && HOOD.has(String(p.class))) hoods.push({ x: q.x, y: q.y, name: String(p.name) });
  });
  const numbers: NonNullable<AreaTile['numbers']> = [];
  each('housenumber', (p, rings, _i, type) => {
    const q = rings()[0]?.[0];
    if (type === 1 && q && p.housenumber) numbers.push({ x: q.x, y: q.y, num: String(p.housenumber) });
  });
  return { polys, labels, hoods, numbers };
}

/** A building if (x, y) is in one, otherwise the smallest area around it. */
function innermost(tile: AreaTile, x: number, y: number, buildings = true): AreaPoly | null {
  let best: AreaPoly | null = null;
  for (const p of tile.polys) {
    if ((!buildings && p.building) || x < p.minX || x > p.maxX || y < p.minY || y > p.maxY || !inRings(p.rings, x, y)) continue;
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
    // a university's label may sit in one of its buildings: it still names the grounds
    const names = new Set(tile.labels.filter((l) => canName(b, l) && inside(l) && innermost(tile, l.x, l.y, b.building) === b).map((l) => l.name));
    // a building takes its best-known occupant; grounds only an unambiguous name (a campus has many)
    b.labelled = b.building ? ([...names][0] ?? null) : names.size === 1 ? [...names][0] : null;
  }
  const name = b.name ?? b.labelled ?? undefined;
  if (b.building && !name && b.numbered === undefined) {
    const inside = (n: { x: number; y: number }) => n.x >= b.minX && n.x <= b.maxX && n.y >= b.minY && n.y <= b.maxY && inRings(b.rings, n.x, n.y);
    const nums = [...new Set((tile.numbers ?? []).filter(inside).map((n) => n.num))];
    b.numbered = nums.length === 1 ? nums[0] : null; // a block of several addresses has no one number
  }
  return { key: `${tileKey}/${b.id}`, kind: b.kind, name, sound: b.sound, number: (!name && b.numbered) || undefined };
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

  private tile(tx: number, ty: number): Promise<AreaTile> {
    const key = `${tx},${ty}`;
    let t = this.tiles.get(key);
    if (t) this.tiles.delete(key); // re-insert as most recent
    else {
      t = fetchTile(tx, ty).then(readTile);
      t.catch(() => this.tiles.delete(key)); // try again next time
    }
    this.tiles.set(key, t);
    while (this.tiles.size > 16) this.tiles.delete(this.tiles.keys().next().value!);
    return t;
  }

  async at(p: LatLon): Promise<Area> {
    const gx = tileX(p.lon);
    const gy = tileY(p.lat);
    const tx = Math.floor(gx);
    const ty = Math.floor(gy);
    return pickArea(await this.tile(tx, ty), `${tx},${ty}`, (gx - tx) * EXTENT, (gy - ty) * EXTENT);
  }

  /**
   * The neighbourhood whose centre is nearest, within `within` metres; null if none is. Tiles give
   * a centre point, not a boundary, so near a border this can be the neighbouring one: say "near".
   */
  async hood(p: LatLon, within = 1000): Promise<string | null> {
    const gx = tileX(p.lon) * EXTENT;
    const gy = tileY(p.lat) * EXTENT;
    const perUnit = (40_075_016.686 * Math.cos((p.lat * Math.PI) / 180)) / (2 ** Z * EXTENT); // metres per tile unit
    const r = within / perUnit;
    let best: { name: string; d: number } | null = null;
    for (let tx = Math.floor((gx - r) / EXTENT); tx <= Math.floor((gx + r) / EXTENT); tx++)
      for (let ty = Math.floor((gy - r) / EXTENT); ty <= Math.floor((gy + r) / EXTENT); ty++) {
        let t: AreaTile;
        try {
          t = await this.tile(tx, ty);
        } catch {
          continue;
        }
        for (const h of t.hoods ?? []) {
          const d = Math.hypot(tx * EXTENT + h.x - gx, ty * EXTENT + h.y - gy);
          if (d <= r && (!best || d < best.d)) best = { name: h.name, d };
        }
      }
    return best?.name ?? null;
  }

  /** True if the tile under p has been read already. */
  has(p: LatLon): boolean {
    return this.tiles.has(`${Math.floor(tileX(p.lon))},${Math.floor(tileY(p.lat))}`);
  }
}
