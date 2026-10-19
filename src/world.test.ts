import { describe, expect, it } from 'vitest';
import { Projection } from './geo';
import { World } from './world';

const proj = new Projection({ lat: 51, lon: 0 });
const ll = (x: number, y: number) => proj.toLatLon(x, y);

// Oak Street runs north at x = 0; a footway runs north at x = 20; a service road east at y = 300
function world(): World {
  const pts: [number, number, number][] = [[1, 0, 0], [2, 0, 400], [3, 20, 0], [4, 20, 400], [5, -50, 300], [6, 50, 300]];
  return new World(proj, {
    nodes: new Map(pts.map(([id, x, y]) => [id, ll(x, y)])),
    ways: [
      { id: 1, nodes: [1, 2], tags: { highway: 'residential', name: 'Oak Street' } },
      { id: 2, nodes: [3, 4], tags: { highway: 'footway', name: 'Oak Walk' } },
      { id: 3, nodes: [5, 6], tags: { highway: 'service', name: 'Car Park Lane' } },
    ],
  });
}

describe('streetsCrossed', () => {
  it('finds a named street a line cuts across, and where', () => {
    const hits = world().streetsCrossed(-10, 100, 10, 100);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ name: 'Oak Street', t: 0.5 });
    expect(hits[0].x).toBeCloseTo(0);
  });

  it('ignores walking along a street, touching it at an end, footpaths and service roads', () => {
    const w = world();
    expect(w.streetsCrossed(0, 10, 0, 90)).toEqual([]); // along it
    expect(w.streetsCrossed(-10, 100, 0, 100)).toEqual([]); // ends on it
    expect(w.streetsCrossed(10, 100, 30, 100)).toEqual([]); // across the footway only
    expect(w.streetsCrossed(30, 290, 30, 310)).toEqual([]); // across the service road only
  });
});
