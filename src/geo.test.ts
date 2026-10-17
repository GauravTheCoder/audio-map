import { describe, expect, it } from 'vitest';
import { Projection, alongLine, bearing, clockDir, compass16, compass8, dist, findBend, normDeg, pointSeg, relAngle, sideWord } from './geo';

describe('angles', () => {
  it('normDeg wraps negatives and large values', () => {
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(725)).toBe(5);
    expect(normDeg(360)).toBe(0);
  });
  it('bearing is a clockwise compass angle from north', () => {
    expect(bearing(0, 0, 0, 10)).toBe(0);
    expect(bearing(0, 0, 10, 0)).toBe(90);
    expect(bearing(0, 0, 0, -10)).toBe(180);
    expect(bearing(0, 0, -10, 0)).toBe(270);
  });
  it('relAngle is signed, positive to the right, across north', () => {
    expect(relAngle(350, 10)).toBe(20);
    expect(relAngle(10, 350)).toBe(-20);
    expect(relAngle(0, 180)).toBe(180);
    expect(relAngle(90, 90)).toBe(0);
  });
  it('dist is euclidean', () => {
    expect(dist(0, 0, 3, 4)).toBe(5);
  });
});

describe('Projection', () => {
  const p = new Projection({ lat: 51.5, lon: -0.12 });
  it('round-trips lat/lon', () => {
    const { x, y } = p.toXY(51.51, -0.1);
    const back = p.toLatLon(x, y);
    expect(back.lat).toBeCloseTo(51.51, 9);
    expect(back.lon).toBeCloseTo(-0.1, 9);
  });
  it('puts north and east at positive y and x, with the origin at zero', () => {
    expect(p.toXY(51.5, -0.12)).toEqual({ x: 0, y: 0 });
    expect(p.toXY(51.501, -0.12).y).toBeGreaterThan(0);
    expect(p.toXY(51.5, -0.119).x).toBeGreaterThan(0);
  });
});

describe('spoken helpers', () => {
  it('compass names', () => {
    expect(compass8(0)).toBe('north');
    expect(compass8(359)).toBe('north');
    expect(compass8(135)).toBe('south-east');
    expect(compass16(22.5)).toBe('north-north-east');
  });
  it('clockDir maps relative angle to a clock face', () => {
    expect(clockDir(0)).toBe("12 o'clock");
    expect(clockDir(90)).toBe("3 o'clock");
    expect(clockDir(-90)).toBe("9 o'clock");
  });
  it('sideWord bands', () => {
    expect(sideWord(5)).toBe('ahead');
    expect(sideWord(-30)).toBe('ahead left');
    expect(sideWord(90)).toBe('on your right');
    expect(sideWord(150)).toBe('behind right');
    expect(sideWord(180)).toBe('behind');
  });
});

describe('line helpers', () => {
  it('pointSeg clamps to the segment ends', () => {
    expect(pointSeg(5, 5, 0, 0, 10, 0)).toMatchObject({ dist: 5, t: 0.5, px: 5, py: 0 });
    expect(pointSeg(-5, 0, 0, 0, 10, 0)).toMatchObject({ t: 0, px: 0 });
    expect(pointSeg(1, 1, 2, 2, 2, 2).dist).toBeCloseTo(Math.SQRT2);
  });
  const L = [{ x: 0, y: 0, d: 0 }, { x: 0, y: 10, d: 10 }, { x: 10, y: 10, d: 20 }];
  it('alongLine interpolates and extends past the end', () => {
    expect(alongLine(L, 5)).toEqual({ x: 0, y: 5, dir: 0 });
    expect(alongLine(L, 15)).toEqual({ x: 5, y: 10, dir: 90 });
    expect(alongLine(L, 25).x).toBe(15);
  });
  it('findBend finds a right-angle bend and ignores a straight line', () => {
    const bend = findBend(L, 45, 30);
    expect(bend?.at).toBe(10);
    expect(bend?.turn).toBeCloseTo(90);
    expect(findBend([{ x: 0, y: 0, d: 0 }, { x: 0, y: 10, d: 10 }, { x: 0, y: 20, d: 20 }], 20, 30)).toBeNull();
  });
});
