import { afterEach, describe, expect, it, vi } from 'vitest';
import { valhallaWalk } from './onlineRouter';

const a = { lat: 51.5, lon: -0.1 };
const b = { lat: 51.51, lon: -0.11 };

async function bodyFor(streets: boolean, accessible: boolean) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 'Ok' }) });
  vi.stubGlobal('fetch', fetchMock);
  await valhallaWalk(a, b, streets, accessible);
  const [url, init] = fetchMock.mock.calls[0];
  return { url, body: JSON.parse(init.body) };
}

describe('valhallaWalk', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for wheelchair pedestrian costing when accessible', async () => {
    const { url, body } = await bodyFor(false, true);
    expect(url).toBe('https://valhalla1.openstreetmap.de/route');
    expect(body.costing).toBe('pedestrian');
    expect(body.costing_options.pedestrian).toEqual({ type: 'wheelchair' });
  });

  it('combines with the streets-only factors', async () => {
    const { body } = await bodyFor(true, true);
    expect(body.costing_options.pedestrian).toMatchObject({ type: 'wheelchair', walkway_factor: 6 });
  });

  it('leaves the type out when not accessible', async () => {
    const { body } = await bodyFor(true, false);
    expect(body.costing_options.pedestrian.type).toBeUndefined();
  });
});
