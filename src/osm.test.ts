import { describe, expect, it } from 'vitest';
import { accessKind } from './osm';

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
