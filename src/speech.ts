// Speech output. Two backends:
//  - screenreader: ARIA live regions read by NVDA / JAWS / Narrator / VoiceOver in the user's own voice.
//  - voice: the browser's built-in speech synthesis.

import type { SpeechMode } from './settings';

export type Priority = 'high' | 'normal' | 'low';

export class Speech {
  private polite: HTMLElement;
  private assertive: HTMLElement;
  private flip = false;
  private queued = new WeakMap<HTMLElement, () => void>();
  private history: string[] = [];
  private historyPos = -1;
  private lastText = '';
  private lastAt = 0;
  private lowBusyUntil = 0;
  onSpeakingChange?: (speaking: boolean) => void;

  constructor(
    private mode: SpeechMode,
    private rate: number,
  ) {
    this.polite = mkRegion('polite');
    this.assertive = mkRegion('assertive');
  }

  configure(mode: SpeechMode, rate: number) {
    if (mode !== this.mode) this.stop();
    this.mode = mode;
    this.rate = rate;
  }

  /**
   * high: interrupts whatever is being said (turn warnings, answers to key presses).
   * normal: queued after current speech.
   * low: dropped if something else was said very recently (ambient info like passing places).
   */
  say(text: string, priority: Priority = 'normal') {
    const now = performance.now();
    if (text === this.lastText && now - this.lastAt < 1500 && priority !== 'high') return;
    if (priority === 'low' && now < this.lowBusyUntil) return;
    this.lastText = text;
    this.lastAt = now;
    this.lowBusyUntil = now + Math.min(4000, 600 + text.length * 45);

    this.history.push(text);
    if (this.history.length > 100) this.history.shift();
    this.historyPos = this.history.length;

    this.output(text, priority);
  }

  private output(text: string, priority: Priority) {
    if (this.mode === 'voice' && 'speechSynthesis' in window) {
      if (priority === 'high') speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = this.rate;
      u.onstart = () => this.onSpeakingChange?.(true);
      u.onend = u.onerror = () => {
        if (!speechSynthesis.speaking) this.onSpeakingChange?.(false);
      };
      speechSynthesis.speak(u);
      return;
    }
    // Screen reader path. Alternate text nodes so repeating the same message is still announced.
    const region = this.region(priority === 'high');
    const flip = (this.flip = !this.flip);
    const write = () => {
      region.textContent = '';
      const span = document.createElement('span');
      span.textContent = flip ? text : `${text} `;
      region.appendChild(span);
    };
    // screen readers miss content that arrives together with a brand-new live region, so messages
    // in its first moments wait, and only the newest of them is spoken
    const wait = Number(region.dataset.readyAt ?? 0) - performance.now();
    if (wait <= 0) return write();
    const queued = this.queued.has(region);
    this.queued.set(region, write);
    if (!queued)
      setTimeout(() => {
        const w = this.queued.get(region);
        this.queued.delete(region);
        w?.();
      }, wait);
  }

  /** An open modal dialog makes the page inert, so its messages go to a live region inside it. */
  private region(assertive: boolean): HTMLElement {
    const dlgs = document.querySelectorAll('dialog[open]');
    const dlg = dlgs[dlgs.length - 1];
    if (!dlg) return assertive ? this.assertive : this.polite;
    const kind = assertive ? 'assertive' : 'polite';
    const have = dlg.querySelector<HTMLElement>(`:scope > [data-live="${kind}"]`);
    if (have) return have;
    const el = mkRegion(kind, dlg);
    el.dataset.readyAt = String(performance.now() + 100);
    return el;
  }

  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.onSpeakingChange?.(false);
  }

  /** Step through earlier messages: dir -1 = older, +1 = newer. */
  review(dir: -1 | 1) {
    if (!this.history.length) return this.output('No messages yet', 'high');
    this.historyPos = Math.max(0, Math.min(this.history.length - 1, this.historyPos + dir));
    const n = this.historyPos + 1;
    this.output(`${this.history[this.historyPos]}. Message ${n} of ${this.history.length}`, 'high');
  }

  repeatLast() {
    if (this.history.length) this.output(this.history[this.history.length - 1], 'high');
  }
}

function mkRegion(politeness: 'polite' | 'assertive', parent: Element = document.body): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('aria-live', politeness);
  el.setAttribute('aria-atomic', 'true');
  el.className = 'sr-only';
  el.dataset.live = politeness;
  parent.appendChild(el);
  return el;
}
