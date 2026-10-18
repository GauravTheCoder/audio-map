import { describe, expect, it } from 'vitest';
import { areaText, inRings, makePoly, pickArea, type AreaTile } from './areas';

const square = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('inRings', () => {
  it('treats an inner ring as a hole', () => {
    const rings = [square(0, 0, 100, 100), square(40, 40, 60, 60)];
    expect(inRings(rings, 10, 10)).toBe(true);
    expect(inRings(rings, 50, 50)).toBe(false);
    expect(inRings(rings, 150, 50)).toBe(false);
  });
});

describe('pickArea', () => {
  const tile: AreaTile = {
    polys: [
      makePoly('u1', 'residential area', 'residential', [square(0, 0, 1000, 1000)]),
      makePoly('c1', 'park', 'green', [square(100, 100, 400, 400)]),
      makePoly('b1', 'building', 'building', [square(500, 500, 600, 600)]),
      makePoly('c2', 'grass', 'green', [square(450, 450, 700, 700)]),
    ],
    labels: [
      { x: 200, y: 200, name: 'Victoria Park', rank: 1 },
      { x: 550, y: 550, name: 'Corner Shop', rank: 5 },
    ],
  };

  it('picks the smallest area around the point, named from a label inside it', () => {
    expect(pickArea(tile, 't', 150, 150)).toEqual({ key: 't/c1', kind: 'park', name: 'Victoria Park', sound: 'green' });
    expect(pickArea(tile, 't', 900, 900)).toMatchObject({ kind: 'residential area', name: undefined });
  });

  it('prefers a building over the larger ground around it', () => {
    expect(pickArea(tile, 't', 550, 550)).toMatchObject({ key: 't/b1', kind: 'building', name: 'Corner Shop' });
  });

  it('falls back to open ground', () => {
    expect(pickArea(tile, 't', 2000, 2000)).toEqual({ key: 'open', kind: 'open ground', sound: 'open' });
  });
});

describe('areaText', () => {
  it('drops the kind when the name already says it', () => {
    expect(areaText({ key: '', kind: 'park', name: 'Victoria Park', sound: 'green' })).toBe('Victoria Park');
    expect(areaText({ key: '', kind: 'building', name: 'Corner Shop', sound: 'building' })).toBe('Corner Shop, building');
    expect(areaText({ key: '', kind: 'lake', sound: 'water' })).toBe('lake');
  });
});
