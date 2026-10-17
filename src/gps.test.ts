import { describe, expect, it } from 'vitest';
import { compassHeading, easeAngle, pickHeading } from './gps';

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
