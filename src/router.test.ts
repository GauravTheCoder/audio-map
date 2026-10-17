import { describe, expect, it } from 'vitest';
import { planRoute, type RouteOptions } from './router';
import type { GNode, Segment, Way, World } from './world';

const way = (name: string): Way => ({ id: 1, type: 'residential', name, named: true, bridge: false, tunnel: false, oneway: false, onewayReverse: false, roundabout: false });

// A(0,0) -north-> B(0,100) -east-> C(100,100), plus a spur B -> D(-100,100) so B is a real junction.
// Only the three World members planRoute uses are faked.
function build(): World {
  const oak = way('Oak Street');
  const elm = way('Elm Street');
  const pts: Record<number, [number, number]> = { 1: [0, 0], 2: [0, 100], 3: [100, 100], 4: [-100, 100] };
  const nodes = new Map<number, GNode>();
  for (const [id, [x, y]] of Object.entries(pts)) nodes.set(+id, { id: +id, x, y, edges: [], signals: false });
  const segs: Segment[] = [];
  const link = (a: number, b: number, w: Way) => {
    nodes.get(a)!.edges.push({ to: b, way: w, fwd: true });
    nodes.get(b)!.edges.push({ to: a, way: w, fwd: false });
    segs.push({ ax: pts[a][0], ay: pts[a][1], bx: pts[b][0], by: pts[b][1], a, b, way: w });
  };
  link(1, 2, oak);
  link(2, 3, elm);
  link(2, 4, elm);
  return {
    nodes,
    nearestRoad: (x: number, y: number) => ({ seg: segs[0], hit: { dist: 0, t: 0, px: x, py: y }, dir: 0 }),
    nodesNear: () => [...nodes.values()],
  } as unknown as World;
}

const opts: RouteOptions = { canUse: () => true, obeyOneway: true, costFactor: () => 1, minFactor: 1, uTurnPenalty: 50 };
const start = { x: 0, y: 0, heading: 0 };

describe('planRoute', () => {
  it('finds the L-shaped path and announces a right turn onto Elm Street', () => {
    const r = planRoute(build(), start, { x: 100, y: 100 }, opts)!;
    expect(r.length).toBeCloseTo(200);
    expect(r.partial).toBe(false);
    expect(r.maneuvers).toHaveLength(2);
    const [turn, arrive] = r.maneuvers;
    expect(turn).toMatchObject({ kind: 'turn', onto: 'Elm Street' });
    expect(turn.rel).toBeCloseTo(90);
    expect(turn.d).toBeCloseTo(100);
    expect(arrive.kind).toBe('arrive');
  });
  it('turns left towards the other spur', () => {
    const r = planRoute(build(), start, { x: -100, y: 100 }, opts)!;
    expect(r.maneuvers[0].kind).toBe('turn');
    expect(r.maneuvers[0].rel).toBeCloseTo(-90);
  });
  it('returns null when no road is nearby', () => {
    const w = { ...build(), nearestRoad: () => null } as unknown as World;
    expect(planRoute(w, start, { x: 100, y: 100 }, opts)).toBeNull();
  });
});
