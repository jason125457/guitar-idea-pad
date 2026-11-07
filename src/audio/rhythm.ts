/**
 * 節奏型：把「這個和弦彈幾拍」變成實際要發出的每一下（刷弦或撥單音）。
 * 純函式，不碰 AudioContext，方便測試；排進時間軸由 pluck.ts 負責。
 */
import type { StrumPattern } from '../core';
import { strumBeats, type TimedChord } from './pluck';

const BEATS_PER_BAR = 4;
const EIGHTHS_PER_BAR = BEATS_PER_BAR * 2;
const EIGHTHS_PER_CYCLE = EIGHTHS_PER_BAR * 2;
const EPS = 1e-9;

/** 民謠刷法（第一小節）「下、下上、上下上」：一小節八個八分音符裡哪幾個要刷、往哪刷、多大力。 */
const FOLK: Record<number, { dir: 'down' | 'up'; level: number }> = {
  0: { dir: 'down', level: 1 },
  2: { dir: 'down', level: 0.8 },
  3: { dir: 'up', level: 0.55 },
  5: { dir: 'up', level: 0.55 },
  6: { dir: 'down', level: 0.8 },
  7: { dir: 'up', level: 0.55 },
};

/** 民謠刷法的變化小節（第二小節）：「下、下上、下下上」，結尾多掃一下下，把句子推向下一小節。 */
const FOLK_B: Record<number, { dir: 'down' | 'up'; level: number }> = {
  0: { dir: 'down', level: 1 },
  2: { dir: 'down', level: 0.8 },
  3: { dir: 'up', level: 0.55 },
  5: { dir: 'down', level: 0.75 },
  6: { dir: 'down', level: 0.8 },
  7: { dir: 'up', level: 0.55 },
};

/** 分解和弦時高音部分的撥弦順序：往上再往下，例如 3 條弦是 0 1 2 1。 */
function upDown(n: number): number[] {
  if (n <= 1) return [0];
  const up = Array.from({ length: n }, (_, i) => i);
  return [...up, ...up.slice(1, -1).reverse()];
}

/**
 * 一個和弦用某個節奏型彈出來的每一下。
 * @param startBeat 這個和弦在段落裡從第幾拍開始（決定它落在小節的哪裡，例如民謠刷法的「下」要對在正拍）
 */
export function patternEvents(midis: readonly number[], beats: number, beatSec: number, pattern: StrumPattern, startBeat = 0): TimedChord[] {
  const notes = [...midis].sort((a, b) => a - b);
  if (!notes.length || beats <= 0) return [];
  if (pattern === 'beat') return strumBeats([{ midis: notes, beats }], beatSec);

  const end = beats;
  /** 這個和弦內部第 b 拍 → 秒 */
  const sec = (b: number) => b * beatSec;
  /** 段落裡的位置 → 小節內第幾個八分音符 */
  const phase = (e: number) => (((Math.round(startBeat * 2) + e) % EIGHTHS_PER_BAR) + EIGHTHS_PER_BAR) % EIGHTHS_PER_BAR;

  if (pattern === 'whole') {
    // 和弦開始刷一下，之後遇到小節線再刷一下，中間讓它響
    const out: TimedChord[] = [];
    let b = 0;
    while (b < end - EPS) {
      const inBar = (((startBeat + b) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
      const next = Math.min(end, b + (BEATS_PER_BAR - inBar));
      out.push({ midis: notes, startSec: sec(b), durSec: sec(next - b), level: b === 0 ? 1 : 0.8, ring: 0.8 });
      b = next;
    }
    return out;
  }

  const eighths = Math.round(end * 2);
  if (pattern === 'folk') {
    const hits: { e: number; dir: 'down' | 'up'; level: number }[] = [];
    for (let e = 0; e < eighths; e++) {
      const p = phase(e);
      // 兩小節一輪：單數小節「下、下上、上下上」，雙數小節「下、下上、下下上」
      const second = (((Math.round(startBeat * 2) + e) % EIGHTHS_PER_CYCLE) + EIGHTHS_PER_CYCLE) % EIGHTHS_PER_CYCLE >= EIGHTHS_PER_BAR;
      const h = (second ? FOLK_B : FOLK)[p];
      if (h) hits.push({ e, ...h });
      else if (e === 0) hits.push({ e, dir: 'down', level: 0.9 }); // 和弦換在空拍上也要聽得到
    }
    return hits.map((h, i) => {
      const nextE = hits[i + 1]?.e ?? eighths;
      // 往上刷通常只掃到高音那幾條弦
      const m = h.dir === 'up' ? notes.slice(Math.max(0, notes.length - 4)) : notes;
      return { midis: m, startSec: sec(h.e / 2), durSec: sec((nextE - h.e) / 2), level: h.level, dir: h.dir };
    });
  }

  if (pattern === 'palm') {
    // 每個八分音符悶一下，只用低音那三條弦（像強力和弦），正拍稍重
    const low = notes.slice(0, Math.min(3, notes.length));
    return Array.from({ length: eighths }, (_, e) => ({
      midis: low,
      startSec: sec(e / 2),
      durSec: sec(0.5),
      level: e === 0 ? 1 : phase(e) % 2 === 0 ? 0.85 : 0.62,
      ring: 0.06,
    }));
  }

  // 分解和弦：小節開頭和換和弦時先彈低音，其餘依序往上再往下撥高音弦，每個音讓它響到和弦結束
  const bass = notes[0] as number;
  const uppers = notes.length > 1 ? notes.slice(1) : notes;
  const order = upDown(uppers.length);
  let k = 0;
  return Array.from({ length: eighths }, (_, e) => {
    const onBass = e === 0 || phase(e) === 0;
    if (onBass) k = 0;
    const note = onBass ? bass : (uppers[order[k++ % order.length] as number] as number);
    return { midis: [note], startSec: sec(e / 2), durSec: sec(end - e / 2), level: onBass ? 0.9 : 0.65 };
  });
}
