// The player's own Gemini API key. It lives in its own localStorage entry, never in Settings: settings are exported,
// imported and validated as a whole, and the key must not travel in any of that. It is sent only by cloudSignal.ts.

const KEY = 'audio-map-gemini-key';

/** Google keys are one token of letters, digits, '-', '_' and '.'; anything else (spaces, newlines, URLs) is a paste mistake. */
export function cleanKey(raw: string): string | null {
  const k = raw.trim();
  return /^[A-Za-z0-9_.-]{20,200}$/.test(k) ? k : null;
}

export function loadKey(): string | null {
  try {
    return cleanKey(localStorage.getItem(KEY) ?? '');
  } catch {
    return null;
  }
}

/** Returns false if the key is malformed or storage is unavailable. */
export function saveKey(raw: string): boolean {
  const k = cleanKey(raw);
  if (!k) return false;
  try {
    localStorage.setItem(KEY, k);
    return true;
  } catch {
    return false;
  }
}

export function clearKey(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored that could be removed
  }
}
