// Watches the rear camera for a pedestrian signal and beeps and buzzes for it: fast for Walk, slow for Don't Walk.
// ponytail: counts saturated bright green and red pixels only. A white (US) walk figure looks like any white
// glare, so it is not detected; add a shape or model check (TensorFlow.js) if that is needed.

export type SignalState = 'walk' | 'dontWalk' | 'none';

export interface SignalOptions {
  /** the video element that shows the camera; it must be in the page, and may be hidden from view */
  video: HTMLVideoElement;
  /** called when the confirmed state changes */
  onChange?: (state: SignalState) => void;
  /** frames analysed per second */
  fps?: number;
  /** lit pixels, as a fraction of the frame, needed before a colour counts as a signal */
  minFraction?: number;
  /** same reading in a row before the state changes, so one noisy frame does not flip the alert */
  confirmFrames?: number;
  /** milliseconds between beeps while Walk shows */
  walkBeepMs?: number;
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

/** Classify RGBA pixels: whichever of lit green or lit red covers the larger share, if it covers enough of the frame. */
export function classify(rgba: Uint8ClampedArray, minFraction = 0.004): SignalState {
  let green = 0;
  let red = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const [h, s, v] = hsv(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (s < 0.6 || v < 0.7) continue; // a lit lamp is bright and saturated; paint and foliage are not
    if (h >= 90 && h <= 175) green++;
    else if (h <= 40 || h >= 340) red++; // the US "hand" is orange-red
  }
  const need = (rgba.length / 4) * minFraction;
  if (Math.max(green, red) < need) return 'none';
  return green > red ? 'walk' : 'dontWalk';
}

export class SignalWatcher {
  private readonly o: Required<Omit<SignalOptions, 'onChange'>> & Pick<SignalOptions, 'onChange'>;
  private readonly canvas = document.createElement('canvas');
  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private scan: ReturnType<typeof setInterval> | undefined;
  private alert: ReturnType<typeof setInterval> | undefined;
  private state: SignalState = 'none';
  private candidate: SignalState = 'none';
  private run = 0;

  constructor(options: SignalOptions) {
    this.o = { fps: 5, minFraction: 0.004, confirmFrames: 3, walkBeepMs: 250, dontWalkBeepMs: 1200, ...options };
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
    ctx.drawImage(video, 0, 0, SIZE.w, SIZE.h);
    const seen = classify(ctx.getImageData(0, 0, SIZE.w, SIZE.h).data, this.o.minFraction);
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
    navigator.vibrate?.(0);
    if (next !== 'none') {
      const walk = next === 'walk';
      const tick = () => {
        this.beep(walk ? 1000 : 400);
        if (walk) navigator.vibrate?.(300); // re-issued every tick, so it reads as one continuous buzz
      };
      tick();
      this.alert = setInterval(tick, walk ? this.o.walkBeepMs : this.o.dontWalkBeepMs);
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
