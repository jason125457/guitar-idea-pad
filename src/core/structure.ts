import { quality } from './qualities';
import type { ChordRef } from './chord';
import { classifyChord, type KeyGuess } from './key';
import { defaultSpeller, midiName, parseNoteName, spellerForKey, type Speller } from './pitch';

export interface MelodyRange {
  low: number;
  high: number;
  median: number;
}

export function melodyRange(midis: readonly number[]): MelodyRange | undefined {
  if (midis.length === 0) return undefined;
  const sorted = [...midis].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return { low: sorted[0] as number, high: sorted[sorted.length - 1] as number, median: Math.round(median) };
}

/** 0–1：非順階和弦與延伸和弦所占比例。 */
export function harmonicComplexity(chords: ChordRef[], key: Pick<KeyGuess, 'tonic' | 'mode'>): number {
  if (chords.length === 0) return 0;
  const score = chords.reduce((sum, c) => {
    const tag = classifyChord(c, key.tonic, key.mode).tag;
    const q = quality(c.qualityId);
    return sum + (tag === 'diatonic' ? 0 : 0.6) + (q.intervals.length >= 5 ? 0.3 : q.intervals.length === 4 ? 0.1 : 0);
  }, 0);
  return Math.min(1, score / chords.length);
}

/** 解析 "A3 B3 Bb3" 這種旋律音文字；無法辨識的詞放進 invalid。 */
export function parseMelodyText(text: string): { midis: number[]; invalid: string[] } {
  const midis: number[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,，、]+/).filter(Boolean)) {
    const m = parseNoteName(token);
    if (m === undefined) invalid.push(token);
    else midis.push(m);
  }
  return { midis, invalid };
}

export const VERSE_MAX_WIDTH = 9;

export interface ContrastIssue {
  ok: boolean;
  message: string;
}

/** 檢查主歌旋律相對於副歌是否留出對比空間。 */
export function contrastCheck(chorus: MelodyRange, verse: MelodyRange, speller: Speller = defaultSpeller): ContrastIssue[] {
  const n = (m: number) => midiName(m, speller);
  const width = verse.high - verse.low;
  return [
    verse.high <= chorus.high - 4
      ? { ok: true, message: `最高音 ${n(verse.high)} 低於副歌高點 ${n(chorus.high)}，副歌進來時有往上的空間` }
      : { ok: false, message: `最高音 ${n(verse.high)} 太接近副歌高點 ${n(chorus.high)}，建議至少低 4 個半音` },
    verse.median <= chorus.median - 2
      ? { ok: true, message: `中心音 ${n(verse.median)} 比副歌（${n(chorus.median)}）低，情緒有鋪墊` }
      : { ok: false, message: `中心音 ${n(verse.median)} 沒有比副歌（${n(chorus.median)}）低，主歌和副歌會聽起來一樣高` },
    width <= VERSE_MAX_WIDTH
      ? { ok: true, message: `音域寬 ${width} 個半音，保持在 ${VERSE_MAX_WIDTH} 以內，容易唱也容易記` }
      : { ok: false, message: `音域寬 ${width} 個半音，超過建議的 ${VERSE_MAX_WIDTH}；主歌先收窄，把寬度留給副歌` },
  ];
}

export interface VerseGuidance {
  /** 副歌沒有旋律資料時為 undefined，只給和聲與節奏原則 */
  range?: { low: string; high: string; target: string; maxWidthSemitones: number };
  harmony: string[];
  rhythm: string[];
}

/** 由副歌推回主歌：音域壓低、色彩簡化、節奏留白。 */
export function verseGuidance(
  chorusRange: MelodyRange | undefined,
  chorusChords: ChordRef[],
  key: Pick<KeyGuess, 'tonic' | 'mode'>,
): VerseGuidance {
  const sp = spellerForKey(key.tonic, key.mode);
  const complexity = harmonicComplexity(chorusChords, key);
  const harmony =
    complexity > 0.5
      ? ['副歌和聲色彩偏濃：主歌改用順階三和弦或簡單七和弦', '避開借用和弦與半音進行，把它們留給副歌當驚喜', '和弦節奏放慢，大約一小節一個和弦']
      : ['副歌和聲偏簡單：主歌可在一個和弦上停久一點，用低音線條或空弦製造流動', '加入一個副歌沒有的色彩（例如 sus 或 add9）作為對比'];
  const range = chorusRange && {
    low: midiName(Math.max(chorusRange.low, chorusRange.median - 9), sp),
    high: midiName(chorusRange.high - 4, sp),
    target: midiName(chorusRange.median - 4, sp),
    maxWidthSemitones: VERSE_MAX_WIDTH,
  };
  return {
    range,
    harmony,
    rhythm: ['句尾留白，每句至少休止半拍到一拍', '伴奏用分解和弦或輕刷，把力度留給副歌', '歌詞密度比副歌低，多用長音，讓副歌第一句顯得更滿'],
  };
}
