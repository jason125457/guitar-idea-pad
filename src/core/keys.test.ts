import { describe, expect, it } from 'vitest';
import { analyzeProgression, inferKey, type ChordRef } from './index';

const NOTE: Record<string, number> = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, Ab: 8, A: 9, Bb: 10, B: 11 };

/** "C E Am F7 G#dim" → ChordRef[]（只支援測試用到的寫法） */
function prog(text: string): ChordRef[] {
  return text.split(' ').map((s) => {
    const m = /^([A-G][b#]?)(.*)$/.exec(s)!;
    const root = NOTE[m[1]!]!;
    const suffix = m[2]!;
    const qualityId = { '': 'maj', m: 'min', '7': '7', m7: 'm7', maj7: 'maj7', dim: 'dim' }[suffix];
    if (!qualityId) throw new Error(`unknown chord ${s}`);
    return { rootPc: root, qualityId, bassPc: root };
  });
}

const keyOf = (text: string) => {
  const k = inferKey(prog(text))[0]!;
  return `${Object.keys(NOTE).find((n) => NOTE[n] === k.tonic)} ${k.mode}`;
};

describe('inferKey on common progressions', () => {
  it.each([
    ['C G Am F', 'C major'], // I V vi IV
    ['C E Am F', 'C major'], // E 是 V/vi
    ['Dm7 G7 Cmaj7', 'C major'],
    ['G C D G', 'G major'],
    ['C D F C', 'C major'], // D 是 V/V
    ['C Db C', 'C major'], // 拿坡里
    ['C7 F7 G7 C7', 'C major'], // 藍調
    ['E7 A7 B7 E7', 'E major'],
    ['Am G F E', 'A minor'], // 安達魯西亞終止
    ['Am Dm E7 Am', 'A minor'],
    ['Am7 Dm7 Em7 Am7', 'A minor'],
    ['Fmaj7 Fm7 Em7', 'C major'],
  ])('%s → %s', (text, want) => {
    expect(keyOf(text)).toBe(want);
  });

  it('keeps truly ambiguous loops in the top two with low confidence', () => {
    const ks = inferKey(prog('F G Em Am'));
    expect(ks.slice(0, 2).map((k) => `${k.tonic}-${k.mode}`).sort()).toEqual(['0-major', '9-minor'].sort());
    expect(ks[0]!.confidence).toBeLessThan(0.3);
  });

  it('never claims high confidence from a single chord', () => {
    expect(inferKey(prog('C'))[0]!.confidence).toBeLessThan(0.2);
    expect(inferKey(prog('Cmaj7'))[0]!.confidence).toBeLessThan(0.2);
  });
});

describe('chord roles', () => {
  const roles = (text: string, tonic: number, mode: 'major' | 'minor') =>
    analyzeProgression(prog(text), { tonic, mode }).map((i) => `${i.roman}:${i.tag}${i.detail ? ':' + i.detail : ''}`);

  it('labels plain major triads a fifth above a diatonic chord as secondary dominants', () => {
    expect(roles('E D A B', 0, 'major')).toEqual([
      'III:secondary-dominant:V/VI',
      'II:secondary-dominant:V/V',
      'VI:secondary-dominant:V/II',
      'VII:secondary-dominant:V/III',
    ]);
  });
  it('names Neapolitan, blues and minor-key dominant chords', () => {
    // ♭VII7（Bb D F Ab）每個音都在 C 自然小調裡，所以歸為平行小調借用（也就是「後門屬七」）
    expect(roles('Db F7 Bb7', 0, 'major')).toEqual(['♭II:borrowed:neapolitan', 'IV7:borrowed:blues', '♭VII7:borrowed:parallel-minor']);
    expect(roles('E7 G#dim G', 9, 'minor')).toEqual(['V7:diatonic', '♯vii°:diatonic', 'VII:diatonic']);
  });
  it('does not treat the raised 7th as home in non-dominant minor chords', () => {
    // A 小調裡的 Cmaj7（C E G B）的 B 是自然小調的音，順階
    expect(roles('Cmaj7', 9, 'minor')).toEqual(['IIImaj7:diatonic']);
    // A 小調裡的 G#dim 是導音和弦，順階；但 E 大三和弦當 III 以外的位置時不會因為含 G# 就被算成順階
    expect(roles('C', 9, 'minor')).toEqual(['III:diatonic']);
  });
});
