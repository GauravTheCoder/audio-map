import { describe, expect, it } from 'vitest';
import { Projection } from './geo';
import type { RawRoads } from './osm';
import { crossingLeg, drivesOnLeft, locate, parseLocalRef, stopDetail } from './placeinfo';
import { World, type Place } from './world';

const proj = new Projection({ lat: 40.11, lon: -88.22 });
const ll = (x: number, y: number) => proj.toLatLon(x, y);

// Goodwin Avenue runs north (x = 0), becoming North Goodwin Avenue past University Avenue (y = 200).
// Green Street runs east (y = 0); Mathews Avenue runs north at x = -150.
function world(greenOneWay = false): World {
  const pts: [number, number, number][] = [
    [1, 0, -300], [2, 0, 0], [3, 0, 200], [4, 0, 400],
    [5, -300, 0], [6, -150, 0], [7, 300, 0],
    [8, -150, -300], [9, -150, 300],
    [10, -300, 200], [11, 300, 200],
  ];
  const nodes = new Map(pts.map(([id, x, y]) => [id, ll(x, y)]));
  const green: Record<string, string> = { highway: 'secondary', name: 'Green Street' };
  if (greenOneWay) green.oneway = 'yes';
  const raw: RawRoads = {
    nodes,
    ways: [
      { id: 1, nodes: [1, 2, 3], tags: { highway: 'secondary', name: 'South Goodwin Avenue' } },
      { id: 2, nodes: [3, 4], tags: { highway: 'secondary', name: 'North Goodwin Avenue' } },
      { id: 3, nodes: [5, 6, 2, 7], tags: green },
      { id: 4, nodes: [8, 6, 9], tags: { highway: 'residential', name: 'Mathews Avenue' } },
      { id: 5, nodes: [10, 3, 11], tags: { highway: 'primary', name: 'University Avenue' } },
    ],
  };
  return new World(proj, raw);
}

const stop = (name: string, x: number, y: number, info: Place['info'] = {}, category = 'bus stop'): Place => ({ id: 'n1', name, category, group: 'transport', x, y, info });

describe('locate', () => {
  it('names the corner of an intersection', () => {
    const s = locate(world(), -8, 8, 'metric')!;
    expect(s.corner).toBe(true);
    expect(s.where).toBe('north-west corner');
    expect(s.of).toMatch(/^of (Green Street and South Goodwin Avenue|South Goodwin Avenue and Green Street)$/);
  });

  it('measures from the cross street in the stop name, even when another is nearer', () => {
    const s = locate(world(), -110, 6, 'metric', false, 'Green & Goodwin')!;
    expect(s.where).toBe('north side');
    expect(s.of).toBe('of Green Street, 110 metres west of South Goodwin Avenue');
    expect(locate(world(), -110, 6, 'metric')!.of).toBe('of Green Street, 40 metres east of Mathews Avenue');
  });

  it('guesses the direction of traffic from the side of the street', () => {
    expect(locate(world(), -110, 6, 'metric')!.travel).toEqual({ dir: 270, sure: false });
    expect(locate(world(), -110, 6, 'metric', true)!.travel).toEqual({ dir: 90, sure: false });
  });

  it('knows the direction for sure on a one-way street', () => {
    expect(locate(world(true), -110, 6, 'metric')!.travel).toEqual({ dir: 90, sure: true });
  });

  it('does not take a renamed stretch of the same street for a cross street', () => {
    expect(locate(world(), 6, 150, 'metric')!.of).toBe('of South Goodwin Avenue, 50 metres south of University Avenue');
  });

  it('returns null away from any named street', () => {
    expect(locate(world(), 120, 120, 'metric')).toBeNull();
  });
});

describe('parseLocalRef', () => {
  it('tells stop letters from positions', () => {
    expect(parseLocalRef('K')).toEqual({ letter: 'K' });
    expect(parseLocalRef('2')).toEqual({ letter: '2' });
    expect(parseLocalRef('H.1')).toEqual({ letter: 'H.1' });
    expect(parseLocalRef('NW Far Side')).toEqual({ position: 'north-west far side' });
    expect(parseLocalRef('SW Corner')).toEqual({ position: 'south-west corner' });
    expect(parseLocalRef('North side')).toEqual({ position: 'north side' });
    expect(parseLocalRef('opp')).toEqual({});
  });
});

describe('stopDetail', () => {
  const w = world();
  it('describes a stop from the street layout', () => {
    const p = stop('Green & Goodwin', -110, 6);
    expect(stopDetail(p, locate(w, p.x, p.y, 'metric', false, p.name))).toEqual({
      short: 'north side',
      long: 'north side of Green Street, 110 metres west of South Goodwin Avenue, buses probably head west',
    });
  });

  it("prefers the stop's own position tag, and adds its letter, lines and bearing", () => {
    const p = stop('Green & Goodwin', -110, 6, { localRef: 'NW Far Side' });
    expect(stopDetail(p, locate(w, p.x, p.y, 'metric', false, p.name)).short).toBe('north-west far side');
    const q = stop('Oxford Circus', -110, 6, { localRef: 'RC', routeRef: '5;12;22', bearing: 'E' });
    expect(stopDetail(q, locate(w, q.x, q.y, 'metric')).long).toBe(
      'north side of Green Street, 40 metres east of Mathews Avenue, stop RC, routes 5, 12 and 22, buses head east',
    );
  });

  it('says near or far side at a corner only when the direction is known', () => {
    const near = stop('Green & Goodwin', -20, 6, { bearing: 'E' }); // before the intersection, heading east
    expect(stopDetail(near, locate(w, near.x, near.y, 'metric')).short).toBe('north-west corner, near side');
    const guessed = stop('Green & Goodwin', -20, 6);
    expect(stopDetail(guessed, locate(w, guessed.x, guessed.y, 'metric')).short).toBe('north-west corner');
  });

  it('does not repeat an entrance number the name already has', () => {
    const e = stop('Exit 4, Green Street', -8, 8, { localRef: '4' }, 'station entrance');
    expect(stopDetail(e, locate(w, e.x, e.y, 'metric')).short).toBe('north-west corner');
    const f = stop('Union Station', -8, 8, { localRef: '4' }, 'station entrance');
    expect(stopDetail(f, locate(w, f.x, f.y, 'metric')).short).toBe('north-west corner, entrance 4');
  });
});

describe('crossingLeg', () => {
  it('says which street a crossing goes over and which side of the intersection it is', () => {
    expect(crossingLeg(world(), 0, -20, 'metric')).toBe('over South Goodwin Avenue, south of Green Street');
    expect(crossingLeg(world(), 0, -100, 'metric')).toBe('over South Goodwin Avenue, 100 metres south of Green Street');
  });
});

describe('drivesOnLeft', () => {
  it('knows Britain from Illinois', () => {
    expect(drivesOnLeft(51.5, -0.14)).toBe(true);
    expect(drivesOnLeft(40.11, -88.22)).toBe(false);
  });
});
