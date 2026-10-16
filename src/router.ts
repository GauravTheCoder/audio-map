// Turn-by-turn routing on the loaded road graph (A*), and turning the path into manoeuvres.

import { bearing, dist, relAngle } from './geo';
import type { GNode, Way, World } from './world';

export interface RoutePoint {
  x: number;
  y: number;
  /** distance along the route, metres */
  d: number;
}

export interface Maneuver {
  x: number;
  y: number;
  d: number;
  /** turn angle, degrees: negative left, positive right */
  rel: number;
  kind: 'continue' | 'bear' | 'turn' | 'sharp' | 'u-turn' | 'arrive';
  onto: string;
  ontoNamed: boolean;
}

export interface Route {
  points: RoutePoint[];
  maneuvers: Maneuver[];
  length: number;
  /** the destination is beyond the loaded map; the route stops at the closest reachable point */
  partial: boolean;
}

export interface RouteOptions {
  canUse: (w: Way) => boolean;
  obeyOneway: boolean;
  /** cost per metre on this road relative to distance (lower = preferred) */
  costFactor: (w: Way) => number;
  /** smallest value costFactor can return (keeps the A* estimate admissible) */
  minFactor: number;
  /** extra cost, in metres, for setting off in the opposite direction to the current heading */
  uTurnPenalty: number;
}

const MAX_EXPANSIONS = 300_000;

export function planRoute(w: World, from: { x: number; y: number; heading: number }, to: { x: number; y: number }, o: RouteOptions): Route | null {
  const hit = w.nearestRoad(from.x, from.y, 60, o.canUse);
  if (!hit) return null;

  // goal: the usable node closest to the target
  let goal: GNode | null = null;
  let goalD = Infinity;
  const consider = (n: GNode) => {
    if (!n.edges.some((e) => o.canUse(e.way))) return;
    const d = dist(n.x, n.y, to.x, to.y);
    if (d < goalD) {
      goalD = d;
      goal = n;
    }
  };
  for (const n of w.nodesNear(to.x, to.y, 300)) consider(n);
  if (!goal) for (const n of w.nodes.values()) consider(n);
  if (!goal) return null;
  const goalNode: GNode = goal;

  const allowed = (wy: Way, fwd: boolean) => !o.obeyOneway || !wy.oneway || fwd !== wy.onewayReverse;

  // start on both ends of the current segment, penalising the one behind us
  const g = new Map<number, number>();
  const prev = new Map<number, number>();
  const via = new Map<number, Way>();
  const heap = new MinHeap();
  const seg = hit.seg;
  const forwards = Math.abs(relAngle(from.heading, hit.dir)) <= 90;
  for (const [id, alongWay] of [
    [seg.b, true],
    [seg.a, false],
  ] as const) {
    if (!allowed(seg.way, alongWay)) continue;
    const n = w.nodes.get(id)!;
    const behind = alongWay !== forwards;
    const cost = dist(hit.hit.px, hit.hit.py, n.x, n.y) * o.costFactor(seg.way) + (behind ? o.uTurnPenalty : 0);
    if (cost < (g.get(id) ?? Infinity)) {
      g.set(id, cost);
      via.set(id, seg.way);
      heap.push(cost + dist(n.x, n.y, goalNode.x, goalNode.y) * o.minFactor, id);
    }
  }

  // if the goal can't be reached (isolated road, one-way trap), fall back to the closest reachable node
  const closed = new Set<number>();
  let end: GNode | null = null;
  let closest: GNode | null = null;
  let closestD = Infinity;
  for (let i = 0; i < MAX_EXPANSIONS && heap.size; i++) {
    const id = heap.pop()!;
    if (closed.has(id)) continue;
    closed.add(id);
    const n = w.nodes.get(id)!;
    if (id === goalNode.id) {
      end = n;
      break;
    }
    const dn = dist(n.x, n.y, to.x, to.y);
    if (dn < closestD) {
      closestD = dn;
      closest = n;
    }
    const gn = g.get(id)!;
    for (const e of n.edges) {
      if (!o.canUse(e.way) || !allowed(e.way, e.fwd) || closed.has(e.to)) continue;
      const m = w.nodes.get(e.to)!;
      const cost = gn + dist(n.x, n.y, m.x, m.y) * o.costFactor(e.way);
      if (cost < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, cost);
        prev.set(e.to, id);
        via.set(e.to, e.way);
        heap.push(cost + dist(m.x, m.y, goalNode.x, goalNode.y) * o.minFactor, e.to);
      }
    }
  }
  if (!end) end = closest;
  if (!end) return null;
  const endD = dist(end.x, end.y, to.x, to.y);
  const partial = endD > 150;

  const path: GNode[] = [];
  for (let id: number | undefined = end.id; id !== undefined; id = prev.get(id)) path.push(w.nodes.get(id)!);
  path.reverse();

  const points: RoutePoint[] = [{ x: hit.hit.px, y: hit.hit.py, d: 0 }];
  const ways: (Way | null)[] = [null];
  const push = (x: number, y: number, way: Way | null) => {
    const last = points[points.length - 1];
    points.push({ x, y, d: last.d + dist(last.x, last.y, x, y) });
    ways.push(way);
  };
  for (const n of path) push(n.x, n.y, via.get(n.id) ?? null);
  if (!partial && endD > 3) push(to.x, to.y, null); // last stretch to the door

  return { points, maneuvers: maneuvers(path, points, ways, o), length: points[points.length - 1].d, partial };
}

/** Bearing of the route around point i, measured over ~15 m behind (dir -1) or ahead (dir +1). */
function routeBearing(points: RoutePoint[], i: number, dir: -1 | 1): number {
  const p = points[i];
  let j = i;
  while (j + dir >= 0 && j + dir < points.length) {
    j += dir;
    if (Math.abs(points[j].d - p.d) >= 15) break;
  }
  const q = points[j];
  return dir < 0 ? bearing(q.x, q.y, p.x, p.y) : bearing(p.x, p.y, q.x, q.y);
}

/** A U-turn only when doubling back along the same road; other very sharp turns are "sharp". */
function classify(rel: number, sameRoad: boolean): Maneuver['kind'] {
  const a = Math.abs(rel);
  if (a < 25) return 'continue';
  if (a < 60) return 'bear';
  if (a < 135) return 'turn';
  if (a < 170 || !sameRoad) return 'sharp';
  return 'u-turn';
}

function maneuvers(path: GNode[], points: RoutePoint[], ways: (Way | null)[], o: RouteOptions): Maneuver[] {
  const out: (Maneuver & { inName: string })[] = [];
  // points[k] is path[k - 1]; ways[k] is the road used to reach points[k]
  for (let k = 1; k < path.length; k++) {
    const node = path[k - 1];
    const inWay = ways[k];
    const outWay = ways[k + 1];
    if (!inWay || !outWay) continue;
    const rel = relAngle(routeBearing(points, k, -1), routeBearing(points, k, 1));
    const choice = node.edges.filter((e) => o.canUse(e.way)).length >= 3;
    if (!choice && Math.abs(rel) < 60) continue; // the road just curves
    const p = points[k];
    let m = { x: p.x, y: p.y, d: p.d, rel, kind: classify(rel, inWay === outWay), onto: outWay.name, ontoNamed: outWay.named, inName: inWay.name };
    // two turns close together (crossing a divided road, staggered junction): one combined manoeuvre
    const last = out[out.length - 1];
    if (last && m.d - last.d < 15) {
      out.pop();
      const r = relAngle(0, last.rel + rel);
      m = { ...m, rel: r, kind: classify(r, false), inName: last.inName };
    }
    // going straight on is only worth saying at a junction where the street name changes
    if (m.kind === 'continue' && (!choice || !m.ontoNamed || m.onto === m.inName)) continue;
    out.push(m);
  }
  const end = points[points.length - 1];
  const res: Maneuver[] = out.map(({ inName: _, ...m }) => m);
  res.push({ x: end.x, y: end.y, d: end.d, rel: 0, kind: 'arrive', onto: '', ontoNamed: false });
  return res;
}

/** Spoken form: "turn left onto Oak Street", "bear right onto the footpath", "make a U-turn". */
export function maneuverText(m: Maneuver, destName: string): string {
  if (m.kind === 'arrive') return `arrive at ${destName}`;
  if (m.kind === 'u-turn') return 'make a U-turn';
  const side = m.rel < 0 ? 'left' : 'right';
  const onto = m.ontoNamed ? m.onto : `the ${m.onto}`;
  if (m.kind === 'continue') return `continue onto ${onto}`;
  const verb = m.kind === 'bear' ? 'bear' : m.kind === 'sharp' ? 'turn sharp' : 'turn';
  return `${verb} ${side} onto ${onto}`;
}

/** Point at distance d along the route. */
export function pointAlong(r: Route, d: number): { x: number; y: number } {
  const pts = r.points;
  if (d <= 0) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].d >= d) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  return pts[pts.length - 1];
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size() {
    return this.keys.length;
  }

  push(key: number, val: number) {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }

  pop(): number | undefined {
    const k = this.keys;
    const v = this.vals;
    if (!k.length) return undefined;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}
