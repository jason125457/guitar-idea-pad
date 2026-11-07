import { describe, expect, it } from 'vitest';
import { buildBarWindows, checkChordAgainstMelody, chordSymbol, chordsForMelody, harmonizeBars, harmonizeBarsFlow, melodyFromNoteText, melodyIn, noteAgainstChord, parseChordSymbol, quantizeMelody, suspiciousNotes } from './index';

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

describe('harmonizeBars', () => {
  it('picks a fitting chord per bar and carries the last one over silent bars', () => {
    const notes = [
      { midi: 64, beat: 0, beats: 2 }, { midi: 67, beat: 2, beats: 2 }, // E G → C
      { midi: 65, beat: 4, beats: 2 }, { midi: 69, beat: 6, beats: 2 }, // F A → F 或 Dm
    ];
    const bars = harmonizeBars(notes, 0, 3, KEY_C).map((c) => chordSymbol(c));
    expect(bars[0]).toMatch(/^(C|Em|Am)/);
    expect(['F', 'Dm', 'Fmaj7', 'Dm7']).toContain(bars[1]);
    expect(bars[2]).toBe(bars[1]); // 第三小節沒唱：沿用
  });
});

describe('harmonizeBarsFlow (Viterbi)', () => {
  const bar = (b: number, a: number, c: number) => [
    { midi: a, beat: b * 4, beats: 2 },
    { midi: c, beat: b * 4 + 2, beats: 2 },
  ];
  // E G | F A | G B | C G：每個音都能配好幾個和弦
  const tune = [...bar(0, 64, 67), ...bar(1, 65, 69), ...bar(2, 67, 71), ...bar(3, 72, 67)];
  const names = (cs: ReturnType<typeof harmonizeBars>) => cs.map((c) => chordSymbol(c));

  it('finds a ii–V–I run where the per-bar picker just takes what fits each bar', () => {
    const greedy = names(harmonizeBars(tune, 0, 4, KEY_C));
    const flow = names(harmonizeBarsFlow(tune, 0, 4, KEY_C));
    expect(flow[1]).toMatch(/^Dm/); // ii
    expect(flow[2]).toMatch(/^G/); // V
    expect(flow[3]).toBe('C'); // I
    expect(greedy.some((n) => n.startsWith('G'))).toBe(false); // 逐小節的版本沒有走到屬和弦
    expect(flow).not.toEqual(greedy);
  });

  it('never picks a chord that clashes with the bar it sits on', () => {
    const flow = harmonizeBarsFlow(tune, 0, 4, KEY_C);
    flow.forEach((ch, b) => {
      expect(checkChordAgainstMelody(ch, melodyIn(tune, b * 4, b * 4 + 4)).fit).not.toBe('clash');
    });
  });

  it('keeps bars on the fixed grid even when the melody starts late, and continues from the previous chord', () => {
    const late = [{ midi: 64, beat: 4, beats: 4 }];
    const w = buildBarWindows(late, 0, 2);
    expect(w.map((x) => x.empty)).toEqual([true, false]);
    const G = parseChordSymbol('G')!;
    const flow = harmonizeBarsFlow(late, 0, 2, KEY_C, G);
    expect(chordSymbol(flow[0]!)).toBe('G'); // 還沒唱：沿用前一個
    expect(flow).toHaveLength(2);
  });

  it('falls back to the per-bar picker when nothing was sung', () => {
    expect(names(harmonizeBarsFlow([], 0, 2, KEY_C))).toEqual(names(harmonizeBars([], 0, 2, KEY_C)));
  });
});

describe('melodyFromNoteText', () => {
  it('reads a list of note names as a melody, one beat each', () => {
    expect(melodyFromNoteText('Eb3 B2 E3 F#3 Bb2')).toEqual([
      { midi: 51, beat: 0, beats: 1 },
      { midi: 47, beat: 1, beats: 1 },
      { midi: 52, beat: 2, beats: 1 },
      { midi: 54, beat: 3, beats: 1 },
      { midi: 46, beat: 4, beats: 1 },
    ]);
  });
  it('leaves chord lists and single names alone', () => {
    expect(melodyFromNoteText('Am7 → Em7 → Fmaj7 → G')).toBeUndefined();
    expect(melodyFromNoteText('B2')).toBeUndefined();
    expect(melodyFromNoteText('C G Am F')).toBeUndefined();
  });
});

describe('suspiciousNotes', () => {
  it('flags octave jumps, short half-step blips, out-of-key and out-of-range notes', () => {
    const notes = [
      { midi: 60, beat: 0, beats: 1 },
      { midi: 72 + 12, beat: 1, beats: 1 }, // 前後都差兩個八度
      { midi: 62, beat: 2, beats: 1 },
      { midi: 63, beat: 3, beats: 0.5 }, // 半音、很短
      { midi: 66, beat: 3.5, beats: 1 }, // F# 不在 C 大調
      { midi: 30, beat: 5, beats: 1 }, // 太低
    ];
    const s = suspiciousNotes(notes, KEY_C);
    expect([...s.entries()]).toEqual([[1, 'octave'], [3, 'blip'], [4, 'out-of-key'], [5, 'range']]);
    expect(suspiciousNotes([{ midi: 64, beat: 0, beats: 1 }, { midi: 67, beat: 1, beats: 1 }], KEY_C).size).toBe(0);
  });
});
