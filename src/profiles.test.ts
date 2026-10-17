import { describe, expect, it } from 'vitest';
import { extrasWanted, junctionQuiet, nextProfile, placeTier, placeWanted } from './profiles';
import type { Junction, Place } from './world';

const place = (group: Place['group'], category = 'x'): Place => ({ id: '1', name: 'n', category, group, x: 0, y: 0 });
const base = { soundProfile: 'full', customSound: { places: 'all', sideStreets: false, extras: false }, mutedGroups: [] };
const S = (o: object) => ({ ...base, ...o }) as Parameters<typeof placeWanted>[0];
const custom = (c: object) => S({ soundProfile: 'custom', customSound: { places: 'all', sideStreets: false, extras: false, ...c } });

describe('placeTier', () => {
  it('ranks landmarks, notable and everyday places', () => {
    expect(placeTier(place('culture'))).toBe(2);
    expect(placeTier(place('transport', 'station'))).toBe(2);
    expect(placeTier(place('other', 'hospital'))).toBe(2);
    expect(placeTier(place('health'))).toBe(1);
    expect(placeTier(place('transport', 'tram stop'))).toBe(1);
    expect(placeTier(place('transport', 'bus stop'))).toBe(0);
    expect(placeTier(place('food'))).toBe(0);
  });
});

describe('placeWanted', () => {
  it('drops everyday places for a car on simple but not for a walker', () => {
    expect(placeWanted(S({ soundProfile: 'simple' }), 'walker', place('food'))).toBe(true);
    expect(placeWanted(S({ soundProfile: 'simple' }), 'car', place('food'))).toBe(false);
    expect(placeWanted(S({ soundProfile: 'simple' }), 'car', place('culture'))).toBe(true);
  });
  it('honours muted groups', () => {
    expect(placeWanted(S({ mutedGroups: ['culture'] }), 'walker', place('culture'))).toBe(false);
    expect(placeWanted(S({ mutedGroups: ['culture'] }), 'walker', place('food'))).toBe(true);
  });
  it('uses the custom threshold, ignoring the vehicle', () => {
    expect(placeWanted(custom({ places: 'landmarks' }), 'walker', place('health'))).toBe(false);
    expect(placeWanted(custom({ places: 'notable' }), 'walker', place('health'))).toBe(true);
    expect(placeWanted(custom({ places: 'none' }), 'walker', place('culture'))).toBe(false);
    expect(placeWanted(custom({ places: 'all' }), 'helicopter', place('food'))).toBe(true);
  });
});

describe('extrasWanted', () => {
  it('follows the preset per vehicle, or the custom flag', () => {
    expect(extrasWanted(S({ soundProfile: 'simple' }), 'walker')).toBe(true);
    expect(extrasWanted(S({ soundProfile: 'simple' }), 'car')).toBe(false);
    expect(extrasWanted(S({ soundProfile: 'minimal' }), 'walker')).toBe(false);
    expect(extrasWanted(custom({ extras: true }), 'car')).toBe(true);
    expect(extrasWanted(custom({ extras: false }), 'walker')).toBe(false);
  });
});

describe('junctionQuiet', () => {
  const junction = (type: string, signals = false, roundabout = false): Junction => ({
    nodes: [],
    signals,
    exits: [{ from: {} as never, edge: { to: 1, fwd: true, way: { type, roundabout } as never } }],
  });
  it('only silences side streets when the profile wants main roads only', () => {
    expect(junctionQuiet(S({ soundProfile: 'full' }), 'car', junction('residential'))).toBe(false);
    expect(junctionQuiet(S({ soundProfile: 'simple' }), 'car', junction('residential'))).toBe(true);
    expect(junctionQuiet(S({ soundProfile: 'simple' }), 'walker', junction('residential'))).toBe(false);
  });
  it('keeps main roads, signals and roundabouts audible', () => {
    const s = S({ soundProfile: 'minimal' });
    expect(junctionQuiet(s, 'car', junction('primary'))).toBe(false);
    expect(junctionQuiet(s, 'car', junction('residential', true))).toBe(false);
    expect(junctionQuiet(s, 'car', junction('residential', false, true))).toBe(false);
  });
  it('custom: sideStreets=true keeps everything', () => {
    expect(junctionQuiet(custom({ sideStreets: true }), 'car', junction('residential'))).toBe(false);
    expect(junctionQuiet(custom({ sideStreets: false }), 'car', junction('residential'))).toBe(true);
  });
});

describe('nextProfile', () => {
  it('cycles through all four and wraps', () => {
    expect(nextProfile('full')).toBe('simple');
    expect(nextProfile('simple')).toBe('minimal');
    expect(nextProfile('minimal')).toBe('custom');
    expect(nextProfile('custom')).toBe('full');
  });
});
