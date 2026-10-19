import type { Fret } from './chord';

export type Motion = 'common-tone' | 'stepwise' | 'planing' | 'mixed';

export interface Transition {
  /** 每條弦的半音位移，任一側悶音則為 null */
  stringDeltas: (number | null)[];
  motion: Motion;
}

export interface ChromaticLine {
  /** 0 = 六弦 */
  string: number;
  direction: 'up' | 'down';
  /** 連續半音步數（A→Ab→G = 2） */
  steps: number;
  fromTransition: number;
}

export function midisOf(frets: readonly Fret[], tuning: readonly number[], capo = 0): (number | null)[] {
  return frets.map((f, i) => (f === null ? null : (tuning[i] as number) + capo + f));
}

export function transition(a: readonly (number | null)[], b: readonly (number | null)[]): Transition {
  const stringDeltas = a.map((x, i) => {
    const y = b[i];
    return x === null || y === null || y === undefined ? null : y - x;
  });
  const moved = stringDeltas.filter((d): d is number => d !== null);
  let motion: Motion = 'mixed';
  if (moved.length > 0 && moved.every((d) => d === 0)) motion = 'common-tone';
  else if (moved.length >= 3 && moved.every((d) => d === moved[0])) motion = 'planing';
  else if (moved.every((d) => Math.abs(d) <= 2)) motion = 'stepwise';
  return { stringDeltas, motion };
}

/** 每弦的 MIDI 序列中，同方向連續半音位移 ≥ minSteps 的線條，即內聲部半音進行。 */
export function findChromaticLines(
  sequence: readonly (readonly (number | null)[])[],
  minSteps = 2,
): ChromaticLine[] {
  const lines: ChromaticLine[] = [];
  for (let s = 0; s < 6; s++) {
    let runDir = 0;
    let runStart = 0;
    let runLen = 0;
    const flush = () => {
      if (runLen >= minSteps) {
        lines.push({ string: s, direction: runDir > 0 ? 'up' : 'down', steps: runLen, fromTransition: runStart });
      }
      runDir = 0;
      runLen = 0;
    };
    for (let t = 0; t + 1 < sequence.length; t++) {
      const a = sequence[t]?.[s];
      const b = sequence[t + 1]?.[s];
      const d = a === null || a === undefined || b === null || b === undefined ? null : b - a;
      if (d === 1 || d === -1) {
        if (runDir === d) runLen++;
        else {
          flush();
          runDir = d;
          runStart = t;
          runLen = 1;
        }
      } else flush();
    }
    flush();
  }
  return lines;
}

/** 兩個指法之間的聲部移動成本（越小越順）。 */
export function voiceLeadingCost(a: readonly Fret[], b: readonly Fret[]): number {
  let cost = 0;
  for (let i = 0; i < 6; i++) {
    const x = a[i];
    const y = b[i];
    if (x === null || x === undefined || y === null || y === undefined) {
      if ((x === null || x === undefined) !== (y === null || y === undefined)) cost += 2;
    } else cost += Math.abs(x - y);
  }
  return cost;
}
