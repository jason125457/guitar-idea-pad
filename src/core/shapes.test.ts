import { describe, expect, it } from 'vitest';
import {
  analyzeVoicing,
  chordSymbol,
  computeFingering,
  diatonicChords,
  formatFingers,
  formatFrets,
  parseChordSymbol,
  shapeLibrary,
  shapesFor,
  suggestFingering,
  voiceProgression,
  voiceAfter,
  voicingChoices,
  type Fret,
} from './index';

const k = (fr: readonly Fret[]) => formatFrets(fr);
const f = (t: string): Fret[] => t.split(' ').map((x) => (x === 'x' ? null : Number(x)));

describe('shape library', () => {
  it('every shape is recognised as the chord it is listed under', () => {
    for (const sh of shapeLibrary()) {
      const best = analyzeVoicing(sh.frets).best;
      expect(best && chordSymbol(best), k(sh.frets)).toBe(chordSymbol(sh.chord));
    }
  });

  it('every shape has one finger per pressed string, no more than four fingers plus thumb', () => {
    for (const sh of shapeLibrary()) {
      sh.frets.forEach((fr, i) => {
        const fi = sh.fingers[i];
        if (fr === null) expect(fi, k(sh.frets)).toBeNull();
        else if (fr === 0) expect(fi, k(sh.frets)).toBe(0);
        else expect([1, 2, 3, 4, 'T'], k(sh.frets)).toContain(fi);
      });
      const pressed = sh.frets.filter((x): x is number => x !== null && x > 0);
      expect(Math.max(...pressed) - Math.min(...pressed), k(sh.frets)).toBeLessThanOrEqual(3);
    }
  });

  it('transposes movable shapes to every root', () => {
    const am7 = shapesFor(parseChordSymbol('Am7')!).map((s) => k(s.frets));
    expect(am7).toContain('5 7 5 5 5 5'); // E 型封閉
    expect(am7).toContain('x 12 14 12 13 12'); // A 型封閉
    expect(am7).toContain('5 x 5 5 x x'); // 殼和弦
    expect(am7).toContain('x 0 2 0 1 0'); // 開放和弦
  });
});

describe('computeFingering', () => {
  it('uses an index barre and gives the rest one finger each', () => {
    expect(formatFingers(computeFingering(f('1 3 3 2 1 1'))!)).toBe('1 3 4 2 1 1');
    expect(formatFingers(computeFingering(f('x 3 5 5 5 3'))!)).toBe('x 1 3 3 3 1');
  });
  it('rejects shapes that need five fingers or a stretch past four frets', () => {
    expect(computeFingering(f('x 3 4 5 6 7'))).toBeUndefined();
    expect(computeFingering(f('3 x x x x 8'))).toBeUndefined();
  });
  it('does not barre across a muted string', () => {
    expect(computeFingering(f('5 x 5 6 7 8'))).toBeUndefined();
  });
});

describe('suggestFingering', () => {
  it('uses the library fingering for known shapes, at any fret', () => {
    expect(formatFingers(suggestFingering(f('x 7 9 9 9 7'))!)).toBe('x 1 3 3 3 1');
    expect(formatFingers(suggestFingering(f('3 2 0 0 0 3'))!)).toBe('2 1 0 0 0 3');
  });
});

describe('voicings come from easy, common shapes', () => {
  it('electric picks library shapes with no open strings for the whole suggestion', () => {
    const names = ['Cadd9', 'Fmaj7#11', 'F6/9', 'C', 'C/E', 'Fmaj7', 'G', 'Am7', 'Em7', 'G/B', 'Gsus4', 'Dm7', 'Bb'];
    const chords = names.map((n) => parseChordSymbol(n)!);
    const vs = voiceProgression(chords, 'electric');
    vs.forEach((v, i) => {
      expect(v.includes(0), names[i]).toBe(false);
      const lib = shapesFor(chords[i]!).map((s) => k(s.frets));
      expect(lib, `${names[i]} → ${k(v)}`).toContain(k(v));
    });
  });

  it('no longer suggests the awkward drop-2 Am7 and G/B shapes', () => {
    const am7 = voicingChoices(parseChordSymbol('Am7')!, 'electric').map((v) => k(v.frets));
    const gb = voicingChoices(parseChordSymbol('G/B')!, 'electric').map((v) => k(v.frets));
    expect(am7).not.toContain('x x 7 9 8 8');
    expect(gb).not.toContain('x x 9 7 8 7');
  });

  it('open style starts from open chords', () => {
    const c = voicingChoices(parseChordSymbol('C')!, 'open')[0]!;
    expect(k(c.frets)).toBe('x 3 2 0 1 0');
  });

  it('reads a slash chord with a non-chord-tone bass as the chord it sounds like', () => {
    expect(chordSymbol(parseChordSymbol('Am/G')!)).toBe('Am7/G');
    expect(chordSymbol(parseChordSymbol('F/G')!)).toBe('Fadd9/G');
  });
});

describe('diatonicChords', () => {
  it('lists the seven chords of a key', () => {
    expect(diatonicChords({ tonic: 0, mode: 'major' }).map((c) => chordSymbol(c))).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
    expect(diatonicChords({ tonic: 9, mode: 'minor' }, true).map((c) => chordSymbol(c))).toEqual(['Am7', 'Bm7b5', 'Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7']);
  });
});

describe('voiceAfter', () => {
  it('stays near the previous chord on electric', () => {
    const am = parseChordSymbol('Am7')!;
    const prev = voiceAfter(undefined, parseChordSymbol('C')!, 'electric')!;
    const next = voiceAfter(prev, am, 'electric')!;
    expect(analyzeVoicing(next).best).toMatchObject({ rootPc: 9, qualityId: 'm7' });
    const avg = (f: (number | null)[]) => {
      const p = f.filter((x): x is number => x !== null && x > 0);
      return p.reduce((a, b) => a + b, 0) / p.length;
    };
    expect(Math.abs(avg(next) - avg(prev))).toBeLessThanOrEqual(5);
  });
});
