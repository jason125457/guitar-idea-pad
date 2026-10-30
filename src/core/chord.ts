import { defaultSpeller, letterIndexOf, mod12, spellWithLetter, type Speller } from './pitch';
import { QUALITY_LIST, quality, type QualityDef } from './qualities';

/** null = 悶音 */
export type Fret = number | null;

/** 標準調弦 EADGBE，六弦 → 一弦的空弦 MIDI。 */
export const STANDARD_TUNING: readonly number[] = [40, 45, 50, 55, 59, 64];

export const MAX_FRET = 24;

export interface SoundingNote {
  /** 0 = 六弦（最低），5 = 一弦（最高） */
  string: number;
  midi: number;
  pc: number;
}

export interface ChordCandidate {
  rootPc: number;
  qualityId: string;
  bassPc: number;
  /** 省略的音程（例如省略五音 [7]） */
  omitted: number[];
  score: number;
}

export interface AnalyzedChord {
  frets: Fret[];
  notes: SoundingNote[];
  pcs: number[];
  bassPc: number;
  candidates: ChordCandidate[];
  best: ChordCandidate | undefined;
}

export type ParseResult = { ok: true; frets: Fret[] } | { ok: false; error: string };

/**
 * 解析六弦品格輸入，順序為六弦 → 一弦。
 * 支援 "8 8 10 9 10 8"、"8,8,10,9,10,8"、"x32010"（全部單位數時可不加空格）。
 */
export function parseFretInput(text: string): ParseResult {
  // 全形轉半形：中文輸入法常打出「８　８　１０」或「ｘ」
  const trimmed = text.normalize('NFKC').trim();
  if (!trimmed) return { ok: false, error: '請輸入六個品格，例如 8 8 10 9 10 8' };

  let tokens = trimmed.split(/[\s,，、\-/]+/).filter(Boolean);
  if (tokens.length === 1 && /^[0-9xX]{6}$/.test(tokens[0] as string)) {
    tokens = (tokens[0] as string).split('');
  }
  if (tokens.length !== 6) {
    return { ok: false, error: `需要 6 個值（六弦到一弦），目前是 ${tokens.length} 個；兩位數品格請用空格分開` };
  }
  const frets: Fret[] = [];
  for (const t of tokens) {
    if (/^[xX]$/.test(t)) {
      frets.push(null);
      continue;
    }
    if (!/^\d{1,2}$/.test(t)) return { ok: false, error: `看不懂「${t}」，請用 0–${MAX_FRET} 或 x` };
    const n = Number(t);
    if (n > MAX_FRET) return { ok: false, error: `品格不能超過 ${MAX_FRET}` };
    frets.push(n);
  }
  return { ok: true, frets };
}

export function formatFrets(frets: readonly Fret[]): string {
  return frets.map((f) => (f === null ? 'x' : String(f))).join(' ');
}

export function fretsToNotes(
  frets: readonly Fret[],
  tuning: readonly number[] = STANDARD_TUNING,
  capo = 0,
): SoundingNote[] {
  const notes: SoundingNote[] = [];
  frets.forEach((f, i) => {
    const open = tuning[i];
    if (f === null || open === undefined) return;
    const midi = open + capo + f;
    notes.push({ string: i, midi, pc: mod12(midi) });
  });
  return notes;
}

/** 把音級集合與低音對應到和弦模板，回傳候選（分數高者在前）。 */
export function detectChords(pcs: readonly number[], bassPc: number): ChordCandidate[] {
  const set = new Set(pcs);
  const out: ChordCandidate[] = [];
  for (const rootPc of set) {
    const rel = new Set([...set].map((p) => mod12(p - rootPc)));
    for (const q of QUALITY_LIST) {
      const all = new Set(q.intervals);
      const required = q.intervals.filter((i) => !q.optional.includes(i));
      if (![...rel].every((i) => all.has(i))) continue;
      if (!required.every((i) => rel.has(i))) continue;
      const omitted = q.intervals.filter((i) => !rel.has(i));
      const score =
        0.5 + (rootPc === bassPc ? 0.2 : 0) + (omitted.length === 0 ? 0.1 : 0) + q.prior;
      out.push({ rootPc, qualityId: q.id, bassPc, omitted, score });
    }
  }
  return out.sort((a, b) => b.score - a.score || quality(a.qualityId).intervals.length - quality(b.qualityId).intervals.length);
}

export function analyzeVoicing(
  frets: readonly Fret[],
  tuning: readonly number[] = STANDARD_TUNING,
  capo = 0,
): AnalyzedChord {
  const notes = fretsToNotes(frets, tuning, capo);
  const pcs = [...new Set(notes.map((n) => n.pc))];
  const lowest = notes.reduce<SoundingNote | undefined>(
    (acc, n) => (acc === undefined || n.midi < acc.midi ? n : acc),
    undefined,
  );
  const bassPc = lowest?.pc ?? 0;
  const candidates = lowest ? detectChords(pcs, bassPc) : [];
  return { frets: [...frets], notes, pcs, bassPc, candidates, best: candidates[0] };
}

export function chordPcs(rootPc: number, q: QualityDef): number[] {
  return q.intervals.map((i) => mod12(rootPc + i));
}

export interface ChordRef {
  rootPc: number;
  qualityId: string;
  bassPc: number;
}

/**
 * 和弦內某個音程是根音往上第幾級（決定字母）。大多數照半音數查表，少數依和弦類型判斷：
 * 7#9 的 3 個半音是 ♯9（第 2 級）、減和弦的 6 個半音是 ♭5、maj7#11 的 6 個半音是 ♯11、
 * 增和弦的 8 個半音是 ♯5、減七和弦的 9 個半音是 𝄫7。
 */
export function intervalDegree(q: QualityDef, semitones: number): number {
  const s = mod12(semitones);
  const has = (i: number) => q.intervals.includes(i);
  if (s === 3 && has(4)) return 2;
  if (s === 6) return has(7) ? 4 : 5;
  if (s === 8) return has(7) ? 6 : 5;
  if (s === 9 && q.id === 'dim7') return 7;
  return [1, 2, 2, 3, 3, 4, 5, 5, 6, 6, 7, 7][s] as number;
}

/** 和弦內的音依它與根音的關係拼寫（A/C# 而不是 A/Db，E/G# 而不是 E/Ab）。 */
export function spellChordTone(rootName: string, q: QualityDef, rootPc: number, pc: number, fallback: Speller): string {
  const degree = intervalDegree(q, pc - rootPc);
  return spellWithLetter(letterIndexOf(rootName) + degree - 1, pc) ?? fallback(pc);
}

/** 這個和弦專用的拼寫器：和弦音依級數拼，其他音退回 speller。用於列出和弦組成音。 */
export function chordToneSpeller(c: ChordRef, speller: Speller = defaultSpeller): Speller {
  const q = quality(c.qualityId);
  const root = speller(c.rootPc);
  const tones = new Set(chordPcs(c.rootPc, q));
  return (pc) => (tones.has(mod12(pc)) ? spellChordTone(root, q, c.rootPc, pc, speller) : speller(pc));
}

export function chordSymbol(c: ChordRef, speller: Speller = defaultSpeller): string {
  const q = quality(c.qualityId);
  const root = speller(c.rootPc);
  const base = `${root}${q.symbol}`;
  return c.bassPc === c.rootPc ? base : `${base}/${spellChordTone(root, q, c.rootPc, c.bassPc, speller)}`;
}

/** 六行 ASCII Tab（一弦在上）。 */
export function formatTab(frets: readonly Fret[]): string {
  const names = ['e', 'B', 'G', 'D', 'A', 'E'];
  const cell = (f: Fret | undefined) => (f === null || f === undefined ? 'x' : String(f));
  const width = Math.max(...frets.map((f) => cell(f).length));
  return names
    .map((n, row) => `${n}|--${cell(frets[5 - row]).padEnd(width, '-')}--|`)
    .join('\n');
}
