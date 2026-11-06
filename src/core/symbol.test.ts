import { describe, expect, it } from 'vitest';
import {
  analyzeVoicing,
  chordSymbol,
  parseChordSymbol,
  parseProgressionText,
  voiceProgression,
  type ChordRef,
  type Fret,
} from './index';

const name = (c: ChordRef | undefined) => (c ? chordSymbol(c) : '?');

describe('parseChordSymbol', () => {
  it('reads the chord names an AI songwriting suggestion uses', () => {
    const cases: [string, string][] = [
      ['C', 'C'],
      ['Cadd9', 'Cadd9'],
      ['Fmaj7', 'Fmaj7'],
      ['Fmaj7#11', 'Fmaj7#11'],
      ['Fmaj7(#11)', 'Fmaj7#11'],
      ['F6/9', 'F6/9'],
      ['C/E', 'C/E'],
      ['G/B', 'G/B'],
      ['Am7', 'Am7'],
      ['Gsus4', 'Gsus4'],
      ['B♭', 'Bb'],
      ['Bbmaj7', 'Bbmaj7'],
      ['F#m7b5', 'F#m7b5'],
      ['CM7', 'Cmaj7'],
      ['Cm7', 'Cm7'],
      ['Ｄｍ７', 'Dm7'],
      ['C6/9/E', 'C6/9/E'],
    ];
    for (const [input, out] of cases) expect(name(parseChordSymbol(input)), input).toBe(out);
  });

  it('rejects names it cannot play', () => {
    for (const bad of ['H', 'Cxyz', 'C/H', 'Cmaj13#5', '']) expect(parseChordSymbol(bad), bad).toBeUndefined();
  });
});

const PASTE = `一、和弦編排建議
先說一個觀點：C → Fmaj7 本身並不悲傷。 它是 I → IV 大調進行，Fmaj7 帶點夢幻和溫柔。聽起來悲傷，比較可能是因為整首只有這兩個和弦，一直沒有往前推的力量，再加上旋律常停在 E、A 這些音上。
1. 主歌：保留 C–Fmaj7，換個聲位
* Cadd9 → Fmaj7：加 9 音（D）會比較明亮、透氣。
* Fmaj7 換成 Fmaj7#11 或 F6/9：#11 是 Lydian 的色彩。
* 用低音走路：\`C → C/E → Fmaj7 → G\`。低音從 C、E、F 爬到 G，有往前走的感覺。
2. 導歌：開始往前推
* \`Am7 → Em7 → Fmaj7 → G\`
* 或 \`Dm7 → Em7 → Fmaj7 → Gsus4 → G\`
G（屬和弦）這首歌原本完全沒出現。
3. 副歌：讓它打開
* 明亮版：\`C → G/B → Am7 → Fmaj7\`
* 更溫暖：\`Fmaj7 → G → Em7 → Am7\`，然後回到 C
* 借 B♭（♭VII）`;

describe('parseProgressionText', () => {
  const found = parseProgressionText(PASTE);
  const names = (i: number) => found[i]!.tokens.map((t) => name(t.chord));

  it('finds each progression in a pasted suggestion and guesses its section', () => {
    const rows = found.map((p) => [p.label, p.tokens.map((t) => name(t.chord)).join(' ')]);
    expect(rows).toEqual([
      [undefined, 'C Fmaj7'],
      ['verse', 'C Fmaj7'],
      ['verse', 'Cadd9 Fmaj7'],
      ['verse', 'C C/E Fmaj7 G'],
      ['prechorus', 'Am7 Em7 Fmaj7 G'],
      ['prechorus', 'Dm7 Em7 Fmaj7 Gsus4 G'],
      ['chorus', 'C G/B Am7 Fmaj7'],
      ['chorus', 'Fmaj7 G Em7 Am7'],
    ]);
    expect(names(3)).toEqual(['C', 'C/E', 'Fmaj7', 'G']);
  });

  it('pre-selects chord lines but not long prose that mentions two chords', () => {
    expect(found[0]!.likely).toBe(false);
    expect(found.slice(1).every((p) => p.likely)).toBe(true);
  });

  it('skips lines with one chord and words that only start like a chord', () => {
    expect(parseProgressionText('Bridge: Dreamy and Ambient\n借 B♭（♭VII）')).toEqual([]);
  });

  it('accepts dashes, bars and commas between chords and flags unknown ones', () => {
    const [p] = parseProgressionText('Am7 - Em7 | Fmaj7, Cmaj13#5');
    expect(p!.tokens.map((t) => t.text)).toEqual(['Am7', 'Em7', 'Fmaj7', 'Cmaj13#5']);
    expect(p!.tokens[3]!.chord).toBeUndefined();
  });
});

describe('voiceProgression', () => {
  const chords = ['Cadd9', 'Fmaj7#11', 'C/E', 'Fmaj7', 'Gsus4', 'G', 'G/B', 'Am7', 'F6/9', 'Bb'].map((s) => parseChordSymbol(s)!);

  it('electric style: no open strings, 3–5 adjacent strings, mid-neck', () => {
    const vs = voiceProgression(chords, 'electric');
    vs.forEach((f, i) => {
      const used = f.map((x, s) => (x === null ? -1 : s)).filter((s) => s >= 0);
      expect(f.includes(0), name(chords[i])).toBe(false);
      expect(used.length).toBeGreaterThanOrEqual(3);
      expect(used.length).toBeLessThanOrEqual(5);
      const fretted = f.filter((x): x is number => x !== null);
      const avg = fretted.reduce((a, b) => a + b, 0) / fretted.length;
      expect(avg, `${name(chords[i])} ${f.join(' ')}`).toBeGreaterThanOrEqual(3);
    });
    const all = vs.flat().filter((x): x is number => x !== null);
    expect(all.reduce((a, b) => a + b, 0) / all.length).toBeGreaterThanOrEqual(5);
  });

  it('every voicing is recognised back as the chord that was asked for', () => {
    for (const style of ['electric', 'open'] as const) {
      voiceProgression(chords, style).forEach((f, i) => {
        expect(name(analyzeVoicing(f as Fret[]).best), `${style} ${f.join(' ')}`).toBe(name(chords[i]));
      });
    }
  });

  it('keeps the hand near one position instead of jumping around the neck', () => {
    const prog = ['C', 'G/B', 'Am7', 'Fmaj7'].map((s) => parseChordSymbol(s)!);
    const vs = voiceProgression(prog, 'electric');
    const avg = (f: Fret[]) => {
      const x = f.filter((v): v is number => v !== null);
      return x.reduce((a, b) => a + b, 0) / x.length;
    };
    for (let i = 1; i < vs.length; i++) expect(Math.abs(avg(vs[i]!) - avg(vs[i - 1]!))).toBeLessThanOrEqual(5);
  });
});
