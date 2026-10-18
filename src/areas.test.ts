import { describe, expect, it } from 'vitest';
import { areaText, inRings, makePoly, pickArea, splitPolygons, type AreaTile } from './areas';

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

describe('splitPolygons', () => {
  it('splits a merged feature into each outline with its holes', () => {
    const cw = square(0, 0, 100, 100);
    const hole = [...square(40, 40, 60, 60)].reverse();
    const parts = splitPolygons([cw, hole, square(200, 0, 300, 100)]);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(2);
    expect(parts[1]).toHaveLength(1);
  });
});

describe('pickArea', () => {
  const label = (x: number, y: number, name: string, cls: string, rank = 5) => ({ x, y, name, rank, cls, sub: cls });
  const tile: AreaTile = {
    polys: [
      makePoly('u1', 'residential area', 'residential', [square(0, 0, 1000, 1000)], undefined, []),
      makePoly('c1', 'park', 'green', [square(100, 100, 400, 400)], undefined, ['park', 'garden']),
      makePoly('b1', 'building', 'building', [square(500, 500, 600, 600)]),
      makePoly('c2', 'grass', 'green', [square(450, 450, 700, 700)], undefined, []),
      makePoly('u2', 'university grounds', 'civic', [square(2000, 0, 3000, 1000)], undefined, ['college']),
      makePoly('b2', 'building', 'building', [square(2100, 100, 2200, 200)]),
      makePoly('u3', 'university grounds', 'civic', [square(0, 2000, 1000, 3000)], undefined, ['college']),
    ],
    labels: [
      label(200, 200, 'Victoria Park', 'park', 1),
      label(300, 300, 'Park Lane stop', 'bus', 0),
      label(550, 550, 'Corner Shop', 'shop'),
      label(560, 560, 'Elm & Oak', 'bus', 0),
      label(900, 900, 'First & Stadium', 'bus', 0),
      label(2150, 150, 'State University', 'college'),
      label(100, 2100, 'Engineering Office', 'college'),
      label(900, 2900, 'Science Office', 'college'),
    ],
  };

  it('picks the smallest area around the point, named from a label of its kind', () => {
    expect(pickArea(tile, 't', 150, 150)).toEqual({ key: 't/c1', kind: 'park', name: 'Victoria Park', sound: 'green' });
  });

  it('never names ground after a bus stop in it', () => {
    expect(pickArea(tile, 't', 900, 900)).toMatchObject({ kind: 'residential area', name: undefined });
  });

  it('prefers a building over the larger ground around it, named by what is inside', () => {
    expect(pickArea(tile, 't', 550, 550)).toMatchObject({ key: 't/b1', kind: 'building', name: 'Corner Shop' });
  });

  it("names a campus from its label, even inside one of its buildings, but not when it has several", () => {
    expect(pickArea(tile, 't', 2500, 500)).toMatchObject({ kind: 'university grounds', name: 'State University' });
    expect(pickArea(tile, 't', 500, 2500)).toMatchObject({ kind: 'university grounds', name: undefined });
  });

  it('falls back to open ground', () => {
    expect(pickArea(tile, 't', 5000, 5000)).toEqual({ key: 'open', kind: 'open ground', sound: 'open' });
  });
});

describe('areaText', () => {
  it('drops the kind when the name already says it', () => {
    expect(areaText({ key: '', kind: 'park', name: 'Victoria Park', sound: 'green' })).toBe('Victoria Park');
    expect(areaText({ key: '', kind: 'building', name: 'Corner Shop', sound: 'building' })).toBe('Corner Shop, building');
    expect(areaText({ key: '', kind: 'lake', sound: 'water' })).toBe('lake');
  });
});
