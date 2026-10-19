import { describe, expect, it } from 'vitest';
import { classify } from './signal';

const W = 20;
const inCentre = (p: number) => {
  const x = p % W;
  const y = Math.floor(p / W);
  return x >= 5 && x < 15 && y >= 4 && y < 16;
};

/** A 20x20 frame of dark grey with `count` pixels of the given colour in the middle, and optionally some of a second colour. */
function frame(rgb: [number, number, number], count: number, other?: [[number, number, number], number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * W * 4);
  const lit = [...Array(W * W).keys()].filter(inCentre);
  for (let p = 0; p < W * W; p++) d.set([40, 40, 40, 255], p * 4);
  lit.slice(0, count).forEach((p) => d.set([...rgb, 255], p * 4));
  if (other) lit.slice(-other[1]).forEach((p) => d.set([...other[0], 255], p * 4));
  return d;
}

describe('classify', () => {
  it('never sees green as walk', () => expect(classify(frame([20, 230, 90], 100), W)).toBe('none'));
  it('sees a lit red signal as dont walk', () => expect(classify(frame([240, 30, 20], 8), W)).toBe('dontWalk'));
  it('sees an orange hand as dont walk', () => expect(classify(frame([255, 90, 0], 8), W)).toBe('dontWalk'));
  it('ignores a frame with too few lit pixels', () => expect(classify(frame([240, 30, 20], 1), W)).toBe('none'));
  it('ignores dull colours and white glare', () => {
    expect(classify(frame([90, 120, 90], 100), W)).toBe('none');
    expect(classify(frame([255, 255, 255], 100), W)).toBe('none');
  });
  it('ignores a red light at the edge of the frame', () => {
    const d = new Uint8ClampedArray(W * W * 4).fill(40);
    for (let p = 0; p < 8; p++) d.set([240, 30, 20, 255], p * 4);
    expect(classify(d, W)).toBe('none');
  });
  it('still warns when only a stray green speck shows beside red', () => {
    expect(classify(frame([240, 30, 20], 8, [[20, 230, 90], 1]), W)).toBe('dontWalk');
  });
  it('is unsure when red and green both show', () => {
    expect(classify(frame([240, 30, 20], 8, [[20, 230, 90], 8]), W)).toBe('unsure');
  });
});
