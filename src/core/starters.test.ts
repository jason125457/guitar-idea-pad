import { describe, expect, it } from 'vitest';
import { STARTERS, STARTER_TONICS, chordSymbol, classifyChord, parseChordSymbol, plainRole, starterChords, voiceAfter, type Fret } from './index';

const names = (id: string, tonic: number) => starterChords(STARTERS.find((s) => s.id === id)!, tonic).map((c) => chordSymbol(c));

describe('starters', () => {
  it('spells the classic progressions in C and transposes them', () => {
    expect(names('pop', 0)).toEqual(['C', 'G', 'Am', 'F']);
    expect(names('ballad', 0)).toEqual(['Am', 'F', 'C', 'G']);
    expect(names('canon', 0)).toEqual(['C', 'G', 'Am', 'Em', 'F', 'C', 'F', 'G']);
    expect(names('pop', 7)).toEqual(['G', 'D', 'Em', 'C']);
  });

  it('has a playable shape for every chord of every starter in every offered key and style', () => {
    for (const style of ['open', 'electric'] as const) {
      for (const tonic of STARTER_TONICS) {
        for (const s of STARTERS) {
          let prev: Fret[] | undefined;
          for (const ch of starterChords(s, tonic)) {
            const f = voiceAfter(prev, ch, style);
            expect(f, `${s.id} ${chordSymbol(ch)} ${style}`).toBeTruthy();
            prev = f;
          }
        }
      }
    }
  });
});

describe('plainRole', () => {
  const role = (sym: string) => plainRole(classifyChord(parseChordSymbol(sym)!, 0, 'major'));
  it('names chord roles in plain words instead of roman numerals', () => {
    expect(role('C')).toBe('家');
    expect(role('Cmaj7')).toBe('家');
    expect(role('Am')).toBe('穩');
    expect(role('F')).toBe('展開');
    expect(role('Dm7')).toBe('展開');
    expect(role('G7')).toBe('想回家');
    expect(role('Fm')).toBe('借來的色彩');
    expect(role('A7')).toBe('推一把');
    expect(plainRole(undefined)).toBe('');
  });
});
