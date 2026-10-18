import type { LatLon } from './geo';

const URL = 'https://api.openstreetmap.org/api/0.6/notes.json';

/** Anonymous notes are read by volunteer mappers, so say where the report came from. */
export function osmNoteText(text: string): string {
  return `Reported with Audio Map: ${text.trim()}`;
}

/** Resolves on success; rejects on network failure, timeout or a non-2xx reply. */
export async function postOsmNote(at: LatLon, text: string, timeoutMs = 10000, doFetch: typeof fetch = fetch): Promise<void> {
  const res = await doFetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ lat: String(at.lat), lon: String(at.lon), text: osmNoteText(text) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`OpenStreetMap replied ${res.status}`);
}
