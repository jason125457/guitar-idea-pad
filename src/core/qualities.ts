export type Family = 'major' | 'minor' | 'dominant' | 'diminished' | 'other';

export interface QualityDef {
  id: string;
  /** 接在根音名後面的符號，例如 maj7、m7。 */
  symbol: string;
  intervals: number[];
  /** 可省略的音程（通常是五音）。 */
  optional: number[];
  family: Family;
  /** 常見度加分，用於同分排序。 */
  prior: number;
}

const q = (
  id: string,
  symbol: string,
  intervals: number[],
  family: Family,
  prior: number,
  optional: number[] = [],
): QualityDef => ({ id, symbol, intervals, optional, family, prior });

export const QUALITY_LIST: QualityDef[] = [
  q('maj', '', [0, 4, 7], 'major', 0.12),
  q('min', 'm', [0, 3, 7], 'minor', 0.12),
  q('5', '5', [0, 7], 'other', 0.03),
  q('sus2', 'sus2', [0, 2, 7], 'other', 0.06),
  q('sus4', 'sus4', [0, 5, 7], 'other', 0.08),
  q('aug', 'aug', [0, 4, 8], 'other', 0.05),
  q('dim', 'dim', [0, 3, 6], 'diminished', 0.06),
  q('6', '6', [0, 4, 7, 9], 'major', 0.07, [7]),
  q('m6', 'm6', [0, 3, 7, 9], 'minor', 0.06, [7]),
  q('maj7', 'maj7', [0, 4, 7, 11], 'major', 0.1, [7]),
  q('7', '7', [0, 4, 7, 10], 'dominant', 0.1, [7]),
  q('m7', 'm7', [0, 3, 7, 10], 'minor', 0.1, [7]),
  q('mMaj7', 'm(maj7)', [0, 3, 7, 11], 'minor', 0.04, [7]),
  q('m7b5', 'm7b5', [0, 3, 6, 10], 'diminished', 0.07),
  q('dim7', 'dim7', [0, 3, 6, 9], 'diminished', 0.05),
  q('7sus4', '7sus4', [0, 5, 7, 10], 'dominant', 0.05, [7]),
  q('add9', 'add9', [0, 2, 4, 7], 'major', 0.07, [7]),
  q('madd9', 'm(add9)', [0, 2, 3, 7], 'minor', 0.05, [7]),
  q('maj9', 'maj9', [0, 2, 4, 7, 11], 'major', 0.06, [7]),
  q('9', '9', [0, 2, 4, 7, 10], 'dominant', 0.06, [7]),
  q('m9', 'm9', [0, 2, 3, 7, 10], 'minor', 0.06, [7]),
  q('7b9', '7b9', [0, 1, 4, 7, 10], 'dominant', 0.03, [7]),
  q('7#9', '7#9', [0, 3, 4, 7, 10], 'dominant', 0.03, [7]),
];

export const QUALITIES: Record<string, QualityDef> = Object.fromEntries(
  QUALITY_LIST.map((d) => [d.id, d]),
);

export function quality(id: string): QualityDef {
  const d = QUALITIES[id];
  if (!d) throw new Error(`unknown chord quality: ${id}`);
  return d;
}

export const isMinorish = (f: Family): boolean => f === 'minor' || f === 'diminished';
