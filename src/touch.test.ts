import { describe, expect, it } from 'vitest';
import { classify } from './touch';

describe('classify', () => {
  it('tells taps from long presses', () => {
    expect(classify(2, 3, 100, 1)).toBe('tap');
    expect(classify(2, 3, 600, 1)).toBe('long-press');
    expect(classify(0, 0, 100, 2)).toBe('two-tap');
  });
  it('reads swipe direction by the dominant axis', () => {
    expect(classify(5, -80, 200, 1)).toBe('swipe-up');
    expect(classify(5, 80, 200, 1)).toBe('swipe-down');
    expect(classify(-90, 20, 200, 1)).toBe('swipe-left');
    expect(classify(90, 20, 200, 1)).toBe('swipe-right');
  });
  it('ignores small drifts and vertical two-finger swipes', () => {
    expect(classify(25, 0, 200, 1)).toBeNull();
    expect(classify(0, -90, 200, 2)).toBeNull();
    expect(classify(-90, 0, 200, 2)).toBe('two-swipe-left');
  });
});
