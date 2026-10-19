import { describe, expect, it } from 'vitest';
import { routeToGpx } from './gpx';

describe('routeToGpx', () => {
  it('writes one track point per route point and escapes the name', () => {
    const xml = routeToGpx('Home & "Work"', [{ lat: 51, lon: 0 }, { lat: 51.001, lon: -0.002 }]);
    expect(xml).toContain('<name>Home &amp; &quot;Work&quot;</name>');
    expect(xml.match(/<trkpt /g)).toHaveLength(2);
    expect(xml).toContain('lat="51.001000" lon="-0.002000"');
  });
});
