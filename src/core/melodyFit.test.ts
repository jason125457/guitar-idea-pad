import { describe, expect, it } from 'vitest';
import { checkChordAgainstMelody, chordSymbol, chordsForMelody, melodyIn, noteAgainstChord, parseChordSymbol, quantizeMelody } from './index';

const C = parseChordSymbol('C')!;
const FMAJ7 = parseChordSymbol('Fmaj7')!;
const KEY_C = { tonic: 0, mode: 'major' as const };

describe('quantizeMelody', () => {
  it('snaps sung notes to eighths and drops what falls outside the section', () => {
    const q = quantizeMelody(
      [
        { midi: 64, startSec: 0.04, durSec: 0.95 }, // 約第 0 拍、唱兩拍
        { midi: 67, startSec: 1.02, durSec: 0.5 },
        { midi: 72, startSec: 9, durSec: 1 }, // 段落外
        { midi: 60, startSec: 1.6, durSec: 0.05 }, // 太短
      ],
      0.5,
      16,
    );
    expect(q).toEqual([
      { midi: 64, beat: 0, beats: 2 },
      { midi: 67, beat: 2, beats: 1 },
    ]);
  });

  it('shortens a note that runs into the next one', () => {
    const q = quantizeMelody([{ midi: 64, startSec: 0, durSec: 2 }, { midi: 65, startSec: 1, durSec: 1 }], 1, 8);
    expect(q).toEqual([{ midi: 64, beat: 0, beats: 1 }, { midi: 65, beat: 1, beats: 1 }]);
  });
});

describe('melody against chords', () => {
  it('rates single notes: chord tone, colour, or half-step rub', () => {
    expect(noteAgainstChord(64, C)).toBe('stable'); // E
    expect(noteAgainstChord(62, C)).toBe('color'); // D = 9
    expect(noteAgainstChord(65, C)).toBe('clash'); // F 跟 E 差半音
  });

  it('flags a held clashing note, but not a passing one', () => {
    const notes = [{ midi: 64, beat: 0, beats: 2 }, { midi: 65, beat: 2.5, beats: 0.5 }];
    expect(checkChordAgainstMelody(C, melodyIn(notes, 0, 4)).fit).toBe('stable');
    const held = [{ midi: 65, beat: 0, beats: 2 }];
    expect(checkChordAgainstMelody(C, melodyIn(held, 0, 4))).toMatchObject({ fit: 'clash', clashes: [65] });
  });

  it('only looks at the beats the chord covers', () => {
    const notes = [{ midi: 64, beat: 0, beats: 4 }, { midi: 71, beat: 4, beats: 4 }];
    expect(melodyIn(notes, 2, 6).map((n) => [n.midi, n.beat, n.beats])).toEqual([[64, 2, 2], [71, 4, 2]]);
  });

  it('suggests chords that contain the melody, keeping close to the current chord', () => {
    // A 和 C 一直唱：Am、F、Fmaj7 都合，C 也合；E 和 B 摩擦的 Em 不在其中
    const notes = melodyIn([{ midi: 69, beat: 0, beats: 2 }, { midi: 72, beat: 2, beats: 2 }], 0, 4);
    const ideas = chordsForMelody(notes, KEY_C, FMAJ7, 4).map((i) => chordSymbol(i.chord));
    expect(ideas).toContain('Am');
    expect(ideas.some((n) => n.startsWith('F'))).toBe(true);
    expect(ideas).not.toContain('Em');
    expect(ideas).not.toContain('G');
  });
});
