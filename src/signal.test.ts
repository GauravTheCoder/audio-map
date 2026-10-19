import { describe, expect, it } from 'vitest';
import { classify } from './signal';

/** A 20x20 frame of dark grey with `count` pixels of the given colour. */
function frame(rgb: [number, number, number], count: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(20 * 20 * 4);
  for (let i = 0; i < 400; i++) d.set(i < count ? [...rgb, 255] : [40, 40, 40, 255], i * 4);
  return d;
}

describe('classify', () => {
  it('sees a lit green signal as walk', () => expect(classify(frame([20, 230, 90], 8))).toBe('walk'));
  it('sees a lit red signal as dont walk', () => expect(classify(frame([240, 30, 20], 8))).toBe('dontWalk'));
  it('sees an orange hand as dont walk', () => expect(classify(frame([255, 90, 0], 8))).toBe('dontWalk'));
  it('ignores a frame with too few lit pixels', () => expect(classify(frame([240, 30, 20], 1))).toBe('none'));
  it('ignores dull colours and white glare', () => {
    expect(classify(frame([90, 120, 90], 100))).toBe('none');
    expect(classify(frame([255, 255, 255], 100))).toBe('none');
  });
  it('picks the larger of two lit colours', () => {
    const d = frame([20, 230, 90], 10);
    d.set([240, 30, 20, 255], 399 * 4);
    d.set([240, 30, 20, 255], 398 * 4);
    expect(classify(d)).toBe('walk');
  });
});
