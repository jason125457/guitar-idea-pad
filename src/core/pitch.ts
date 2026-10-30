/** 音名與拼寫。引擎內部一律用 pitch class（0–11）與 MIDI，名稱只在輸出時依調性決定。 */

export type Speller = (pc: number) => string;

const DEFAULT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

/** 各調主音的寫法（升降號較少的那一個；六升六降時吉他手較習慣 F#）。 */
const TONIC_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const TONIC_MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/**
 * 相對主音的半音數 → 第幾級（1–7）。字母由級數決定，升降號再依實際音高補上，所以大小調共用一張表：
 * 大調的調外音寫成 ♭2 ♭3 ♯4 ♭6 ♭7；小調的調外音寫成 ♭2、♯3（大三和弦的三音）、♯4、♯6（旋律小調）、♯7（導音）。
 */
const DEGREE_BY_SEMITONE = [1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 7];

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** 無調性脈絡時的預設拼寫（Db、Eb、F#、Ab、Bb）。 */
export const defaultSpeller: Speller = (pc) => DEFAULT_NAMES[mod12(pc)] as string;

/** 用指定字母寫出某個音級；需要重升或重降時回傳 undefined（交給呼叫端退回預設寫法）。 */
export function spellWithLetter(letterIndex: number, pc: number): string | undefined {
  const li = ((letterIndex % 7) + 7) % 7;
  const diff = mod12(pc - (LETTER_PC[li] as number));
  const acc = diff === 0 ? '' : diff === 1 ? '#' : diff === 11 ? 'b' : undefined;
  return acc === undefined ? undefined : `${LETTERS[li]}${acc}`;
}

export const letterIndexOf = (name: string): number => LETTERS.indexOf(name[0] as (typeof LETTERS)[number]);

/**
 * 依調性的級數拼寫：每個音先決定是第幾級（字母），再補升降號。
 * 例如 A 小調的導音寫 G#（不是 Ab），C 大調的 ♯4 寫 F#、♭7 寫 Bb。
 */
export function spellerForKey(tonic: number, mode: 'major' | 'minor'): Speller {
  const t = mod12(tonic);
  const tonicName = (mode === 'major' ? TONIC_MAJOR : TONIC_MINOR)[t] as string;
  const tonicLetter = letterIndexOf(tonicName);
  return (pc) => {
    const p = mod12(pc);
    const degree = DEGREE_BY_SEMITONE[mod12(p - t)] as number;
    return spellWithLetter(tonicLetter + degree - 1, p) ?? defaultSpeller(p);
  };
}

const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * "A3"、"Bb3"、"F#4"、"B#3" → MIDI；無法解析回傳 undefined。
 * 先做全形轉半形（中文輸入法常打出「Ａ３」「＃」）。
 */
export function parseNoteName(text: string): number | undefined {
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(text.normalize('NFKC').trim());
  if (!m) return undefined;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + (NATURAL_PC[(m[1] as string).toUpperCase()] as number) + acc;
}

/** MIDI → 音名加八度。八度依「字母」算，所以 B#3 與 C4 同音、Cb4 與 B3 同音（與 parseNoteName 互為反函式）。 */
export function midiName(midi: number, speller: Speller = defaultSpeller): string {
  const name = speller(midi);
  const acc = name.endsWith('#') ? 1 : name.endsWith('b') && name.length > 1 ? -1 : 0;
  return `${name}${Math.floor((midi - acc) / 12) - 1}`;
}
