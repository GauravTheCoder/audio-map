// Sound profiles: how much ambient sound plays, scaled to the vehicle. Full is every place and
// junction; Simple drops minor places and side-street junctions as the vehicle gets faster;
// Minimal keeps only landmarks and main-road junctions. Route turns and warnings always play.

import type { Junction, Place } from './world';
import type { VehicleId } from './settings';

export type SoundProfile = 'full' | 'simple' | 'minimal';

type ByVehicle<T> = Record<VehicleId, T>;

const MIN_TIER: Record<SoundProfile, ByVehicle<number>> = {
  full: { walker: 0, bicycle: 0, car: 0, helicopter: 0 },
  simple: { walker: 0, bicycle: 1, car: 2, helicopter: 2 },
  minimal: { walker: 2, bicycle: 2, car: 3, helicopter: 3 },
};

const MAJOR_ONLY: Record<SoundProfile, ByVehicle<boolean>> = {
  full: { walker: false, bicycle: false, car: false, helicopter: false },
  simple: { walker: false, bicycle: false, car: true, helicopter: true },
  minimal: { walker: false, bicycle: true, car: true, helicopter: true },
};

/** intersection beeps and compass ticks */
const EXTRAS: Record<SoundProfile, ByVehicle<boolean>> = {
  full: { walker: true, bicycle: true, car: true, helicopter: true },
  simple: { walker: true, bicycle: true, car: false, helicopter: false },
  minimal: { walker: false, bicycle: false, car: false, helicopter: false },
};

export const PROFILE_TEXT: Record<SoundProfile, string> = {
  full: 'Full sound: every place and intersection.',
  simple: 'Simple sound: fewer places and side streets as you go faster.',
  minimal: 'Minimal sound: landmarks and main roads only.',
};

const PROFILES: SoundProfile[] = ['full', 'simple', 'minimal'];

export const nextProfile = (p: SoundProfile): SoundProfile => PROFILES[(PROFILES.indexOf(p) + 1) % PROFILES.length];

/** 2 landmark, 1 notable, 0 everyday (cafes, shops, bus stops) */
export function placeTier(p: Place): number {
  if (p.group === 'culture' || p.group === 'nature' || p.category === 'station' || p.category === 'hospital') return 2;
  if (p.group === 'health' || (p.group === 'transport' && p.category !== 'bus stop')) return 1;
  return 0;
}

export const placeWanted = (profile: SoundProfile, v: VehicleId, p: Place) => placeTier(p) >= MIN_TIER[profile][v];

export const extrasWanted = (profile: SoundProfile, v: VehicleId) => EXTRAS[profile][v];

const MAIN = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link']);

/** Whether ambient sounds should skip this junction: a side-street junction in a profile that wants main roads only. */
export function junctionQuiet(profile: SoundProfile, v: VehicleId, j: Junction): boolean {
  if (!MAJOR_ONLY[profile][v]) return false;
  return !(j.signals || j.exits.some((e) => MAIN.has(e.edge.way.type) || e.edge.way.roundabout));
}
