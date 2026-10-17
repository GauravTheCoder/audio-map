/** Speed (m/s) above which speech is trimmed; walking (max 3) is never affected. */
const BUSY = 3;
/** Speed (m/s) above which place announcements drop their category and distance. */
const TERSE = 6;

/** Seconds between spoken place announcements. Unchanged up to walking speed. */
export function placeSpeechGap(speed: number): number {
  return 1.2 + Math.min(2.8, speed / 6) + (speed > BUSY ? Math.min(4, (speed - BUSY) / 4) : 0);
}

export function placeSpeech(name: string, category: string, side: string, dist: string, speed: number): string {
  return speed > TERSE ? `${name}, ${side}` : `${name}, ${category}, ${side}${dist ? `, ${dist}` : ''}`;
}

/** Gain of continuous sounds while speech plays: 0.45 up to walking speed, sinking to 0.25 at 30 m/s. */
export function duckGain(speed: number): number {
  return 0.45 - 0.2 * Math.max(0, Math.min(1, (speed - BUSY) / 27));
}

/** Scale for one-shot cues (which the bed duck does not touch) while speech plays. */
export function cueLevelScale(speed: number, speaking: boolean): number {
  return speaking && speed > BUSY ? 0.6 : 1;
}
