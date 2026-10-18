import { describe, expect, it } from 'vitest';
import { merge, validate } from './backup';

describe('validate', () => {
  it('rejects anything that is not an audio-map backup', () => {
    expect(() => validate({ places: [] })).toThrow();
    expect(() => validate(null)).toThrow();
    expect(() => validate([])).toThrow();
    expect(() => validate({ app: 'other' })).toThrow();
  });

  it('keeps only well-formed places, notes and known settings', () => {
    const b = validate({
      app: 'audio-map',
      evil: 1,
      places: [{ name: 'A', lat: 1, lon: 2, x: 1 }, { name: 'B', lat: 99, lon: 0 }, { name: 'C', lat: 0, lon: 181 }, { name: 5, lat: 0, lon: 0 }, { name: ' ', lat: 0, lon: 0 }, { name: 'D', lat: NaN, lon: 0 }, null],
      notes: [{ text: 'hi', lat: 0, lon: 0 }, { text: '', lat: 0, lon: 0 }, { text: 'x'.repeat(2001), lat: 0, lon: 0 }],
      settings: { vehicle: 'car', units: 'bogus', volume: 7, voiceRate: 1.5, turnByTurn: false, nope: true },
    });
    expect(b.places).toEqual([{ name: 'A', lat: 1, lon: 2 }]);
    expect(b.notes).toEqual([{ text: 'hi', lat: 0, lon: 0 }]);
    expect(b.settings).toEqual({ vehicle: 'car', voiceRate: 1.5, turnByTurn: false });
  });

  it('caps the number of places', () => {
    expect(validate({ app: 'audio-map', places: Array(9999).fill({ name: 'a', lat: 0, lon: 0 }) }).places).toHaveLength(500);
  });

  it('tolerates missing or wrong-typed sections', () => {
    expect(validate({ app: 'audio-map', places: 'x', notes: 5, settings: [] })).toEqual({ places: [], notes: [], settings: {} });
  });

  it('imports the announceHazards setting', () => {
    expect(validate({ app: 'audio-map', settings: { announceHazards: false } }).settings).toEqual({ announceHazards: false });
  });

  it('imports custom sound, muted groups and per-vehicle profiles', () => {
    const settings = {
      customSound: { places: 'landmarks', sideStreets: false, extras: true },
      mutedGroups: ['food', 'food', 'bogus', 7],
      vehicleProfiles: { car: 'minimal', walker: 'nope', plane: 'full' },
    };
    expect(validate({ app: 'audio-map', settings }).settings).toEqual({
      customSound: { places: 'landmarks', sideStreets: false, extras: true },
      mutedGroups: ['food'],
      vehicleProfiles: { car: 'minimal' },
    });
  });

  it('drops a malformed customSound', () => {
    expect(validate({ app: 'audio-map', settings: { customSound: { places: 'all', sideStreets: 'yes', extras: true } } }).settings).toEqual({});
  });
});

describe('merge', () => {
  const have = [{ name: 'A', lat: 1, lon: 2 }];
  it('skips duplicates, matching names case-insensitively', () => {
    const m = merge(have, [{ name: 'a', lat: 1, lon: 2 }, { name: 'C', lat: 3, lon: 4 }, { name: 'C', lat: 3, lon: 4 }], (x) => x.name, 500);
    expect(m.added).toBe(1);
    expect(m.all).toHaveLength(2);
  });
  it('stops at the cap', () => {
    const m = merge(have, [{ name: 'C', lat: 3, lon: 4 }, { name: 'D', lat: 5, lon: 6 }], (x) => x.name, 2);
    expect(m.added).toBe(1);
    expect(m.all).toHaveLength(2);
  });
  it('does not change the original list', () => {
    merge(have, [{ name: 'C', lat: 3, lon: 4 }], (x) => x.name, 5);
    expect(have).toHaveLength(1);
  });
});
