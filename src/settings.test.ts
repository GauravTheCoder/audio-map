import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtDistance, fmtSpeed, loadSettings } from './settings';

describe('fmtDistance', () => {
  it('metric rounds in steps and switches to km at 1000 m', () => {
    expect(fmtDistance(3, 'metric')).toBe('5 metres');
    expect(fmtDistance(47, 'metric')).toBe('45 metres');
    expect(fmtDistance(123, 'metric')).toBe('120 metres');
    expect(fmtDistance(480, 'metric')).toBe('500 metres');
    expect(fmtDistance(1000, 'metric')).toBe('1.0 kilometres');
    expect(fmtDistance(12_400, 'metric')).toBe('12 kilometres');
  });
  it('never says a negative distance', () => {
    for (const u of ['metric', 'imperial'] as const) expect(fmtDistance(-12, u)).toBe(fmtDistance(0, u));
  });
  it('imperial uses feet then miles', () => {
    expect(fmtDistance(10, 'imperial')).toBe('30 feet');
    expect(fmtDistance(100, 'imperial')).toBe('350 feet');
    expect(fmtDistance(1000, 'imperial')).toBe('0.6 miles');
    expect(fmtDistance(20_000, 'imperial')).toBe('12 miles');
  });
});

describe('fmtSpeed', () => {
  it('converts m/s', () => {
    expect(fmtSpeed(10, 'metric')).toBe('36 kilometres per hour');
    expect(fmtSpeed(10, 'imperial')).toBe('22 miles per hour');
  });
});

describe('loadSettings', () => {
  const store = (v: string | null) => vi.stubGlobal('localStorage', { getItem: () => v });
  afterEach(() => vi.unstubAllGlobals());

  it('returns defaults when nothing is stored', () => {
    store(null);
    expect(loadSettings()).toMatchObject({ vehicle: 'walker', units: 'metric', display: 'highContrast', mutedGroups: [] });
  });
  it('fills new keys into old stored data and keeps stored values', () => {
    store(JSON.stringify({ units: 'imperial' }));
    expect(loadSettings()).toMatchObject({ units: 'imperial', walkRoute: 'shortest', volume: 0.8 });
  });
  it('maps old display names to high contrast and fixes a bad mutedGroups', () => {
    store(JSON.stringify({ display: 'lowVision', mutedGroups: 'food' }));
    expect(loadSettings()).toMatchObject({ display: 'highContrast', mutedGroups: [] });
    store(JSON.stringify({ display: 'standard' }));
    expect(loadSettings().display).toBe('standard');
  });
  it('falls back to defaults on garbage or unavailable storage', () => {
    store('{not json');
    expect(loadSettings().vehicle).toBe('walker');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadSettings().vehicle).toBe('walker');
  });
  it('does not share the default mutedGroups array between calls', () => {
    store(null);
    loadSettings().mutedGroups.push('food');
    expect(loadSettings().mutedGroups).toEqual([]);
  });
});

describe('loadSettings with corrupt storage', () => {
  it('falls back to defaults for wrongly typed values', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{"customSound":null,"soundProfile":"bogus","vehicle":"boat","volume":"x","units":"furlongs"}' });
    const s = loadSettings();
    vi.unstubAllGlobals();
    expect(s.customSound).toEqual({ places: 'notable', sideStreets: true, extras: true });
    expect([s.soundProfile, s.vehicle, s.volume, s.units]).toEqual(['simple', 'walker', 0.8, 'metric']);
  });
});
