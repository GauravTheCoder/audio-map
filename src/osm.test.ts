import { describe, expect, it } from 'vitest';
import { accessKind, crossingExtras, parsePlaces, type OverpassEl } from './osm';

describe('parsePlaces', () => {
  const els: OverpassEl[] = [
    { type: 'way', id: 50, center: { lat: 1, lon: 1 }, nodes: [7, 8, 9, 7], tags: { amenity: 'library', name: 'Main Library' } },
    { type: 'node', id: 8, lat: 1.0001, lon: 1, tags: { entrance: 'main', wheelchair: 'yes' } },
    { type: 'node', id: 9, lat: 1.0002, lon: 1, tags: { entrance: 'yes', name: 'Garden door' } },
    { type: 'node', id: 99, lat: 1.0003, lon: 1, tags: { entrance: 'yes' } }, // not on any place
    { type: 'node', id: 20, lat: 2, lon: 2, tags: { highway: 'bus_stop', name: 'Green & Goodwin', local_ref: 'NW Far Side' } },
    { type: 'node', id: 21, lat: 2, lon: 2.001, tags: { railway: 'subway_entrance', ref: '4' } },
    { type: 'node', id: 30, lat: 3, lon: 3, tags: { highway: 'crossing', crossing: 'traffic_signals', 'traffic_signals:sound': 'yes', button_operated: 'yes' } },
    { type: 'node', id: 31, lat: 3, lon: 3.001, tags: { highway: 'traffic_signals', crossing: 'marked', 'traffic_signals:vibration': 'yes' } },
  ];

  it('puts doors on the place whose outline they are on', () => {
    const lib = parsePlaces(els).places.find((p) => p.tags.name === 'Main Library')!;
    expect(lib.entrances).toEqual([
      { lat: 1.0001, lon: 1, tags: { entrance: 'main', wheelchair: 'yes' } },
      { lat: 1.0002, lon: 1, tags: { entrance: 'yes', name: 'Garden door' } },
    ]);
  });

  it('keeps doors and the like out of the places themselves', () => {
    const names = parsePlaces(els).places.map((p) => p.tags.name);
    expect(names).not.toContain('Garden door');
    expect(parsePlaces(els).places).toHaveLength(3);
  });

  it('keeps stop tags and station entrances', () => {
    const r = parsePlaces(els);
    expect(r.places.find((p) => p.id === 'n20')!.tags.local_ref).toBe('NW Far Side');
    expect(r.places.find((p) => p.id === 'n21')!.tags.railway).toBe('subway_entrance');
  });

  it('describes accessible crossings, including ones mapped on the signal itself', () => {
    const r = parsePlaces(els);
    expect(r.crossings).toEqual([
      { lat: 3, lon: 3, text: 'Crossing with signals', extras: ['audible signal', 'push button'] },
      { lat: 3, lon: 3.001, text: 'Crossing with signals', extras: ['vibrating button'] },
    ]);
    expect(r.signals.has(31)).toBe(true);
  });
});

describe('crossingExtras', () => {
  it('reads islands and tactile paving', () => {
    expect(crossingExtras({ crossing: 'island', tactile_paving: 'yes' })).toEqual(['island in the middle', 'tactile paving']);
    expect(crossingExtras({})).toEqual([]);
  });
});

describe('accessKind', () => {
  it('classifies entrances, platforms and lifts', () => {
    expect(accessKind({ entrance: 'main' })).toBe('entrance');
    expect(accessKind({ entrance: 'exit' })).toBe('entrance');
    expect(accessKind({ railway: 'subway_entrance' })).toBe('entrance');
    expect(accessKind({ public_transport: 'platform' })).toBe('platform');
    expect(accessKind({ railway: 'platform' })).toBe('platform');
    expect(accessKind({ highway: 'elevator' })).toBe('lift');
    expect(accessKind({ elevator: 'yes' })).toBe('lift');
  });

  it('ignores everything else', () => {
    expect(accessKind({ highway: 'bus_stop' })).toBeNull();
    expect(accessKind({ amenity: 'cafe', name: 'Joe' })).toBeNull();
  });
});
