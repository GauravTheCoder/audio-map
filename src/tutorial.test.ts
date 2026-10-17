import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tutorial, type Snap } from './tutorial';

const key = (code: string) => ({ key: code, code, shift: false, ctrl: false, alt: false, repeat: false });

let snap: Snap;
let said: string[];
let t: Tutorial;

beforeEach(() => {
  vi.useFakeTimers();
  snap = { ready: true, speed: 0, heading: 0, vehicle: 'walker', hasDest: false };
  said = [];
  t = new Tutorial({ say: (x: string) => void said.push(x) } as any, { loaded() {} } as any, () => ({ ...snap }));
  t.begin();
});
afterEach(() => vi.useRealTimers());

const press = (...codes: string[]) => codes.forEach((c) => t.onKey(key(c)));
const wait = (ms: number) => vi.advanceTimersByTime(ms);

describe('tutorial checks', () => {
  it('does not pass "move" on the key press alone, then hints', () => {
    press('ArrowUp');
    wait(2300);
    expect(said.at(-1)).toBe('You are not moving yet. Keep holding the up arrow.');
    expect(said).not.toContain('Good.');
  });

  it('passes "move" once the speed rises after the press', () => {
    press('ArrowUp');
    wait(400);
    snap.speed = 1;
    wait(400);
    wait(700);
    expect(said).toContain('Good.');
  });

  it('turning passes only when the heading changed', () => {
    snap.speed = 3;
    t.onKey(key('Backslash')); // skip to brake
    wait(800);
    t.onKey(key('Backslash')); // skip to turn
    wait(800);
    press('ArrowLeft', 'ArrowRight');
    wait(2300);
    expect(said.at(-1)).toBe('Your heading did not change. Try the arrows again.');
    press('ArrowLeft', 'ArrowRight');
    snap.heading = 350;
    wait(1500);
    expect(said).toContain('Good.');
  });

  it('waits for the map before passing anything', () => {
    snap.ready = false;
    press('ArrowUp');
    wait(2300);
    expect(said.at(-1)).toBe('The map has not loaded yet.');
  });

  it('Delete exits while a check is pending', () => {
    press('ArrowUp');
    t.onKey(key('Delete'));
    wait(3000);
    expect(said.at(-1)).toBe('Tutorial finished. Back to normal play.');
  });
});
