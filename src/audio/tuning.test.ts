import { describe, expect, it } from 'vitest';
import { cueLevelScale, duckGain, placeSpeech, placeSpeechGap } from './tuning';

describe('speech tuning', () => {
  it('leaves walking speed as before', () => {
    for (const v of [0.5, 1.4, 3]) {
      expect(placeSpeechGap(v)).toBeCloseTo(1.2 + Math.min(2.8, v / 6));
      expect(duckGain(v)).toBe(0.45);
      expect(cueLevelScale(v, true)).toBe(1);
      expect(placeSpeech('Cafe', 'cafe', 'on your left', '40 metres', v)).toBe('Cafe, cafe, on your left, 40 metres');
    }
  });
  it('speaks less often and more tersely when fast', () => {
    expect(placeSpeechGap(20)).toBeGreaterThan(placeSpeechGap(3));
    expect(placeSpeech('Cafe', 'cafe', 'on your left', '40 metres', 20)).toBe('Cafe, on your left');
  });
  it('ducks deeper and lowers cues only while speaking fast', () => {
    expect(duckGain(30)).toBeCloseTo(0.25);
    expect(duckGain(10)).toBeLessThan(0.45);
    expect(cueLevelScale(20, true)).toBeLessThan(1);
    expect(cueLevelScale(20, false)).toBe(1);
  });
});
