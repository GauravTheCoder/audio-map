// Keyboard state for the game loop. Held keys are tracked via keydown/keyup so "hold to accelerate"
// is independent of the OS key-repeat rate. Discrete commands are delivered through onCommand.

export interface Command {
  key: string;
  code: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  repeat: boolean;
}

export class Input {
  private held = new Set<string>();
  private target: HTMLElement | null = null;
  onCommand?: (c: Command) => boolean | void;

  private down = (e: KeyboardEvent) => {
    // leave screen-reader modifier combos and browser essentials alone
    if (e.key === 'Insert' || e.key === 'CapsLock' || e.metaKey) return;
    if (e.ctrlKey && ['r', 'l', 't', 'w', 'n'].includes(e.key.toLowerCase())) return;
    this.held.add(e.code);
    const handled = this.onCommand?.({
      key: e.key,
      code: e.code,
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      repeat: e.repeat,
    });
    if (handled !== false) e.preventDefault();
  };

  private up = (e: KeyboardEvent) => {
    this.held.delete(e.code);
    this.onKeyUp?.(e.code);
  };

  private blur = () => this.held.clear();

  onKeyUp?: (code: string) => void;

  attach(el: HTMLElement) {
    this.detach();
    this.target = el;
    el.addEventListener('keydown', this.down);
    el.addEventListener('keyup', this.up);
    el.addEventListener('blur', this.blur);
  }

  detach() {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.down);
    this.target.removeEventListener('keyup', this.up);
    this.target.removeEventListener('blur', this.blur);
    this.held.clear();
    this.target = null;
  }

  /** Holds or releases a key without a keyboard event (touch and voice). */
  setHeld(code: string, on: boolean) {
    if (on) this.held.add(code);
    else this.held.delete(code);
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  get shift(): boolean {
    return this.held.has('ShiftLeft') || this.held.has('ShiftRight');
  }
}
