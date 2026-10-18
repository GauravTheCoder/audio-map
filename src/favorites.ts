import type { LatLon } from './geo';

export interface Favorite extends LatLon {
  name: string;
}

const KEY = 'audio-map-favorites';

export function loadFavorites(): Favorite[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    // stored data is untrusted: drop entries the UI could not use
    return Array.isArray(raw) ? raw.filter((f) => typeof f?.name === 'string' && Number.isFinite(f.lat) && Number.isFinite(f.lon)) : [];
  } catch {
    return [];
  }
}

export const SAVED_CHANGED = 'audio-map-saved-changed';

export function saveFavorites(list: Favorite[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(SAVED_CHANGED));
}

/** False when a saved place with the same name is already within about 30 metres. */
export function addFavorite(f: Favorite): boolean {
  const list = loadFavorites();
  if (list.some((o) => o.name === f.name && Math.abs(o.lat - f.lat) < 0.0003 && Math.abs(o.lon - f.lon) < 0.0003)) return false;
  saveFavorites([...list, f]);
  return true;
}

export function removeFavorite(f: Favorite) {
  saveFavorites(loadFavorites().filter((o) => !(o.name === f.name && o.lat === f.lat && o.lon === f.lon)));
}
