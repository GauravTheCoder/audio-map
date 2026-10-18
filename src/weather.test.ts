import { afterEach, describe, expect, it, vi } from 'vitest';
import { conditionsReport } from './weather';

describe('conditionsReport', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('says conditions are unavailable when the forecast has no daily block', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ current: { time: '2026-01-01T10:00' } }) }));
    expect(await conditionsReport({ lat: 1.1, lon: 2.2 }, 'metric')).toContain('unavailable');
  });
});
