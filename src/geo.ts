// Local flat-earth projection (metres, x = east, y = north) around a fixed origin.
// Accurate enough for the few-kilometre areas we explore.

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Vec {
  x: number;
  y: number;
}

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON_EQ = 111_320;

export class Projection {
  private readonly cosLat: number;

  constructor(readonly origin: LatLon) {
    this.cosLat = Math.cos((origin.lat * Math.PI) / 180);
  }

  toXY(lat: number, lon: number): Vec {
    return {
      x: (lon - this.origin.lon) * M_PER_DEG_LON_EQ * this.cosLat,
      y: (lat - this.origin.lat) * M_PER_DEG_LAT,
    };
  }

  toLatLon(x: number, y: number): LatLon {
    return {
      lat: this.origin.lat + y / M_PER_DEG_LAT,
      lon: this.origin.lon + x / (M_PER_DEG_LON_EQ * this.cosLat),
    };
  }
}

/** Compass bearing in degrees (0 = north, clockwise) from a to b. */
export function bearing(ax: number, ay: number, bx: number, by: number): number {
  return normDeg((Math.atan2(bx - ax, by - ay) * 180) / Math.PI);
}

export function normDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Signed difference b - a in (-180, 180]. Positive means b is clockwise (to the right) of a. */
export function relAngle(a: number, b: number): number {
  let d = normDeg(b - a);
  if (d > 180) d -= 360;
  return d;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

const COMPASS_16 = [
  'north', 'north-north-east', 'north-east', 'east-north-east',
  'east', 'east-south-east', 'south-east', 'south-south-east',
  'south', 'south-south-west', 'south-west', 'west-south-west',
  'west', 'west-north-west', 'north-west', 'north-north-west',
];
const COMPASS_8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export function compass16(deg: number): string {
  return COMPASS_16[Math.round(normDeg(deg) / 22.5) % 16];
}

export function compass8(deg: number): string {
  return COMPASS_8[Math.round(normDeg(deg) / 45) % 8];
}

/** Clock-face direction relative to the traveller: 12 = straight ahead, 3 = right. */
export function clockDir(rel: number): string {
  let h = Math.round(normDeg(rel) / 30) % 12;
  if (h === 0) h = 12;
  return `${h} o'clock`;
}

/** Short spoken relative direction: "ahead", "slightly left", "right", "behind" ... */
export function sideWord(rel: number): string {
  const a = Math.abs(rel);
  const side = rel < 0 ? 'left' : 'right';
  if (a < 15) return 'ahead';
  if (a < 50) return `ahead ${side}`;
  if (a < 130) return `on your ${side}`;
  if (a < 165) return `behind ${side}`;
  return 'behind';
}

export interface SegHit {
  dist: number;
  t: number;
  px: number;
  py: number;
}

/** Closest point on segment ab to p. */
export function pointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): SegHit {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t, px: cx, py: cy };
}

/** Point d metres along a polyline, and its direction there. Past the end it carries straight on. */
export function alongLine(pts: { x: number; y: number; d: number }[], d: number): { x: number; y: number; dir: number } {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (b.d < d && i < pts.length - 1) continue;
    const len = b.d - a.d;
    if (len < 0.01) continue;
    const t = (d - a.d) / len; // > 1 on the last piece extends it
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dir: bearing(a.x, a.y, b.x, b.y) };
  }
  const p = pts[pts.length - 1];
  return { x: p.x, y: p.y, dir: 0 };
}

/**
 * The first bend in a road line: where the road turns at least minTurn degrees one way within
 * `span` metres. Gentle wobbles under 3° are ignored. at = distance to where the bend starts,
 * turn = total turn (negative left), keys = its corner points (so it is announced once).
 * Bends starting before `from` metres are skipped.
 */
export function findBend(
  pts: { x: number; y: number; d: number }[],
  minTurn: number,
  span: number,
  from = 0,
): { at: number; turn: number; length: number; keys: string[] } | null {
  const pieces: { d: number; b: number; x: number; y: number }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (b.d - a.d < 0.5) continue;
    pieces.push({ d: a.d, b: bearing(a.x, a.y, b.x, b.y), x: a.x, y: a.y });
  }
  const turns = pieces.slice(1).map((p, i) => ({ d: p.d, t: relAngle(pieces[i].b, p.b), key: `${Math.round(p.x)},${Math.round(p.y)}` }));
  for (let i = 0; i < turns.length; i++) {
    if (Math.abs(turns[i].t) < 3 || turns[i].d < from) continue;
    const sign = Math.sign(turns[i].t);
    let total = 0;
    let end = i;
    const add = (from: number, within: (j: number) => boolean) => {
      for (let j = from; j < turns.length && within(j); j++) {
        if (Math.abs(turns[j].t) < 3) continue;
        if (Math.sign(turns[j].t) !== sign) break;
        total += turns[j].t;
        end = j;
      }
    };
    add(i, (j) => turns[j].d - turns[i].d <= span);
    if (Math.abs(total) < minTurn) continue;
    add(end + 1, (j) => turns[j].d - turns[end].d <= span / 2); // a long curve: keep going while it keeps turning the same way
    return { at: turns[i].d, turn: total, length: turns[end].d - turns[i].d, keys: turns.slice(i, end + 1).map((t) => t.key) };
  }
  return null;
}
