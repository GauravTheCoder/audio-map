export type SoundTheme = 'classic' | 'soft' | 'distinct';
export const SOUND_THEMES: readonly SoundTheme[] = ['classic', 'soft', 'distinct'];

/** Every AudioEngine method that makes a cue sound; each theme must tune all of them. */
export const CUES = [
  'tick', 'intersectionChime', 'hazardCue', 'placeCue', 'testTone', 'beacon', 'arrival', 'sonarStart', 'bump', 'error',
  'loaded', 'atIntersection', 'leftIntersection', 'proximityBeep', 'turnCue', 'routeTurnHere', 'routePassIntersection',
  'wrongWay', 'deadEnd', 'streetChange',
] as const;
export type Cue = (typeof CUES)[number];

/** level and pitch scale the cue as written; wave, when set, replaces its oscillator type. */
export interface CueTune {
  level: number;
  pitch: number;
  wave?: OscillatorType;
}

const same: CueTune = { level: 1, pitch: 1 };
const all = (t: CueTune): Record<Cue, CueTune> => Object.fromEntries(CUES.map((c) => [c, t])) as Record<Cue, CueTune>;

// Numbers are starting points chosen without hearing them; only listening can judge a theme.
export const THEMES: Record<SoundTheme, Record<Cue, CueTune>> = {
  classic: all(same),
  soft: { ...all({ level: 0.6, pitch: 1, wave: 'sine' }), bump: { level: 0.6, pitch: 1 }, hazardCue: { level: 0.8, pitch: 1, wave: 'triangle' } },
  distinct: {
    ...all(same),
    tick: { level: 1, pitch: 1.2, wave: 'triangle' },
    intersectionChime: { level: 1, pitch: 0.75, wave: 'sine' },
    hazardCue: { level: 1, pitch: 0.8, wave: 'sawtooth' },
    placeCue: { level: 1, pitch: 1.25, wave: 'sine' },
    beacon: { level: 1, pitch: 1.5, wave: 'triangle' },
    arrival: { level: 1, pitch: 1.5 },
    atIntersection: { level: 1, pitch: 0.6, wave: 'sine' },
    proximityBeep: { level: 1.3, pitch: 1.5, wave: 'square' },
    turnCue: { level: 1, pitch: 0.7, wave: 'sawtooth' },
    routeTurnHere: { level: 1, pitch: 1.3, wave: 'sine' },
    wrongWay: { level: 1.2, pitch: 0.7, wave: 'sawtooth' },
    deadEnd: { level: 1.2, pitch: 0.6, wave: 'square' },
  },
};


export const THEME_TEXT: Record<SoundTheme, string> = {
  classic: 'Classic sounds.',
  soft: 'Soft sounds: gentler and quieter.',
  distinct: 'Distinct sounds: each cue has its own timbre and pitch.',
};
