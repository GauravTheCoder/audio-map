import type { LatLon } from './geo';

export interface Favorite extends LatLon {
  name: string;
}

const KEY = 'audio-map-favorites';

export function loadFavorites(): Favorite[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function save(list: Favorite[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

/** False when a saved place with the same name is already within about 30 metres. */
export function addFavorite(f: Favorite): boolean {
  const list = loadFavorites();
  if (list.some((o) => o.name === f.name && Math.abs(o.lat - f.lat) < 0.0003 && Math.abs(o.lon - f.lon) < 0.0003)) return false;
  save([...list, f]);
  return true;
}

export function removeFavorite(f: Favorite) {
  save(loadFavorites().filter((o) => !(o.name === f.name && o.lat === f.lat && o.lon === f.lon)));
}
