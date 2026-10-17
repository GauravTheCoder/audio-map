// Guided practice of the keys on the real map. Watches key presses through Game.onKey; never blocks other keys.

import type { AudioEngine } from './audio/audio';
import type { Command } from './input';
import type { Speech } from './speech';

interface Step {
  say: string;
  /** codes to press: in this order, or any one of them when `any` is set */
  seq: string[];
  any?: boolean;
}

const STEPS: Step[] = [
  { say: 'Hold the up arrow to move. Try it now.', seq: ['ArrowUp'] },
  { say: 'Hold the slash key to brake, or the down arrow to slow down.', seq: ['Slash', 'ArrowDown'], any: true },
  { say: 'Press the left arrow, then the right arrow, to turn. Hold Shift for bigger turns.', seq: ['ArrowLeft', 'ArrowRight'] },
  { say: 'Press H to hear your heading.', seq: ['KeyH'] },
  { say: 'Press S to hear your speed.', seq: ['KeyS'] },
  { say: 'Press L to hear where you are.', seq: ['KeyL'] },
  { say: 'Press N to hear the next intersection.', seq: ['KeyN'] },
  { say: 'Press W to hear what is around you.', seq: ['KeyW'] },
  { say: 'Press Tab to browse a nearby place, then Enter to set it as your destination.', seq: ['Tab', 'Enter'] },
  { say: 'Press D to hear the distance to your destination.', seq: ['KeyD'] },
  { say: 'Press I for the next turn-by-turn instruction.', seq: ['KeyI'] },
  { say: 'Press 1, 2, 3 or 4 to change vehicle.', seq: ['Digit1', 'Digit2', 'Digit3', 'Digit4'], any: true },
  { say: 'Press Escape to open the menu.', seq: ['Escape'] },
];

export class Tutorial {
  private step = -1;
  private pos = 0;

  constructor(
    private speech: Speech,
    private audio: AudioEngine,
  ) {}

  begin() {
    this.step = 0;
    this.pos = 0;
    this.speech.say('Learning the keys. Backslash skips a step. Delete exits.', 'high');
    this.speech.say(STEPS[0].say);
  }

  /** returns true when the key was consumed, so the game ignores it */
  onKey(c: Command): boolean {
    if (this.step < 0) {
      if (c.code !== 'F1' || !c.shift) return false;
      if (!c.repeat) this.begin();
      return true;
    }
    if (c.repeat) return c.code === 'Delete' || c.code === 'Backslash';
    if (c.code === 'Delete') {
      this.end('Tutorial finished. Back to normal play.');
      return true;
    }
    if (c.code === 'Backslash') {
      this.next('Skipped.');
      return true;
    }
    const { seq, any } = STEPS[this.step];
    if (any ? seq.includes(c.code) : c.code === seq[this.pos] && ++this.pos === seq.length) {
      this.audio.loaded();
      this.next('Good.');
    }
    return false;
  }

  private next(said: string) {
    const step = ++this.step;
    this.pos = 0;
    if (step >= STEPS.length) return this.end('Good. You know the keys. Press Shift F1 to practise again.');
    // the game answers the key at high priority first; speak after it so it is not cut off
    setTimeout(() => {
      if (this.step !== step) return;
      this.speech.say(said);
      this.speech.say(STEPS[step].say);
    }, 700);
  }

  private end(text: string) {
    this.step = -1;
    this.speech.say(text, 'high');
  }
}
