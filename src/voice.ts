// Spoken commands through the browser's speech recognition. Phrases map to the same actions as touch.

import { perform, type Action, type Driver } from './touch';

const PHRASES: [string, Action][] = [
  ['where am i', { key: 'e' }],
  ['what is around', { key: 'w' }],
  ["what's around", { key: 'w' }],
  ['around me', { key: 'w' }],
  ['speed', { key: 's' }],
  ['heading', { key: 'h' }],
  ['location', { key: 'l' }],
  ['next intersection', { key: 'n' }],
  ['next instruction', { key: 'i' }],
  ['distance', { key: 'd' }],
  ['repeat', { key: '[' }],
  ['say again', { key: '[' }],
  ['faster', { drive: 'go' }],
  ['go', { drive: 'go' }],
  ['accelerate', { drive: 'go' }],
  ['stop', { drive: 'brake' }],
  ['brake', { drive: 'brake' }],
  ['slow down', { drive: 'brake' }],
  ['turn left', { key: 'ArrowLeft', shift: true }],
  ['turn right', { key: 'ArrowRight', shift: true }],
  ['next road left', { key: 'ArrowLeft', ctrl: true }],
  ['next road right', { key: 'ArrowRight', ctrl: true }],
  ['help', { key: 'F1' }],
  ['menu', { key: 'Escape' }],
  ['pause', { key: 'Escape' }],
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z' ]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .join(' ');

/** Longest phrase wins, so "next road left" is not read as a shorter one; whole words only. */
export function matchPhrase(transcript: string): Action | null {
  const t = ` ${norm(transcript)} `;
  let best: [string, Action] | null = null;
  for (const p of PHRASES) {
    if (t.includes(` ${p[0]} `) && (!best || p[0].length > best[0].length)) best = p;
  }
  return best ? best[1] : null;
}

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

function recognitionCtor(): (new () => Recognition) | undefined {
  const w = window as unknown as Record<string, new () => Recognition>;
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

/** Returns a toggle, or null when the browser has no speech recognition. */
export function setupVoice(getGame: () => Driver | null, say: (s: string) => void): (() => boolean) | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = navigator.language || 'en-US';
  let on = false;
  rec.onresult = (e) => {
    const r = e.results[e.resultIndex];
    const game = getGame();
    const a = r.isFinal && game ? matchPhrase(r[0].transcript) : null;
    if (a && game) perform(game, a);
  };
  // browsers end recognition after silence; restart while the user wants it on
  rec.onend = () => {
    if (!on) return;
    try {
      rec.start();
    } catch {
      on = false;
    }
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      on = false;
      say('Voice commands need microphone permission. They are off.');
    }
  };
  return () => {
    on = !on;
    if (on) rec.start();
    else rec.stop();
    say(`Voice commands ${on ? 'on' : 'off'}.`);
    return on;
  };
}
