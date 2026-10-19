/** 音名與拼寫。引擎內部一律用 pitch class（0–11）與 MIDI，名稱只在輸出時依調性決定。 */

export type Speller = (pc: number) => string;

const DEFAULT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const FLAT_MAJOR = new Set([5, 10, 3, 8, 1, 6]);
const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]);
const SHARP_MAJOR = new Set([7, 2, 9, 4, 11]);
const SHARP_MINOR = new Set([4, 11, 6, 1, 8]);

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** 無調性脈絡時的預設拼寫（Db、Eb、F#、Ab、Bb）。 */
export const defaultSpeller: Speller = (pc) => DEFAULT_NAMES[mod12(pc)] as string;

/** 依調號選擇升號或降號拼寫；C 大調 / A 小調沿用預設（借用和弦會出現 Eb、Ab、Bb）。 */
export function spellerForKey(tonic: number, mode: 'major' | 'minor'): Speller {
  const t = mod12(tonic);
  const flat = mode === 'major' ? FLAT_MAJOR : FLAT_MINOR;
  const sharp = mode === 'major' ? SHARP_MAJOR : SHARP_MINOR;
  const table = flat.has(t) ? FLAT_NAMES : sharp.has(t) ? SHARP_NAMES : DEFAULT_NAMES;
  return (pc) => table[mod12(pc)] as string;
}

const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A3"、"Bb3"、"F#4" → MIDI；無法解析回傳 undefined。 */
export function parseNoteName(text: string): number | undefined {
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(text.trim());
  if (!m) return undefined;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + (NATURAL_PC[(m[1] as string).toUpperCase()] as number) + acc;
}

export function midiName(midi: number, speller: Speller = defaultSpeller): string {
  return `${speller(midi)}${Math.floor(midi / 12) - 1}`;
}
