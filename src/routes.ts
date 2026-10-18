export interface SavedRoute {
  name: string;
  start: { lat: number; lon: number };
  dest: { name: string; lat: number; lon: number; radius: number };
}

const KEY = 'audio-map-routes';

export function loadRoutes(): SavedRoute[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    const ok = (p: { lat?: unknown; lon?: unknown } | undefined) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon);
    // stored data is untrusted: drop entries the UI could not use
    return Array.isArray(v) ? v.filter((r) => typeof r?.name === 'string' && ok(r.start) && typeof r.dest?.name === 'string' && ok(r.dest)) : [];
  } catch {
    return [];
  }
}

function store(list: SavedRoute[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage unavailable: routes last for this visit only
  }
}

/** Saving under an existing name replaces it. */
export function saveRoute(r: SavedRoute) {
  store([...loadRoutes().filter((x) => x.name !== r.name), r]);
}

export function removeRoute(name: string) {
  store(loadRoutes().filter((x) => x.name !== name));
}
