// Live GPS mode: real location and compass from the device, to guide an actual walk.

import { normDeg, relAngle } from './geo';

export interface GpsFix {
  lat: number;
  lon: number;
  /** metres per second; 0 when the device does not report it */
  speed: number;
  /** direction of travel in degrees, when the device reports one */
  heading: number | null;
  /** radius in metres within which the position is 68% likely to lie, when reported */
  accuracy: number | null;
}

/** Filtered position in local metres, with its estimated accuracy and the time (s) of the last fix. */
export interface Estimate {
  x: number;
  y: number;
  acc: number;
  t: number;
}

/** Fixes worse than this are ignored once a good one has arrived. */
export const POOR_ACCURACY = 100;
/** Snapping to the nearest road is only trusted when the fix is at least this good (metres). */
const SNAP_MAX = 30;
/** Accuracy assumed when the device reports none. */
export const DEFAULT_ACCURACY = 15;

export type GpsProblem = 'denied' | 'nosignal' | 'unsupported';

/** Below this speed the GPS course is noise, so it is not used for heading. */
const MIN_COURSE_SPEED = 1;

export interface OrientationLike {
  webkitCompassHeading?: number;
  alpha?: number | null;
  absolute?: boolean;
}

/** Compass heading (0 = north, clockwise) from an orientation event, or null if it is not relative to north. */
export function compassHeading(e: OrientationLike): number | null {
  if (typeof e.webkitCompassHeading === 'number') return normDeg(e.webkitCompassHeading);
  if (e.absolute && typeof e.alpha === 'number') return normDeg(360 - e.alpha);
  return null;
}

/** The compass when there is one; otherwise the GPS course, but only while actually moving. */
export function pickHeading(compass: number | null, course: number | null, speed: number): number | null {
  if (compass !== null) return compass;
  return course !== null && speed >= MIN_COURSE_SPEED ? normDeg(course) : null;
}

/**
 * Blend a new fix into the estimate, weighting each by its accuracy: a poor fix moves us little, a good one a lot.
 * The estimate's own uncertainty grows with the time since the last fix and the speed we may have covered.
 */
export function fuse(prev: Estimate | null, x: number, y: number, acc: number, t: number, speed: number): Estimate {
  // a NaN position, speed or a zero accuracy would poison every later estimate
  if (!Number.isFinite(x + y)) return prev ?? { x: 0, y: 0, acc: 1000, t };
  acc = Math.max(acc, 1);
  if (!prev) return { x, y, acc, t };
  const reach = Math.max(Number.isFinite(speed) ? speed : 0, 1) * Math.max(0, t - prev.t);
  const pv = prev.acc ** 2 + reach ** 2;
  const k = pv / (pv + acc ** 2);
  return { x: prev.x + (x - prev.x) * k, y: prev.y + (y - prev.y) * k, acc: Math.sqrt((1 - k) * pv), t };
}

/** Search radius for snapping to a road, or 0 when the position is too uncertain to snap. */
export function snapRadius(acc: number): number {
  return acc <= SNAP_MAX ? Math.max(acc, 10) : 0;
}

/** Speed (m/s) and course from two timed positions, for devices that report neither; null when too close in time. */
export function motionBetween(a: { lat: number; lon: number; t: number }, b: { lat: number; lon: number; t: number }): { speed: number; heading: number } | null {
  const dt = (b.t - a.t) / 1000;
  if (dt < 0.5) return null;
  const R = 6_371_000;
  const dx = (relAngle(a.lon, b.lon) * Math.PI) / 180 * R * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dy = ((b.lat - a.lat) * Math.PI) / 180 * R;
  return { speed: Math.hypot(dx, dy) / dt, heading: normDeg((Math.atan2(dx, dy) * 180) / Math.PI) };
}

/** Move angle `from` a fraction k of the way to `to`, the short way round north. */
export function easeAngle(from: number, to: number, k: number): number {
  return normDeg(from + relAngle(from, to) * Math.max(0, Math.min(1, k)));
}

export class LiveGps {
  compass: number | null = null;
  private watch: number | null = null;
  private lost = false;
  private stopped = false;
  private prev: { lat: number; lon: number; t: number } | null = null;

  constructor(
    private onFix: (f: GpsFix) => void,
    private onProblem: (p: GpsProblem) => void,
    private onRecovered: () => void,
  ) {}

  private onOrientation = (e: Event) => {
    const h = compassHeading(e as unknown as OrientationLike);
    if (h !== null) this.compass = h;
  };

  /** Call from a key press or click: iOS only asks for compass permission inside a user gesture. */
  async start(): Promise<boolean> {
    if (!('geolocation' in navigator)) {
      this.onProblem('unsupported');
      return false;
    }
    const DOE = (window as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    // a refused compass is not fatal: GPS course still works while moving
    const compassOk = DOE?.requestPermission ? DOE.requestPermission().then((r) => r === 'granted', () => false) : Promise.resolve(true);
    const granted = await compassOk;
    // turned off while the permission prompt was open
    if (this.stopped) return false;
    if (granted) {
      window.addEventListener('deviceorientationabsolute', this.onOrientation);
      window.addEventListener('deviceorientation', this.onOrientation);
    }
    this.watch = navigator.geolocation.watchPosition(
      (p) => {
        if (this.lost) {
          this.lost = false;
          this.onRecovered();
        }
        const c = p.coords;
        const here = { lat: c.latitude, lon: c.longitude, t: p.timestamp };
        // some devices report no speed or course; work them out from the last fix
        const course = c.heading === null || Number.isNaN(c.heading) ? null : c.heading;
        const m = c.speed === null || course === null ? this.prev && motionBetween(this.prev, here) : null;
        this.prev = here;
        const speed = c.speed !== null && Number.isFinite(c.speed) ? c.speed : (m?.speed ?? 0);
        const heading = course ?? m?.heading ?? null;
        this.onFix({ lat: c.latitude, lon: c.longitude, speed, heading, accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) return this.onProblem('denied');
        if (!this.lost) {
          this.lost = true;
          this.onProblem('nosignal');
        }
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15_000 },
    );
    return true;
  }

  stop() {
    this.stopped = true;
    if (this.watch !== null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
    window.removeEventListener('deviceorientationabsolute', this.onOrientation);
    window.removeEventListener('deviceorientation', this.onOrientation);
  }
}
