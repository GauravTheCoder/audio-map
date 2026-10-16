export type SpeechMode = 'screenreader' | 'voice';
export type Units = 'metric' | 'imperial';
export type VehicleId = 'walker' | 'bicycle' | 'car' | 'helicopter';

export interface Settings {
  vehicle: VehicleId;
  speechMode: SpeechMode;
  voiceRate: number;
  units: Units;
  announcePlaces: boolean;
  announceStreets: boolean;
  announceHeadingAfterTurn: boolean;
  compassTicks: boolean;
  roadAssist: boolean;
  proximityBeeps: boolean;
  turnByTurn: boolean;
  beaconSound: boolean;
  headingUpMap: boolean;
  volume: number;
}

const DEFAULTS: Settings = {
  vehicle: 'walker',
  speechMode: 'screenreader',
  voiceRate: 1.3,
  units: 'metric',
  announcePlaces: true,
  announceStreets: true,
  announceHeadingAfterTurn: true,
  compassTicks: true,
  roadAssist: true,
  proximityBeeps: true,
  turnByTurn: true,
  beaconSound: true,
  headingUpMap: true,
  volume: 0.8,
};

const KEY = 'audio-map-settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // storage unavailable: fall through to defaults
  }
  return { ...DEFAULTS };
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
