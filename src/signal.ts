// Watches the rear camera for a lit red or orange pedestrian signal and beeps slowly for it.
// It reports 'unsure' when red and green both show. It never reports Walk: a green blob is as likely a car light or a sign as a pedestrian signal, and a white (US)
// walk figure looks like any white glare. A false Walk is the one mistake this must not make.
// ponytail: counts saturated bright red pixels only. Add a symbol detector (e.g. a small TensorFlow.js model) before reporting Walk.

export type SignalState = 'walk' | 'dontWalk' | 'unsure' | 'none';

export interface SignalOptions {
  /** the video element that shows the camera; it must be in the page, and may be hidden from view */
  video: HTMLVideoElement;
  /** called when the confirmed state changes */
  onChange?: (state: SignalState) => void;
  /** frames are looked at only while this returns true, e.g. at a mapped signal crossing; any other frame reads as no signal */
  gate?: () => boolean;
  /** frames analysed per second */
  fps?: number;
  /** lit pixels, as a fraction of the frame, needed before a colour counts as a signal */
  minFraction?: number;
  /** same reading in a row before the state changes, so one noisy frame does not flip the alert */
  confirmFrames?: number;
  /** milliseconds between beeps while Don't Walk shows */
  dontWalkBeepMs?: number;
}

const SIZE = { w: 64, h: 48 }; // frames are shrunk to this before counting; a signal is still several pixels wide
const LOST_FRAMES = 10; // frames with no signal before the alert goes quiet

/** Hue (degrees), saturation and value (0-1) of an RGB pixel. */
function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max ? d / max : 0, max / 255];
}

/**
 * Classify RGBA pixels of a frame `width` pixels wide. Only the middle of the frame counts: the signal being
 * crossed is aimed at, so side lights are not ours. Lit red or orange there is Don't Walk; if lit green shows
 * too, it is a traffic scene and which light is ours cannot be told, so the answer is 'unsure'.
 */
export function classify(rgba: Uint8ClampedArray, width: number, minFraction = 0.004): SignalState {
  const rows = rgba.length / 4 / width;
  let green = 0;
  let red = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const x = (i / 4) % width;
    const y = Math.floor(i / 4 / width);
    if (x < width * 0.25 || x >= width * 0.75 || y < rows * 0.2 || y >= rows * 0.8) continue;
    const [h, s, v] = hsv(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (s < 0.6 || v < 0.7) continue; // a lit lamp is bright and saturated; paint and foliage are not
    if (h >= 90 && h <= 175) green++;
    else if (h <= 40 || h >= 340) red++; // the US "hand" is orange-red
  }
  const need = (rgba.length / 4) * minFraction;
  if (red < need) return 'none';
  return green >= need ? 'unsure' : 'dontWalk';
}

export class SignalWatcher {
  private readonly o: Required<Omit<SignalOptions, 'onChange' | 'gate'>> & Pick<SignalOptions, 'onChange' | 'gate'>;
  private readonly canvas = document.createElement('canvas');
  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private scan: ReturnType<typeof setInterval> | undefined;
  private alert: ReturnType<typeof setInterval> | undefined;
  private state: SignalState = 'none';
  private candidate: SignalState = 'none';
  private run = 0;

  constructor(options: SignalOptions) {
    this.o = { fps: 5, minFraction: 0.004, confirmFrames: 3, dontWalkBeepMs: 1200, ...options };
    this.canvas.width = SIZE.w;
    this.canvas.height = SIZE.h;
  }

  get active(): boolean {
    return this.stream !== null;
  }

  /** Open the rear camera and start watching. Call from a tap: browsers allow sound only after one. Rejects if the camera is refused. */
  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    this.o.video.srcObject = this.stream;
    this.o.video.muted = true;
    this.o.video.setAttribute('playsinline', '');
    await this.o.video.play();
    this.audio = new AudioContext();
    this.scan = setInterval(() => this.frame(), 1000 / this.o.fps);
  }

  /** Stop the camera, the beeps and the buzz. Safe to call twice; call it when the screen closes. */
  stop(): void {
    clearInterval(this.scan);
    this.scan = undefined;
    this.setState('none');
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.o.video.srcObject = null;
    void this.audio?.close();
    this.audio = null;
  }

  private frame(): void {
    const { video } = this.o;
    if (video.readyState < 2) return;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    let seen: SignalState = 'none';
    if (this.o.gate?.() !== false) {
      ctx.drawImage(video, 0, 0, SIZE.w, SIZE.h);
      seen = classify(ctx.getImageData(0, 0, SIZE.w, SIZE.h).data, SIZE.w, this.o.minFraction);
    }
    // a signal needs a few frames in a row to appear, and a longer gap to go away: lamps flicker and cars pass
    const need = seen === 'none' ? LOST_FRAMES : this.o.confirmFrames;
    this.run = seen === this.candidate ? this.run + 1 : 1;
    this.candidate = seen;
    if (this.run >= need && seen !== this.state) this.setState(seen);
  }

  private setState(next: SignalState): void {
    if (next === this.state) return;
    this.state = next;
    clearInterval(this.alert);
    this.alert = undefined;
    if (next === 'dontWalk') {
      this.beep(400);
      this.alert = setInterval(() => this.beep(400), this.o.dontWalkBeepMs);
    }
    this.o.onChange?.(next);
  }

  private beep(hz: number): void {
    const a = this.audio;
    if (!a) return;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.3, a.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.12);
    osc.connect(gain).connect(a.destination);
    osc.start();
    osc.stop(a.currentTime + 0.12);
  }
}
