import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchKept } from './tiles';

function fakeCaches() {
  const store = new Map<string, Response>();
  vi.stubGlobal('caches', {
    open: async () => ({ put: async (u: string, r: Response) => void store.set(u, r) }),
    match: async (u: string) => store.get(u)?.clone(),
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchKept', () => {
  it('keeps what the network returns and serves it when the network is gone', async () => {
    fakeCaches();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('tile-bytes')).mockRejectedValueOnce(new TypeError('offline')));
    expect(await (await fetchKept('https://t/1')).text()).toBe('tile-bytes');
    await Promise.resolve();
    expect(await (await fetchKept('https://t/1')).text()).toBe('tile-bytes');
  });

  it('throws when offline and the tile was never kept', async () => {
    fakeCaches();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(fetchKept('https://t/2')).rejects.toThrow('offline');
  });

  it('does not keep a failed response', async () => {
    const store = fakeCaches();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 500 })));
    await fetchKept('https://t/3');
    await Promise.resolve();
    expect(store.size).toBe(0);
  });
});
