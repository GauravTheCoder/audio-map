import { describe, expect, it, vi } from 'vitest';
import { osmNoteText, postOsmNote } from './osmnotes';

const at = { lat: 51.5, lon: -0.12 };

describe('postOsmNote', () => {
  it('posts lat, lon and prefixed text', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    await postOsmNote(at, ' missing path ', 1000, f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.openstreetmap.org/api/0.6/notes.json');
    expect(init.method).toBe('POST');
    const body = init.body as URLSearchParams;
    expect(body.get('lat')).toBe('51.5');
    expect(body.get('lon')).toBe('-0.12');
    expect(body.get('text')).toBe(osmNoteText('missing path'));
    expect(body.get('text')).toContain('missing path');
  });
  it('rejects on an error status', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(postOsmNote(at, 'x', 1000, f as unknown as typeof fetch)).rejects.toThrow('503');
  });
  it('rejects on network failure', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('offline'));
    await expect(postOsmNote(at, 'x', 1000, f as unknown as typeof fetch)).rejects.toThrow();
  });
});
