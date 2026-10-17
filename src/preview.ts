// Sound preview: a scripted drive past a cafe, bus station, museum and two junctions, played
// through the real profile rules and audio cues. Works before the game starts.

import { AudioEngine } from './audio/audio';
import { extrasWanted, junctionQuiet, placeWanted, PROFILE_TEXT, type SoundProfile } from './profiles';
import type { Settings } from './settings';
import type { Speech } from './speech';
import type { Junction, Place } from './world';

const place = (group: Place['group'], category: string): Place => ({ id: category, name: category, category, group, x: 0, y: 0 });
const junction = (type: string, signals: boolean): Junction =>
  ({ nodes: [], exits: [{ edge: { way: { type, roundabout: false } } }], signals }) as unknown as Junction;

const PLACES = [place('food', 'cafe'), place('transport', 'station'), place('culture', 'museum')];
const JUNCTIONS = [junction('residential', false), junction('primary', true)];
const EXITS = [-90, 0, 90];

let audio: AudioEngine | null = null;
let timers: number[] = [];
let activeBtn: HTMLButtonElement | null = null;

function stop(speech: Speech) {
  timers.forEach(clearTimeout);
  timers = [];
  void audio?.ctx.close();
  audio = null;
  speech.stop();
  if (activeBtn) activeBtn.textContent = 'Preview';
  activeBtn = null;
}

function play(btn: HTMLButtonElement, profile: SoundProfile, settings: Settings, speech: Speech) {
  const s = { ...settings, soundProfile: profile };
  const v = settings.vehicle;
  const a = (audio = new AudioEngine(settings.volume)); // created on the click so the browser allows sound
  activeBtn = btn;
  btn.textContent = 'Stop';
  const at = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));

  speech.say(`${PROFILE_TEXT[profile]} Driving past a cafe, a bus station, a museum, a side street and a main road.`);
  PLACES.forEach((p, i) => at(4000 + i * 1500, () => placeWanted(s, v, p) && a.placeCue(p.group, 70)));
  JUNCTIONS.forEach((j, i) =>
    at(8500 + i * 2000, () => {
      if (junctionQuiet(s, v, j)) return;
      if (extrasWanted(s, v)) a.intersectionChime(3, j.signals);
      at(800, () => a.atIntersection(EXITS));
    }),
  );
  at(13000, () => stop(speech));
}

export function initPreview(getSettings: () => Settings, speech: Speech) {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('button.preview')) {
    btn.addEventListener('click', () => {
      const wasThis = activeBtn === btn;
      stop(speech);
      if (!wasThis) play(btn, btn.dataset.profile as SoundProfile, getSettings(), speech);
    });
  }
}
