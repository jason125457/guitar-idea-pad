import { chordPcs, type ChordRef } from './chord';
import { mod12 } from './pitch';
import { isMinorish, quality, type Family } from './qualities';

export type Mode = 'major' | 'minor';

export interface KeyGuess {
  tonic: number;
  mode: Mode;
  score: number;
  /** 0–1，與第二名的差距；越低代表越有歧義。只有第一名有意義，其餘為 0 */
  confidence: number;
}

export type ChordTag = 'diatonic' | 'borrowed' | 'secondary-dominant' | 'tritone-sub' | 'chromatic';

export interface ChordFunctionInfo {
  roman: string;
  function: 'T' | 'S' | 'D' | 'other';
  tag: ChordTag;
  /** 例如 "parallel-minor"、"V/ii" */
  detail?: string;
  weight: number;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_HOME = [0, 2, 3, 5, 7, 8, 10, 11]; // 自然小調 ∪ 和聲小調
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

const ROMAN_MAJOR = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
const ROMAN_MINOR = ['I', '♭II', 'II', 'III', '♯III', 'IV', '♭V', 'V', 'VI', '♯VI', 'VII', '♯VII'];

const FUNCTION_BY_REL: Record<number, 'T' | 'S' | 'D'> = {
  0: 'T', 1: 'D', 2: 'S', 3: 'T', 4: 'T', 5: 'S', 7: 'D', 8: 'S', 9: 'T', 10: 'D', 11: 'D',
};

const MAJOR_TARGETS_SECONDARY = [2, 4, 5, 7, 9];
const MINOR_TARGETS_SECONDARY = [3, 5, 7, 8, 10];
const MAJOR_TARGETS_TRITONE = [0, 2, 4, 5, 7, 9];
const MINOR_TARGETS_TRITONE = [0, 3, 5, 7, 8, 10];

const subsetOf = (rel: number[], scale: number[]): boolean => rel.every((r) => scale.includes(r));

/** 調內七個音的 pitch class（小調取自然小調）。 */
export function scalePcsForKey(key: Pick<KeyGuess, 'tonic' | 'mode'>): number[] {
  return (key.mode === 'major' ? MAJOR_SCALE : NATURAL_MINOR).map((i) => mod12(key.tonic + i));
}

function isTonicChord(c: ChordRef, tonic: number, mode: Mode): boolean {
  if (c.rootPc !== tonic) return false;
  const fam: Family = quality(c.qualityId).family;
  return mode === 'major' ? fam === 'major' : fam === 'minor';
}

export function romanNumeral(c: ChordRef, tonic: number, mode: Mode): string {
  const rel = mod12(c.rootPc - tonic);
  const q = quality(c.qualityId);
  const base = (mode === 'major' ? ROMAN_MAJOR : ROMAN_MINOR)[rel] as string;
  const m = /^([♭♯]?)(.*)$/.exec(base) as RegExpExecArray;
  const numeral = isMinorish(q.family) ? (m[2] as string).toLowerCase() : (m[2] as string);
  let suffix = q.symbol;
  if (q.id === 'min') suffix = '';
  if (q.id === 'dim') suffix = '°';
  return `${m[1]}${numeral}${suffix}`;
}

/** 單一和弦在某調中的角色：順階、借用、副屬、三全音替代或調外。 */
export function classifyChord(c: ChordRef, tonic: number, mode: Mode): ChordFunctionInfo {
  const q = quality(c.qualityId);
  const rel = chordPcs(c.rootPc, q).map((p) => mod12(p - tonic));
  const relRoot = mod12(c.rootPc - tonic);
  const roman = romanNumeral(c, tonic, mode);
  const home = mode === 'major' ? MAJOR_SCALE : MINOR_HOME;
  const parallel = mode === 'major' ? NATURAL_MINOR : MAJOR_SCALE;
  const fn = FUNCTION_BY_REL[relRoot] ?? 'other';

  if (subsetOf(rel, home)) return { roman, function: fn, tag: 'diatonic', weight: 1 };
  if (subsetOf(rel, parallel)) {
    return {
      roman,
      function: fn,
      tag: 'borrowed',
      detail: mode === 'major' ? 'parallel-minor' : 'parallel-major',
      weight: 0.6,
    };
  }
  if (q.family === 'dominant') {
    const secTargets = mode === 'major' ? MAJOR_TARGETS_SECONDARY : MINOR_TARGETS_SECONDARY;
    const secTarget = mod12(relRoot - 7);
    if (secTargets.includes(secTarget)) {
      const targetRoman = (mode === 'major' ? ROMAN_MAJOR : ROMAN_MINOR)[secTarget] as string;
      return { roman, function: 'D', tag: 'secondary-dominant', detail: `V/${targetRoman}`, weight: 0.5 };
    }
    const triTargets = mode === 'major' ? MAJOR_TARGETS_TRITONE : MINOR_TARGETS_TRITONE;
    const triTarget = mod12(relRoot - 1);
    if (triTargets.includes(triTarget)) {
      const targetRoman = (mode === 'major' ? ROMAN_MAJOR : ROMAN_MINOR)[triTarget] as string;
      return { roman, function: 'D', tag: 'tritone-sub', detail: `subV/${targetRoman}`, weight: 0.4 };
    }
  }
  return { roman, function: 'other', tag: 'chromatic', weight: 0 };
}

function scoreKey(chords: ChordRef[], tonic: number, mode: Mode): number {
  let score = 0;
  chords.forEach((c, i) => {
    score += classifyChord(c, tonic, mode).weight;
    const next = chords[i + 1];
    if (next) {
      const isDominantToTonic =
        quality(c.qualityId).family === 'dominant' &&
        mod12(c.rootPc - tonic) === 7 &&
        isTonicChord(next, tonic, mode);
      if (isDominantToTonic) score += 0.3;
    }
  });
  const first = chords[0];
  const last = chords[chords.length - 1];
  if (first && isTonicChord(first, tonic, mode)) score += 0.3;
  if (last && isTonicChord(last, tonic, mode)) score += 0.5;
  return score;
}

/** 推論最可能的調，回傳前幾名（分數同分時大調優先）。 */
export function inferKey(chords: ChordRef[], topN = 3): KeyGuess[] {
  if (chords.length === 0) return [];
  const all: Omit<KeyGuess, 'confidence'>[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      all.push({ tonic, mode, score: scoreKey(chords, tonic, mode) });
    }
  }
  all.sort((a, b) => b.score - a.score || (a.mode === 'major' ? -1 : 1));
  const top = all[0] as Omit<KeyGuess, 'confidence'>;
  const second = all[1] as Omit<KeyGuess, 'confidence'>;
  const gap = top.score - second.score;
  const confidence = Math.max(0, Math.min(1, gap / (0.6 * chords.length + 0.8)));
  return all.slice(0, topN).map((k, i) => ({ ...k, confidence: i === 0 ? confidence : 0 }));
}

export function analyzeProgression(chords: ChordRef[], key: Pick<KeyGuess, 'tonic' | 'mode'>): ChordFunctionInfo[] {
  return chords.map((c) => classifyChord(c, key.tonic, key.mode));
}
