import { describe, expect, it } from 'vitest';
import {
  STANDARD_TUNING,
  analyzeProgression,
  analyzeVoicing,
  chordSymbol,
  findChromaticLines,
  generateVoicings,
  inferKey,
  melodyRange,
  midisOf,
  parseFretInput,
  quality,
  spellerForKey,
  suggestNext,
  transition,
  verseGuidance,
  type Fret,
} from './index';

const name = (frets: Fret[]) => {
  const a = analyzeVoicing(frets);
  return a.best ? chordSymbol(a.best) : '?';
};

const FMAJ7_C: Fret[] = [8, 8, 10, 9, 10, 8];
const FM7_C: Fret[] = [8, 8, 10, 8, 9, 8];
const EM7_B: Fret[] = [7, 7, 9, 7, 8, 7];

describe('parseFretInput', () => {
  it('parses spaced input with two-digit frets', () => {
    expect(parseFretInput('8 8 10 9 10 8')).toEqual({ ok: true, frets: [8, 8, 10, 9, 10, 8] });
  });
  it('parses compact single-digit input with muted strings', () => {
    expect(parseFretInput('x32010')).toEqual({ ok: true, frets: [null, 3, 2, 0, 1, 0] });
  });
  it('rejects wrong string count and bad tokens', () => {
    expect(parseFretInput('1 2 3').ok).toBe(false);
    expect(parseFretInput('1 2 3 4 5 z').ok).toBe(false);
    expect(parseFretInput('1 2 3 4 5 30').ok).toBe(false);
  });
});

describe('chord detection', () => {
  it('names the user example as Fmaj7/C', () => {
    const a = analyzeVoicing(FMAJ7_C);
    expect(a.notes.map((n) => n.midi)).toEqual([48, 53, 60, 64, 69, 72]);
    expect(name(FMAJ7_C)).toBe('Fmaj7/C');
  });
  it('names open shapes', () => {
    expect(name([null, 3, 2, 0, 1, 0])).toBe('C');
    expect(name([0, 2, 2, 1, 0, 0])).toBe('E');
    expect(name([null, 0, 2, 2, 1, 0])).toBe('Am');
    expect(name([3, 2, 0, 0, 0, 1])).toBe('G7');
  });
  it('uses the bass to tell Am7 from C6', () => {
    expect(name([null, 0, 2, 0, 1, 0])).toBe('Am7');
    // x32210 = C E A C E：同一組音，低音在 C 時 C6 勝過 Am/C
    const c6 = analyzeVoicing([null, 3, 2, 2, 1, 0]);
    expect(c6.candidates.some((c) => chordSymbol(c) === 'C6')).toBe(true);
  });
  it('allows an omitted fifth on seventh chords', () => {
    // C(A str 3) E(D str 2) B(G str 4)... -> C E B = Cmaj7 without the 5th
    const a = analyzeVoicing([null, 3, 2, 4, null, null]);
    expect(a.best && chordSymbol(a.best)).toBe('Cmaj7');
    expect(a.best?.omitted).toEqual([7]);
  });
  it('returns nothing for a single note', () => {
    expect(analyzeVoicing([null, null, null, null, null, 3]).best).toBeUndefined();
  });
});

describe('key inference & analysis', () => {
  const ref = (frets: Fret[]) => analyzeVoicing(frets).best!;

  it('reads Fmaj7 - Fm7 - Em7 as IVmaj7 - ivm7 - iiim7 in C major', () => {
    const chords = [ref(FMAJ7_C), ref(FM7_C), ref(EM7_B)];
    const keys = inferKey(chords);
    expect(keys[0]).toMatchObject({ tonic: 0, mode: 'major' });
    const info = analyzeProgression(chords, keys[0]!);
    expect(info.map((i) => i.roman)).toEqual(['IVmaj7', 'ivm7', 'iiim7']);
    expect(info[1]).toMatchObject({ tag: 'borrowed', detail: 'parallel-minor' });
    expect(info[2]?.tag).toBe('diatonic');
  });

  it('prefers A minor for Am7 Dm7 Em7 Am7 and C major for Dm7 G7 Cmaj7', () => {
    const mk = (root: number, q: string) => ({ rootPc: root, qualityId: q, bassPc: root });
    expect(inferKey([mk(9, 'm7'), mk(2, 'm7'), mk(4, 'm7'), mk(9, 'm7')])[0]).toMatchObject({ tonic: 9, mode: 'minor' });
    expect(inferKey([mk(2, 'm7'), mk(7, '7'), mk(0, 'maj7')])[0]).toMatchObject({ tonic: 0, mode: 'major' });
  });

  it('tags secondary dominants and tritone substitutions', () => {
    const mk = (root: number, q: string) => ({ rootPc: root, qualityId: q, bassPc: root });
    const info = analyzeProgression([mk(9, '7'), mk(1, '7')], { tonic: 0, mode: 'major' });
    expect(info[0]).toMatchObject({ tag: 'secondary-dominant', detail: 'V/II' });
    expect(info[1]?.tag).toBe('tritone-sub');
  });

  it('spells with flats in flat keys', () => {
    expect(spellerForKey(5, 'major')(10)).toBe('Bb');
    expect(spellerForKey(7, 'major')(6)).toBe('F#');
  });
});

describe('voice leading', () => {
  const seq = [FMAJ7_C, FM7_C, EM7_B].map((f) => midisOf(f, STANDARD_TUNING));

  it('detects planing for Fm7/C -> Em7/B', () => {
    expect(transition(seq[1]!, seq[2]!).motion).toBe('planing');
    expect(transition(seq[0]!, seq[1]!).stringDeltas).toEqual([0, 0, 0, -1, -1, 0]);
  });
  it('finds the chromatic inner lines on the G and B strings', () => {
    const lines = findChromaticLines(seq);
    expect(lines.map((l) => [l.string, l.direction, l.steps])).toEqual([
      [3, 'down', 2],
      [4, 'down', 2],
    ]);
  });
});

describe('voicing generator', () => {
  it('produces playable voicings that re-detect as the requested chord', () => {
    for (const [root, q] of [[0, 'maj7'], [9, 'm7'], [7, '7'], [5, 'add9'], [2, 'm9']] as const) {
      const vs = generateVoicings(root, quality(q), { limit: 3 });
      expect(vs.length).toBeGreaterThan(0);
      for (const v of vs) {
        const best = analyzeVoicing(v.frets).best!;
        expect(best.rootPc).toBe(root);
        expect(best.qualityId).toBe(q);
        const span = v.frets.filter((f): f is number => f !== null && f > 0);
        expect(Math.max(...span) - Math.min(...span)).toBeLessThanOrEqual(3);
      }
    }
  });
  it('is voice-leading aware', () => {
    const [v] = generateVoicings(0, quality('maj7'), { prev: FMAJ7_C, bassPc: 0, limit: 1 });
    expect(v).toBeDefined();
    const nearC = v!.frets.filter((f): f is number => f !== null && f > 0);
    expect(Math.min(...nearC)).toBeGreaterThanOrEqual(5);
  });
});

describe('suggestNext', () => {
  const chords = [FMAJ7_C, FM7_C, EM7_B].map((f) => analyzeVoicing(f));
  const key = { tonic: 0, mode: 'major' as const };

  it('offers three different moods with tabs', () => {
    const s = suggestNext(chords, key);
    expect(s.map((x) => x.mood)).toEqual(['warm-resolve', 'bittersweet', 'neo-soul']);
    expect(new Set(s.map((x) => x.symbol)).size).toBe(s.length);
    for (const x of s) {
      expect(x.frets).toHaveLength(6);
      expect(x.tab.split('\n')).toHaveLength(6);
    }
    expect(s[0]?.chord.rootPc).toBe(0);
    expect(s[1]?.chord.rootPc).toBe(9);
  });

  it('planing suggestion keeps the shape and is named from it', () => {
    const neo = suggestNext(chords, key).find((x) => x.mood === 'neo-soul')!;
    const prev = EM7_B;
    const d = neo.frets.find((f) => f !== null)! - prev.find((f) => f !== null)!;
    expect(neo.frets.every((f, i) => (f === null) === (prev[i] === null))).toBe(true);
    expect(neo.frets.every((f, i) => f === null || f - (prev[i] as number) === d)).toBe(true);
  });

  it('avoids a minor-ninth rub against the melody', () => {
    // 旋律落在 F4 (65)：Cmaj7 的 E 與 F 相差半音，應偏好 add9/6 等不摩擦的色彩，或至少標出 clash
    const s = suggestNext(chords, key, 65);
    const warm = s[0]!;
    expect(warm.chord.qualityId === 'maj7' ? warm.melodyFit === 'clash' : true).toBe(true);
  });
});

describe('structure guidance', () => {
  it('pushes the verse below the chorus peak', () => {
    const range = melodyRange([57, 59, 62, 64, 67, 69, 72])!;
    expect(range).toEqual({ low: 57, high: 72, median: 64 });
    const g = verseGuidance(range, [], { tonic: 0, mode: 'major' });
    expect(g.range?.high).toBe('Ab4');
    expect(g.range?.target).toBe('C4');
  });
});
