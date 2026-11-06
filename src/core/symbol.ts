/**
 * 和弦名稱 → ChordRef，以及從一段文字（例如 AI 給的寫歌建議）裡挑出和弦進行。
 * 名稱只用來決定要配什麼指法；存進段落的仍然是指法，名稱由引擎重算。
 */
import type { ChordRef } from './chord';
import { mod12 } from './pitch';
import { QUALITY_LIST, quality } from './qualities';
import type { SectionLabel } from './song';

const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 和弦符號的各種寫法 → qualities.ts 的 id。大小寫有意義（M7 是大七、m7 是小七）。 */
const ALIASES: Record<string, string> = {};
const alias = (id: string, ...names: string[]) => names.forEach((n) => (ALIASES[n] = id));
alias('maj', '', 'M', 'maj', 'major');
alias('min', 'm', 'min', '-', 'minor');
alias('5', '5');
alias('sus2', 'sus2', '2');
alias('sus4', 'sus4', 'sus', '4');
alias('aug', 'aug', '+', '#5', '+5');
alias('dim', 'dim', '°', 'o');
alias('6', '6', 'M6', 'maj6');
alias('m6', 'm6', 'min6', '-6');
alias('maj7', 'maj7', 'M7', 'Δ', 'Δ7', 'ma7', 'j7');
alias('7', '7', 'dom7');
alias('m7', 'm7', 'min7', '-7', 'mi7');
alias('mMaj7', 'mmaj7', 'mMaj7', 'mM7', 'm#7', 'minmaj7', '-maj7', '-Δ7', 'mΔ7');
alias('m7b5', 'm7b5', 'ø', 'ø7', 'min7b5', '-7b5', 'mi7b5');
alias('dim7', 'dim7', '°7', 'o7');
alias('7sus4', '7sus4', '7sus', 'sus47');
alias('add9', 'add9', 'add2', 'Madd9', '2add');
alias('madd9', 'madd9', 'madd2', 'minadd9', '-add9');
alias('maj9', 'maj9', 'M9', 'Δ9', 'ma9');
alias('9', '9', 'dom9');
alias('m9', 'm9', 'min9', '-9', 'mi9');
alias('7b9', '7b9', '7-9');
alias('7#9', '7#9', '7+9');
alias('6/9', '6/9', '69', '6add9', 'add6/9');
alias('maj7#11', 'maj7#11', 'M7#11', 'Δ#11', 'Δ7#11', 'maj7+11', 'maj7b5', 'lyd');
alias('m11', 'm11', 'min11', '-11', 'mi11');
alias('13', '13', 'dom13');
alias('9sus4', '9sus4', '9sus', 'sus49');
alias('7sus2', '7sus2');
alias('7#5', '7#5', '7+5', 'aug7', '+7', '7aug');

/** 統一寫法：全形轉半形、♯♭ 換成 # b、去掉括號與空白（maj7(#11) → maj7#11）。 */
function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/[º]/g, '°')
    .trim();
}

function parseRoot(s: string): { pc: number; rest: string } | undefined {
  const m = /^([A-G])(#|b)?/.exec(s);
  if (!m) return undefined;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return { pc: mod12((NATURAL_PC[m[1] as string] as number) + acc), rest: s.slice(m[0].length) };
}

/** "Fmaj7#11"、"C/E"、"B♭"、"F6/9"、"Am7" → ChordRef；看不懂或不支援的和弦回傳 undefined。 */
export function parseChordSymbol(text: string): ChordRef | undefined {
  const s = normalize(text).replace(/\s+/g, '');
  const root = parseRoot(s);
  if (!root) return undefined;
  let rest = root.rest;
  let bassPc = root.pc;
  // 斜線低音：最後一個「/音名」；6/9 的 /9 不是低音
  const slash = /\/([A-G](?:#|b)?)$/.exec(rest);
  if (slash) {
    const b = parseRoot(slash[1] as string);
    if (!b) return undefined;
    bassPc = b.pc;
    rest = rest.slice(0, slash.index);
  }
  const symbol = rest.replace(/[()]/g, '');
  const id = ALIASES[symbol];
  if (id === undefined) return undefined;
  const intervals = quality(id).intervals;
  const bassRel = mod12(bassPc - root.pc);
  if (intervals.includes(bassRel)) return { rootPc: root.pc, qualityId: id, bassPc };
  // 低音不是和弦音（Am/G、C/D）：換成把低音也算進去的和弦（Am7/G、Cadd9/D），彈出來的音一樣
  const want = [...intervals, bassRel].sort((a, b) => a - b).join(',');
  const merged = QUALITY_LIST.find((q) => [...q.intervals].sort((a, b) => a - b).join(',') === want);
  return merged ? { rootPc: root.pc, qualityId: merged.id, bassPc } : undefined;
}

export interface ParsedToken {
  /** 原文 */
  text: string;
  chord: ChordRef | undefined;
}

export interface ParsedProgression {
  /** 原本那一行文字（去掉頭尾空白），讓使用者認得是哪一行 */
  line: string;
  /** 依標題或行內關鍵字推測的段落；沒有線索時是 undefined */
  label: SectionLabel | undefined;
  tokens: ParsedToken[];
  /** 這行主要是和弦（不是一大段說明裡順帶提到兩個和弦），預設勾選匯入 */
  likely: boolean;
}

const LABEL_WORDS: [RegExp, SectionLabel][] = [
  [/導歌|預副歌|pre-?chorus/i, 'prechorus'],
  [/副歌|chorus|hook/i, 'chorus'],
  [/主歌|verse/i, 'verse'],
  [/橋段|bridge/i, 'bridge'],
  [/前奏|intro/i, 'intro'],
  [/尾奏|outro|ending/i, 'outro'],
];

const labelOf = (line: string): SectionLabel | undefined => LABEL_WORDS.find(([re]) => re.test(line))?.[1];

/** 和弦之間的分隔：空白、各種箭頭、直線、逗號、前後有空白的連字號 */
const SEP = /^(?:\s|→|⇒|➔|➝|⟶|->|=>|>|\||,|、|;|–|—|-(?=\s|$))+/;
/** 看起來像和弦的字串：音名開頭，後面接和弦符號常用的字元（含括號裡的延伸音與斜線低音） */
const CHORDISH = /^[A-G](?:#|b)?(?:[A-Za-z0-9#+°øΔ\-]|\([^()\s]*\))*(?:\/(?:9|[A-G](?:#|b)?))*/;
/** 音名後面若接這些字元，才當成「想寫和弦但寫錯」回報；其他（例如 Bridge、Dreamy）是一般英文字 */
const CHORD_TAIL = /^[A-G](?:#|b)?(?:$|[0-9mMadsuoø°Δ+(#/\-]|b)/;

/** 把一行切成和弦片段；中間夾著一般文字就斷開。 */
function runsOf(line: string): ParsedToken[][] {
  const runs: ParsedToken[][] = [];
  let cur: ParsedToken[] = [];
  let i = 0;
  const flush = () => {
    if (cur.length) runs.push(cur);
    cur = [];
  };
  while (i < line.length) {
    const rest = line.slice(i);
    const sep = SEP.exec(rest);
    if (sep) {
      i += sep[0].length;
      continue;
    }
    const prevChar = line[i - 1];
    const m = CHORDISH.exec(rest);
    // 和弦必須是獨立的字（前面不是英文字母，後面不能緊接英文字母，例如 Dreamy、Chorus）
    if (m && !(prevChar && /[A-Za-z0-9]/.test(prevChar)) && CHORD_TAIL.test(m[0])) {
      const raw = m[0];
      let chord = parseChordSymbol(raw);
      let used = raw;
      // 「G（屬和弦）」「B♭（♭VII）」：括號裡是說明文字時只取前面的和弦
      const paren = raw.indexOf('(');
      if (!chord && paren > 0) {
        const head = raw.slice(0, paren);
        const c = parseChordSymbol(head);
        if (c) [chord, used] = [c, head];
      }
      cur.push({ text: used, chord });
      i += used.length;
      continue;
    }
    // 一般文字：跳過一個「字」
    const word = /^[A-Za-z0-9]+|^./u.exec(rest) as RegExpExecArray;
    flush();
    i += word[0].length;
  }
  flush();
  return runs;
}

/**
 * 從貼上的文字找出和弦進行：每一行裡最長的一串和弦（至少 2 個）算一個進行。
 * 只有單一和弦的行（多半是在說明某個和弦）略過。段落名稱沿用最近一個提到段落的行。
 */
export function parseProgressionText(text: string): ParsedProgression[] {
  const out: ParsedProgression[] = [];
  let heading: SectionLabel | undefined;
  for (const rawLine of normalize(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const runs = runsOf(line);
    const longest = runs.reduce<ParsedToken[]>((a, r) => (r.length > a.length ? r : a), []);
    const own = labelOf(line);
    if (own) heading = own;
    if (longest.length >= 2) {
      const chordChars = longest.reduce((n, t) => n + t.text.length, 0);
      const likely = longest.length >= 3 || line.length <= 40 || chordChars / line.length >= 0.3;
      out.push({ line, label: heading, tokens: longest, likely });
    }
  }
  return out;
}
