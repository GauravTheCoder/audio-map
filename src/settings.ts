import type { KeyOverrides } from './keymap';
import type { CustomSound, SoundProfile } from './profiles';
import type { PlaceGroup } from './world';

export type SpeechMode = 'screenreader' | 'voice';
export type Units = 'metric' | 'imperial';
export type VehicleId = 'walker' | 'bicycle' | 'car' | 'helicopter';
/** high contrast with larger text, roads and markers (the default), or the standard map look */
export type DisplayMode = 'highContrast' | 'standard';
/** walking routes: shortest (any footpath) or along streets and their pavements */
export type WalkRoute = 'shortest' | 'streets';

export interface Settings {
  vehicle: VehicleId;
  speechMode: SpeechMode;
  voiceRate: number;
  units: Units;
  announcePlaces: boolean;
  announceHazards: boolean;
  announceStreets: boolean;
  announceHeadingAfterTurn: boolean;
  compassTicks: boolean;
  roadAssist: boolean;
  proximityBeeps: boolean;
  turnByTurn: boolean;
  beaconSound: boolean;
  headingUpMap: boolean;
  display: DisplayMode;
  walkRoute: WalkRoute;
  /** walking routes avoid steps and steep slopes */
  accessibleRoute: boolean;
  soundProfile: SoundProfile;
  customSound: CustomSound;
  /** the profile last chosen while using each vehicle */
  vehicleProfiles: Partial<Record<VehicleId, SoundProfile>>;
  volume: number;
  /** place groups silenced while moving; on-demand lookups ignore this */
  mutedGroups: PlaceGroup[];
  /** keys the player moved away from the defaults, by action */
  keyBindings: KeyOverrides;
}

const DEFAULTS: Settings = {
  vehicle: 'walker',
  speechMode: 'screenreader',
  voiceRate: 1.3,
  units: 'metric',
  announcePlaces: true,
  announceHazards: true,
  announceStreets: true,
  announceHeadingAfterTurn: true,
  compassTicks: true,
  roadAssist: true,
  proximityBeeps: true,
  turnByTurn: true,
  beaconSound: true,
  headingUpMap: true,
  display: 'highContrast',
  walkRoute: 'shortest',
  accessibleRoute: false,
  soundProfile: 'simple',
  customSound: { places: 'notable', sideStreets: true, extras: true },
  vehicleProfiles: {},
  volume: 0.8,
  mutedGroups: [],
  keyBindings: {},
};

const KEY = 'audio-map-settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...JSON.parse(raw) } as Settings;
      // earlier names: 'default' (never chosen, just the old default) and 'lowVision'
      if (s.display !== 'standard') s.display = 'highContrast';
      if (!Array.isArray(s.mutedGroups)) s.mutedGroups = [];
      if (typeof s.keyBindings !== 'object' || !s.keyBindings) s.keyBindings = {};
      return s;
    }
  } catch {
    // storage unavailable: fall through to defaults
  }
  return { ...DEFAULTS, mutedGroups: [], keyBindings: {} };
}


export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function fmtDistance(m: number, units: Units): string {
  if (units === 'imperial') {
    const ft = m * 3.28084;
    if (ft < 1000) return `${roundTo(ft, ft < 100 ? 10 : 50)} feet`;
    const mi = m / 1609.34;
    return `${mi.toFixed(mi < 10 ? 1 : 0)} miles`;
  }
  if (m < 1000) return `${roundTo(m, m < 50 ? 5 : m < 200 ? 10 : 50)} metres`;
  const km = m / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0)} kilometres`;
}

export function fmtSpeed(mps: number, units: Units): string {
  if (units === 'imperial') return `${Math.round(mps * 2.23694)} miles per hour`;
  return `${Math.round(mps * 3.6)} kilometres per hour`;
}

export function fmtSpeedShort(mps: number, units: Units): string {
  return units === 'imperial' ? `${Math.round(mps * 2.23694)} mph` : `${Math.round(mps * 3.6)} km/h`;
}

function roundTo(v: number, step: number): number {
  return Math.max(step, Math.round(v / step) * step);
}
