import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyRejected, askGemini, parseAnswer } from './cloudSignal';
import { cleanKey } from './geminiKey';
import { validate } from './backup';

const reply = (signal: string) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ signal }) }] } }] });
const KEY = 'SECRETKEY-1234567890abcdef';

describe('parseAnswer', () => {
  it('maps the four answers', () => {
    expect(parseAnswer(reply('walk'))).toBe('walk');
    expect(parseAnswer(reply('dont_walk'))).toBe('dontWalk');
    expect(parseAnswer(reply('none'))).toBe('none');
    expect(parseAnswer(reply('unsure'))).toBe('unsure');
  });
  it('never turns junk into walk', () => {
    for (const bad of [reply('WALK'), reply('go'), {}, null, { candidates: [{ content: { parts: [{ text: 'walk' }] } }] }]) expect(parseAnswer(bad)).toBe('unsure');
  });
});

describe('askGemini', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number, body: unknown) => {
    const f = vi.fn().mockResolvedValue({ status, ok: status < 400, json: async () => body });
    vi.stubGlobal('fetch', f);
    return f;
  };

  it('sends the key only in a header, to Google, with no credentials or referrer', async () => {
    const f = stub(200, reply('walk'));
    expect(await askGemini(KEY, 'AAAA')).toBe('walk');
    const [url, init] = f.mock.calls[0];
    expect(url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//);
    expect(url).not.toContain('SECRETKEY');
    expect(init.headers['x-goog-api-key']).toBe(KEY);
    expect(init.body).not.toContain('SECRETKEY');
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  });
  it('reports a refused key without echoing it', async () => {
    stub(403, {});
    const err = await askGemini(KEY, 'AAAA').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyRejected);
    expect((err as Error).message).not.toContain('SECRETKEY');
  });
  it('treats a 400 invalid-key reply as a refused key, and other errors as plain failures', async () => {
    stub(400, { error: { details: [{ reason: 'API_KEY_INVALID' }] } });
    await expect(askGemini(KEY, 'A')).rejects.toBeInstanceOf(KeyRejected);
    stub(429, {});
    const err = await askGemini(KEY, 'A').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(KeyRejected);
  });
});

describe('the key store', () => {
  it('accepts a normal key and rejects pasted junk', () => {
    expect(cleanKey('  AIzaSyA-1234567890_abcdefghijklmnopqrs \n')).toBe('AIzaSyA-1234567890_abcdefghijklmnopqrs');
    for (const bad of ['', 'short', 'has space 1234567890123456789', 'https://x.test/?key=AIzaSyA-1234567890_abcdefghijk']) expect(cleanKey(bad)).toBeNull();
  });
  it('is not carried by backups: validate drops a geminiKey field', () => {
    const out = validate({ app: 'audio-map', settings: { geminiKey: 'AIzaSyA-1234567890_abcdefghijklmnopqrs', cloudWalk: true } });
    expect(JSON.stringify(out)).not.toContain('AIza');
  });
});
