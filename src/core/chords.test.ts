import { describe, expect, it } from 'vitest';
import { analyzeVoicing, chordSymbol, parseFretInput, type Fret } from './index';

const name = (shape: string) => {
  const r = parseFretInput(shape) as { ok: true; frets: Fret[] };
  const best = analyzeVoicing(r.frets).best;
  return best ? chordSymbol(best) : '(none)';
};

/** 真實吉他指型的回歸測試：每一列都是吉他手會實際按出來的和弦。 */
const CASES: [string, string][] = [
  // 開放和弦
  ['x32010', 'C'], ['x02220', 'A'], ['x02210', 'Am'], ['xx0232', 'D'], ['xx0231', 'Dm'],
  ['022100', 'E'], ['022000', 'Em'], ['320003', 'G'], ['320033', 'G'], ['1 3 3 2 1 1', 'F'],
  ['x21202', 'B7'], ['020100', 'E7'], ['x02020', 'A7'], ['xx0222', 'Dmaj7'], ['x32030', 'Cadd9'],
  ['x02200', 'Asus2'], ['x02230', 'Asus4'], ['xx0233', 'Dsus4'], ['xx3210', 'Fmaj7'], ['x24432', 'Bm'],
  ['244222', 'F#m'], ['x13331', 'Bb'], ['x32000', 'Cmaj7'], ['320000', 'G6'], ['x02010', 'Am7'],
  ['022030', 'Em7'], ['355xxx', 'G5'],
  // 轉位
  ['332010', 'C/G'], ['200232', 'D/F#'], ['x20003', 'G/B'], ['x4222x', 'A/C#'], ['4x2100', 'E/G#'],
  // 七和弦以上
  ['x 7 6 7 8 x', 'E7#9'], ['x2323x', 'Bm7b5'], ['x 3 2 3 3 3', 'C9'], ['x 3 2 4 3 x', 'Cmaj9'],
  ['x 5 3 5 5 x', 'Dm9'], ['x 6 5 7 6 x', 'Ebmaj9'], ['1 x 2 2 1 x', 'Fmaj7'],
  // 色彩和弦
  ['x 3 2 2 3 3', 'C6/9'],
  ['x 3 2 4 1 2', 'Cmaj7#11'],
  ['3 x 3 4 5 x', 'G13'],
  ['x 0 5 5 3 3', 'Am11'],
  ['x 3 x 3 4 1', 'Cm11'],
  ['x 3 0 3 3 x', 'C7sus2'],
  ['0 x 0 1 1 x', 'E7#5'],
  ['x 5 5 5 5 5', 'D9sus4'],
];

describe('real-world guitar shapes are named the way guitarists name them', () => {
  it.each(CASES)('%s → %s', (shape, want) => {
    expect(name(shape)).toBe(want);
  });
});
