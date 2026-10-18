import { SAVED_CHANGED } from './favorites';
import type { LatLon } from './geo';

export interface Note extends LatLon {
  text: string;
}

const KEY = 'audio-map-notes';

export function loadNotes(): Note[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    // stored data is untrusted: drop entries the game and the list could not use
    return Array.isArray(raw) ? raw.filter((n) => typeof n?.text === 'string' && Number.isFinite(n.lat) && Number.isFinite(n.lon)) : [];
  } catch {
    return [];
  }
}

export function saveNotes(list: Note[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(SAVED_CHANGED));
}
