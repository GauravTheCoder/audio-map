import { describe, expect, it } from 'vitest';
import { cellPoint, nextUp, offsetText } from './phone';

describe('cellPoint', () => {
  it('puts the top row ahead and the right column to the right, whichever way is up', () => {
    // north up: the top-right square is north-east
    const ne = cellPoint(0, 0, 0, 10, 0, 6);
    expect(ne.x).toBeCloseTo(30);
    expect(ne.y).toBeCloseTo(30);
    // east up: the top row is east, the right column south
    const top = cellPoint(0, 0, 90, 10, 0, 3);
    expect(top.x).toBeCloseTo(30);
    expect(top.y).toBeCloseTo(0);
    const right = cellPoint(0, 0, 90, 10, 3, 6);
    expect(right.x).toBeCloseTo(0);
    expect(right.y).toBeCloseTo(-30);
    expect(cellPoint(5, 7, 45, 10, 3, 3)).toEqual({ x: 5, y: 7 });
  });
});

describe('offsetText', () => {
  it('says ahead and right in travel mode, compass in explore mode, nothing for the centre', () => {
    expect(offsetText(1, 4, 20, 'metric', true)).toBe('40 metres ahead, 20 metres right');
    expect(offsetText(6, 0, 20, 'metric', true)).toBe('60 metres behind, 60 metres left');
    expect(offsetText(1, 4, 20, 'metric', false)).toBe('40 metres north, 20 metres east');
    expect(offsetText(3, 2, 10, 'imperial', false)).toBe('10 yards west');
    expect(offsetText(3, 3, 10, 'metric', true)).toBe('');
  });
});

describe('nextUp', () => {
  it('turns the map only once a new direction has held for a second', () => {
    let r = nextUp(null, { dir: 90, street: 'Green Street' }, 0);
    expect(r).toEqual({ state: { dir: 90, street: 'Green Street' }, turned: true });
    r = nextUp(r.state, { dir: 0, street: 'Goodwin Avenue' }, 100);
    expect(r.turned).toBe(false);
    expect(r.state.dir).toBe(90);
    r = nextUp(r.state, { dir: 90 }, 400); // a glance aside and back: nothing changes
    expect(r.state).toEqual({ dir: 90, street: 'Green Street' });
    r = nextUp(r.state, { dir: 0, street: 'Goodwin Avenue' }, 500);
    r = nextUp(r.state, { dir: 0, street: 'Goodwin Avenue' }, 1200);
    expect(r.turned).toBe(false);
    r = nextUp(r.state, { dir: 0, street: 'Goodwin Avenue' }, 1600);
    expect(r).toEqual({ state: { dir: 0, street: 'Goodwin Avenue' }, turned: true });
  });
});
