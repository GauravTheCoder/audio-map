import { describe, expect, it } from 'vitest';
import { CUES, SOUND_THEMES, THEMES } from './themes';

describe('sound themes', () => {
  it('define every cue with sane numbers', () => {
    for (const t of SOUND_THEMES) {
      expect(Object.keys(THEMES[t]).sort()).toEqual([...CUES].sort());
      for (const c of CUES) {
        expect(THEMES[t][c].level).toBeGreaterThan(0);
        expect(THEMES[t][c].level).toBeLessThanOrEqual(1.5);
        expect(THEMES[t][c].pitch).toBeGreaterThan(0.4);
        expect(THEMES[t][c].pitch).toBeLessThan(2);
      }
    }
  });
  it('keeps classic unchanged', () => {
    for (const c of CUES) expect(THEMES.classic[c]).toEqual({ level: 1, pitch: 1 });
  });
});
