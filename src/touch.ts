// Touch gestures for phones without a keyboard. They run the same commands as the keys, via Game.run.
import type { ActionId, Binding } from './keymap';

export type Gesture =
  | 'tap'
  | 'two-tap'
  | 'long-press'
  | 'swipe-up'
  | 'swipe-down'
  | 'swipe-left'
  | 'swipe-right'
  | 'two-swipe-left'
  | 'two-swipe-right';

const TAP_MAX = 12;
const SWIPE_MIN = 40;
const LONG_MS = 500;

export function classify(dx: number, dy: number, ms: number, fingers: number): Gesture | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < TAP_MAX && ay < TAP_MAX) return fingers > 1 ? 'two-tap' : ms >= LONG_MS ? 'long-press' : 'tap';
  if (Math.max(ax, ay) < SWIPE_MIN) return null;
  if (ax > ay) return `${fingers > 1 ? 'two-' : ''}swipe-${dx < 0 ? 'left' : 'right'}` as Gesture;
  return fingers > 1 ? null : dy < 0 ? 'swipe-up' : 'swipe-down';
}

/** What a command does: press a key, or start accelerating or braking. */
export type Action = { key: string; shift?: boolean; ctrl?: boolean } | { action: ActionId } | { drive: 'go' | 'brake' };

export interface Driver {
  run(key: string, mods?: { shift?: boolean; ctrl?: boolean }): void;
  keyFor(id: ActionId): Binding;
  hold(code: string, on: boolean): void;
}

const BRAKE_MS = 1500;
let brakeTimer: ReturnType<typeof setTimeout> | undefined;

export function perform(game: Driver, a: Action) {
  if ('action' in a) {
    const b = game.keyFor(a.action);
    return game.run(b.key, b);
  }
  if (!('drive' in a)) return game.run(a.key, a);
  clearTimeout(brakeTimer);
  // press the new key before releasing the old one, so the switch itself is not announced as a stop
  if (a.drive === 'go') {
    game.hold('ArrowUp', true);
    game.hold('Slash', false);
  } else {
    game.hold('Slash', true);
    game.hold('ArrowUp', false);
  }
  // a swipe is momentary, so braking lets go by itself instead of needing a second gesture
  if (a.drive === 'brake') brakeTimer = setTimeout(() => game.hold('Slash', false), BRAKE_MS);
}

export const GESTURES: Record<Gesture, Action> = {
  tap: { action: 'whereAmI' },
  'two-tap': { action: 'menu' },
  'long-press': { action: 'reviewBack' },
  'swipe-up': { drive: 'go' },
  'swipe-down': { drive: 'brake' },
  'swipe-left': { key: 'ArrowLeft', shift: true },
  'swipe-right': { key: 'ArrowRight', shift: true },
  'two-swipe-left': { key: 'ArrowLeft', ctrl: true },
  'two-swipe-right': { key: 'ArrowRight', ctrl: true },
};

/** Only touches on the game surface itself are taken; buttons and form controls keep their own behavior. */
export function setupTouch(stage: HTMLElement, getGame: () => Driver | null) {
  let start: { x: number; y: number; t: number } | null = null;
  let fingers = 0;
  const own = (e: TouchEvent) => e.target === stage || (e.target as Element).closest('#map, #hud') !== null;

  stage.addEventListener(
    'touchstart',
    (e) => {
      if (!own(e)) return;
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        start = { x: t.clientX, y: t.clientY, t: e.timeStamp };
        fingers = 1;
      } else fingers = Math.max(fingers, e.touches.length);
    },
    { passive: false },
  );
  stage.addEventListener(
    'touchend',
    (e) => {
      if (!start || e.touches.length > 0) return;
      e.preventDefault();
      const t = e.changedTouches[0];
      const g = classify(t.clientX - start.x, t.clientY - start.y, e.timeStamp - start.t, fingers);
      start = null;
      const game = getGame();
      if (g && game) perform(game, GESTURES[g]);
    },
    { passive: false },
  );
  stage.addEventListener('touchcancel', () => (start = null));
}
