import { describe, expect, it } from 'vitest';
import { departuresReport, type DepartureFeed } from './transit';

const stop = { name: 'Main St', lat: 1, lon: 2 };
const now = Date.parse('2026-01-01T10:00:00Z');
const feed = (over: Partial<DepartureFeed>): DepartureFeed => ({ covers: () => true, departures: async () => [], ...over });

describe('departuresReport', () => {
  it('reads minutes, line and destination', async () => {
    const f = feed({
      departures: async () => [
        { line: '12', to: 'Central', at: new Date(now + 3 * 60000), live: true },
        { line: '', to: '', at: new Date(now), live: false },
      ],
    });
    expect(await departuresReport(f, stop, now)).toBe('Next departures from Main St: 12 to Central in 3 minutes. Service now.');
  });
  it('says no data when uncovered or empty', async () => {
    expect(await departuresReport(feed({ covers: () => false }), stop, now)).toBe('No departure data here.');
    expect(await departuresReport(feed({}), stop, now)).toBe('No departure data here.');
  });
  it('speaks a failure message when the feed throws', async () => {
    const f = feed({ departures: async () => Promise.reject(new Error('timeout')) });
    expect(await departuresReport(f, stop, now)).toContain('unavailable');
  });
});
