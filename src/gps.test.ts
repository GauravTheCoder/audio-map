import { describe, expect, it } from 'vitest';
import { compassHeading, easeAngle, fuse, pickHeading, snapRadius } from './gps';

describe('compassHeading', () => {
  it('uses the iOS compass heading directly', () => {
    expect(compassHeading({ webkitCompassHeading: 90 })).toBe(90);
  });
  it('converts absolute alpha (counter-clockwise) to a compass heading', () => {
    expect(compassHeading({ absolute: true, alpha: 90 })).toBe(270);
    expect(compassHeading({ absolute: true, alpha: 0 })).toBe(0);
  });
  it('ignores relative orientation, which is not north-referenced', () => {
    expect(compassHeading({ absolute: false, alpha: 90 })).toBeNull();
    expect(compassHeading({ absolute: true, alpha: null })).toBeNull();
  });
});

describe('pickHeading', () => {
  it('prefers the compass', () => {
    expect(pickHeading(10, 200, 5)).toBe(10);
  });
  it('falls back to the GPS course only when moving', () => {
    expect(pickHeading(null, 200, 1.5)).toBe(200);
    expect(pickHeading(null, 200, 0.2)).toBeNull();
    expect(pickHeading(null, null, 5)).toBeNull();
  });
});

describe('easeAngle', () => {
  it('goes the short way across north', () => {
    expect(easeAngle(350, 10, 0.5)).toBe(0);
    expect(easeAngle(10, 350, 0.5)).toBe(0);
  });
  it('clamps the fraction', () => {
    expect(easeAngle(0, 90, 2)).toBe(90);
    expect(easeAngle(0, 90, -1)).toBe(0);
  });
});

describe('fuse', () => {
  it('starts from the first fix', () => {
    expect(fuse(null, 5, 6, 20, 0, 0)).toEqual({ x: 5, y: 6, acc: 20, t: 0 });
  });
  it('moves most of the way to a more accurate fix', () => {
    const e = fuse({ x: 0, y: 0, acc: 50, t: 0 }, 100, 0, 5, 1, 0);
    expect(e.x).toBeGreaterThan(90);
    expect(e.acc).toBeLessThan(5);
  });
  it('barely moves for a much worse fix', () => {
    const e = fuse({ x: 0, y: 0, acc: 5, t: 0 }, 100, 0, 80, 1, 0);
    expect(e.x).toBeLessThan(5);
  });
  it('trusts a new fix more after a long gap or fast travel', () => {
    const slow = fuse({ x: 0, y: 0, acc: 10, t: 0 }, 50, 0, 10, 1, 0);
    const fast = fuse({ x: 0, y: 0, acc: 10, t: 0 }, 50, 0, 10, 30, 5);
    expect(fast.x).toBeGreaterThan(slow.x);
  });
});

describe('snapRadius', () => {
  it('snaps only when the fix is good, with a minimum radius', () => {
    expect(snapRadius(5)).toBe(10);
    expect(snapRadius(25)).toBe(25);
    expect(snapRadius(31)).toBe(0);
  });
});
