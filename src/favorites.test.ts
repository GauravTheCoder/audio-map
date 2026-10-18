import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFavorites } from './favorites';
import { loadNotes } from './notes';
import { loadRoutes } from './routes';

describe('stored lists', () => {
  afterEach(() => vi.unstubAllGlobals());
  const store = (v: unknown) => vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(v) });
  it('drop malformed favourites', () => {
    store([null, { name: 'A', lat: 1, lon: 2 }, { name: 'B', lat: 'x', lon: 2 }, { lat: 1, lon: 2 }]);
    expect(loadFavorites()).toEqual([{ name: 'A', lat: 1, lon: 2 }]);
  });
  it('drop malformed routes', () => {
    const good = { name: 'r', start: { lat: 1, lon: 2 }, dest: { name: 'd', lat: 3, lon: 4, radius: 5 } };
    store([null, good, { name: 'bad', start: { lat: 1, lon: 2 } }]);
    expect(loadRoutes()).toEqual([good]);
  });
  it('drop malformed notes', () => {
    store([null, { text: 't', lat: 1, lon: 2 }, { text: 'x', lat: 1 }]);
    expect(loadNotes()).toEqual([{ text: 't', lat: 1, lon: 2 }]);
  });
});
