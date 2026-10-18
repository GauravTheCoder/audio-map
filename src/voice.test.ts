import { describe, expect, it } from 'vitest';
import { matchPhrase } from './voice';

describe('matchPhrase', () => {
  it('matches phrases inside a sentence, ignoring case and punctuation', () => {
    expect(matchPhrase('Where am I?')).toEqual({ key: 'e' });
    expect(matchPhrase('please go faster')).toEqual({ drive: 'go' });
    expect(matchPhrase('Stop!')).toEqual({ drive: 'brake' });
  });
  it('prefers the longest phrase', () => {
    expect(matchPhrase('next road left')).toEqual({ key: 'ArrowLeft', ctrl: true });
  });
  it('matches whole words only and ignores unknown speech', () => {
    expect(matchPhrase('gopher')).toBeNull();
    expect(matchPhrase('banana')).toBeNull();
  });
});
