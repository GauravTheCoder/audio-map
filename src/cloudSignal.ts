// Asks Gemini what a pedestrian signal shows. The player's key goes only in the x-goog-api-key header of a request to
// the one fixed Google URL below: never in a URL, a log, speech or an error message. Nothing is cached or stored.
import type { SignalState } from './signal';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const TIMEOUT_MS = 4000;
const ANSWERS: Record<string, SignalState> = { walk: 'walk', dont_walk: 'dontWalk', unsure: 'unsure', none: 'none' };

const PROMPT =
  "This photo is from the back camera of a blind pedestrian's phone, aimed at a street crossing. Look only at the " +
  'pedestrian signal in the middle of the picture, not at car traffic lights. Answer "walk" only if it clearly shows ' +
  'the walk symbol (a white walking person, or green for pedestrians). Answer "dont_walk" if it clearly shows the ' +
  'orange hand, a red standing person, a flashing hand or a flashing countdown. Answer "unsure" if a signal is ' +
  'visible but you cannot read it with certainty. Answer "none" if no pedestrian signal is visible.';

/** The key was refused; the caller should stop using it. */
export class KeyRejected extends Error {}

/** Map Gemini's reply to a state; anything unexpected is 'unsure', never 'walk'. */
export function parseAnswer(reply: unknown): SignalState {
  try {
    const text = (reply as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.[0]?.text;
    const answer = (JSON.parse(text ?? '') as { signal?: unknown }).signal;
    return (typeof answer === 'string' && ANSWERS[answer]) || 'unsure';
  } catch {
    return 'unsure';
  }
}

/** One photo (base64 JPEG) in, one state out. Rejects with KeyRejected if Google refuses the key, and with a plain Error for anything else. */
export async function askGemini(key: string, jpegBase64: string): Promise<SignalState> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: jpegBase64 } }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 50,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: { signal: { type: 'STRING', enum: Object.keys(ANSWERS) } }, required: ['signal'] },
      },
    }),
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) throw new KeyRejected('key refused');
  if (res.status === 400) {
    const body: unknown = await res.json().catch(() => null);
    if (JSON.stringify(body).includes('API_KEY_INVALID')) throw new KeyRejected('key refused');
  }
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  return parseAnswer(await res.json());
}
