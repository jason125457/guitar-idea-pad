import { describe, expect, it } from 'vitest';
import {
  APPEND_GAP_SEC,
  analyzeVoicing,
  buildWindows,
  chordSymbol,
  createSection,
  estimateTempo,
  harmonize,
  inferKeyFromMelody,
  mergeMelody,
  normalizeIdea,
  createIdea,
  timedMelodyOf,
  voiceChords,
  type HarmonizeSettings,
  type TimedNote,
} from './index';

const BPM = 100;
const BEAT = 60 / BPM;
const S4: HarmonizeSettings = { bpm: BPM, beatsPerBar: 4, pickupBeats: 0, chordsPerBar: 1 };

/** [midi, 拍數]；midi 為 null 代表休止 */
function melody(spec: ([number, number] | [null, number])[], startSec = 0): TimedNote[] {
  const out: TimedNote[] = [];
  let beat = 0;
  for (const [m, b] of spec) {
    if (m !== null) out.push({ midi: m, startSec: startSec + beat * BEAT, durSec: b * BEAT * 0.95 });
    beat += b;
  }
  return out;
}

const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B3 = 59, A3 = 57, G3 = 55;

// C 大調 I - V - vi - IV - I，每小節四個四分音符
const POP = melody([
  [C4, 1], [E4, 1], [G4, 1], [E4, 1],
  [B3, 1], [D4, 1], [G4, 1], [D4, 1],
  [A4, 1], [C4 + 12, 1], [E4 + 12, 1], [A4, 1],
  [A3, 1], [C4, 1], [F4, 1], [C4, 1],
  [C4, 4],
]);

describe('inferKeyFromMelody', () => {
  it('finds C major for a C-major tune ending on C', () => {
    expect(inferKeyFromMelody(POP)[0]).toMatchObject({ tonic: 0, mode: 'major' });
  });
  it('prefers A minor when the tune lives on A and lands there', () => {
    const am = melody([[A3, 2], [C4, 1], [E4, 1], [D4, 1], [C4, 1], [B3, 1], [A3, 3]]);
    expect(inferKeyFromMelody(am)[0]).toMatchObject({ tonic: 9, mode: 'minor' });
  });
  it('returns nothing for no notes', () => {
    expect(inferKeyFromMelody([])).toEqual([]);
  });
});

describe('estimateTempo', () => {
  it('recovers a steady tempo within a few BPM', () => {
    const bpm = estimateTempo(POP);
    expect(bpm).toBeGreaterThanOrEqual(95);
    expect(bpm).toBeLessThanOrEqual(105);
  });
  it('falls back to a default with too few notes', () => {
    expect(estimateTempo(melody([[C4, 1]]))).toBe(90);
  });
});

describe('buildWindows', () => {
  it('makes one window per bar, or two with chordsPerBar 2', () => {
    expect(buildWindows(POP, S4)).toHaveLength(5);
    expect(buildWindows(POP, { ...S4, chordsPerBar: 2 })).toHaveLength(10);
  });
  it('puts the right notes in each bar and marks downbeats strong', () => {
    const w = buildWindows(POP, S4);
    expect(w[1]!.notes.map((n) => n.midi)).toEqual([B3, D4, G4, D4]);
    expect(w[1]!.notes[0]!.strong).toBe(true);
    expect(w[1]!.notes[1]!.strong).toBe(false);
  });
  it('treats a pickup note as part of the first bar only lightly', () => {
    const pick = melody([[G3, 1], [C4, 1], [E4, 1], [G4, 1], [C4 + 12, 4]]);
    const w = buildWindows(pick, { ...S4, pickupBeats: 1 });
    expect(w[0]!.notes.find((n) => n.midi === G3)?.weight).toBeLessThan(0.5);
    expect(w[0]!.notes.some((n) => n.midi === C4 && n.strong)).toBe(true);
  });
  it('marks windows with no melody as empty', () => {
    const w = buildWindows(melody([[C4, 4], [null, 4], [G4, 4]]), S4);
    expect(w.map((x) => x.empty)).toEqual([false, true, false]);
  });
});

describe('harmonize', () => {
  const key = { tonic: 0, mode: 'major' as const };

  it('finds I - V - vi - IV - I for the pop melody', () => {
    const { choices } = harmonize(buildWindows(POP, S4), key);
    const roots = choices.map((ch) => ch[0]!.rootPc);
    expect([roots[0], roots[1], roots[2], roots[4]]).toEqual([0, 7, 9, 0]);
    expect(choices[2]![0]!.qualityId).toMatch(/^m/); // vi 是小和弦
    // 第 4 小節的旋律 A C F C 同時是 F 與 Dm7 的和弦音，引擎無法分辨：
    // 兩者都是下屬功能，選哪個都合理，但 F 一定要出現在候選裡讓使用者挑
    expect(['S']).toContain(choices[3]![0]!.function);
    expect(choices[3]!.some((x) => x.rootPc === 5 && x.qualityId.startsWith('maj'))).toBe(true);
    expect(choices[4]![0]).toMatchObject({ roman: expect.stringMatching(/^I/), tag: 'diatonic' });
  });

  it('lists distinct alternatives with the chosen chord first', () => {
    const { choices } = harmonize(buildWindows(POP, S4), key, 3);
    for (const ch of choices) {
      expect(ch).toHaveLength(3);
      expect(new Set(ch.map((x) => `${x.rootPc}-${x.qualityId}`)).size).toBe(3);
      expect(ch[0]!.score).toBeGreaterThanOrEqual(ch[1]!.score - 1e-9);
    }
  });

  it('keeps a chord through a rest', () => {
    const { choices } = harmonize(buildWindows(melody([[C4, 1], [E4, 1], [G4, 2], [null, 4], [C4, 4]]), S4), key);
    expect(choices[1]![0]).toMatchObject({ rootPc: choices[0]![0]!.rootPc, qualityId: choices[0]![0]!.qualityId });
  });

  it('puts the final melody note inside the final chord', () => {
    const { choices } = harmonize(buildWindows(POP, S4), key);
    const last = choices[choices.length - 1]![0]!;
    expect(last.fit).toBeGreaterThan(0.9); // 最後一小節整個都是 C，必須是含 C 的和弦
  });

  it('works in minor and ends on the tonic chord', () => {
    const am = melody([
      [A3, 1], [C4, 1], [E4, 1], [C4, 1],
      [D4, 1], [F4, 1], [A4, 1], [F4, 1],
      [E4, 1], [G4 + 1, 1], [B3 + 12, 1], [G4 + 1, 1],
      [A3, 4],
    ]);
    const { choices } = harmonize(buildWindows(am, S4), { tonic: 9, mode: 'minor' });
    expect(choices.map((ch) => ch[0]!.rootPc)).toEqual([9, 2, 4, 9]);
    expect(choices[3]![0]!.qualityId).toMatch(/^m/);
  });

  it('returns empty results for empty input', () => {
    expect(harmonize([], key)).toEqual({ windows: [], choices: [] });
    expect(buildWindows([], S4)).toEqual([]);
  });
});

describe('voiceChords', () => {
  it('gives playable six-string voicings that re-detect as the chord', () => {
    const { choices } = harmonize(buildWindows(POP, S4), { tonic: 0, mode: 'major' });
    const chords = choices.map((ch) => ch[0]!);
    const voiced = voiceChords(chords);
    expect(voiced).toHaveLength(chords.length);
    voiced.forEach((f, i) => {
      expect(f).toHaveLength(6);
      const best = analyzeVoicing(f).best;
      expect(best?.rootPc, chordSymbol(chords[i]!)).toBe(chords[i]!.rootPc);
    });
  });
});

describe('timed melody on sections', () => {
  const timed = melody([[A3, 1], [C4, 1], [E4, 1]]);

  it('is valid only while the melody text still matches', () => {
    const s = { ...createSection('chorus'), melody: 'A3 C4 E4', melodyTimed: timed };
    expect(timedMelodyOf(s)).toBe(timed);
    expect(timedMelodyOf({ ...s, melody: 'A3 C4 E4 G4' })).toBeUndefined();
    expect(timedMelodyOf({ ...s, melody: 'A3 C4 F4' })).toBeUndefined();
    expect(timedMelodyOf({ melody: 'A3 C4 E4' })).toBeUndefined();
    expect(timedMelodyOf({ ...s, melody: 'A3 C4 E4'.replace('A3', 'A3') })).toBe(timed); // 拼寫無關，只比音高
  });

  it('appends with a gap and keeps timing; replace swaps it', () => {
    const s = { melody: 'A3 C4 E4', melodyTimed: timed };
    const added = [{ midi: G4, startSec: 0.2, durSec: 0.5 }];
    const m = mergeMelody(s, added, 'G4', 'append');
    expect(m.melody).toBe('A3 C4 E4 G4');
    const last = timed[2]!;
    expect(m.melodyTimed![3]!.startSec).toBeCloseTo(last.startSec + last.durSec + APPEND_GAP_SEC, 6);
    expect(m.melodyTimed).toHaveLength(4);
    expect(mergeMelody(s, added, 'G4', 'replace')).toEqual({ melody: 'G4', melodyTimed: added });
  });

  it('drops timing when appending onto a hand-typed melody', () => {
    const m = mergeMelody({ melody: 'A3 C4' }, [{ midi: G4, startSec: 0, durSec: 1 }], 'G4', 'append');
    expect(m).toEqual({ melody: 'A3 C4 G4', melodyTimed: undefined });
  });

  it('survives normalization, and bad timing data is dropped whole', () => {
    const idea = createIdea();
    idea.sections[0] = { ...idea.sections[0]!, melody: 'A3 C4 E4', melodyTimed: timed };
    expect(normalizeIdea(JSON.parse(JSON.stringify(idea)))!.sections[0]!.melodyTimed).toEqual(timed);
    const broken = JSON.parse(JSON.stringify(idea));
    broken.sections[0].melodyTimed[1].durSec = -1;
    expect(normalizeIdea(broken)!.sections[0]!.melodyTimed).toBeUndefined();
    expect('melodyTimed' in normalizeIdea({ id: 'x', sections: [{ melody: 'A3' }] })!.sections[0]!).toBe(false);
  });
});
