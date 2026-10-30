import { chordPcs, STANDARD_TUNING, type Fret } from './chord';
import { mod12 } from './pitch';
import type { QualityDef } from './qualities';
import { voiceLeadingCost } from './voiceLeading';

export interface VoicingCandidate {
  frets: Fret[];
  cost: number;
}

export interface VoicingOptions {
  /** 指定低音（斜線和弦）；未指定則偏好根音在低音 */
  bassPc?: number;
  /** 前一個和弦的指法，用於計算聲部移動成本 */
  prev?: readonly Fret[];
  tuning?: readonly number[];
  limit?: number;
  maxFret?: number;
}

const SPAN = 3; // 按壓範圍：4 個品（base .. base+3）

/**
 * 結果快取：同樣的和弦、低音、前一個指法會在每次畫面更新時重算（建議卡片、配和弦），
 * 枚舉一次要幾毫秒，在手機上累積起來會讓打字卡頓。
 */
const CACHE_LIMIT = 400;
const cache = new Map<string, VoicingCandidate[]>();

/**
 * 枚舉指板上可彈的和弦指法並依成本排序。
 * 限制：至少 4 條弦發聲（七和弦以上可為 3 條弦的殼和弦）、中間最多悶一條弦、含全部必要音、
 * 按壓跨距 ≤ 4 品、非最低品位的按壓 ≤ 3 弦。
 */
export function generateVoicings(rootPc: number, q: QualityDef, opts: VoicingOptions = {}): VoicingCandidate[] {
  const key = [
    rootPc,
    q.id,
    opts.bassPc ?? '',
    opts.prev ? opts.prev.map((f) => (f === null ? 'x' : f)).join('.') : '',
    (opts.tuning ?? STANDARD_TUNING).join('.'),
    opts.limit ?? 5,
    opts.maxFret ?? 15,
  ].join('|');
  let hit = cache.get(key);
  if (hit) {
    cache.delete(key); // 移到最新（簡單的 LRU）
  } else {
    hit = enumerateVoicings(rootPc, q, opts);
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  }
  cache.set(key, hit);
  // 回傳複本，呼叫端改動不會汙染快取
  return hit.map((v) => ({ frets: [...v.frets], cost: v.cost }));
}

function enumerateVoicings(rootPc: number, q: QualityDef, opts: VoicingOptions): VoicingCandidate[] {
  const tuning = opts.tuning ?? STANDARD_TUNING;
  const maxFret = opts.maxFret ?? 15;
  const limit = opts.limit ?? 5;
  const pcs = new Set(chordPcs(rootPc, q));
  const required = new Set(q.intervals.filter((i) => !q.optional.includes(i)).map((i) => mod12(rootPc + i)));
  const seen = new Map<string, VoicingCandidate>();

  for (let base = 0; base <= maxFret - SPAN; base++) {
    const options: Fret[][] = tuning.map((open) => {
      const opts2: Fret[] = [null];
      for (let f = 0; f <= base + SPAN; f++) {
        const inWindow = f >= Math.max(base, 1);
        const openOk = f === 0 && base <= 2;
        if (!inWindow && !openOk) continue;
        if (pcs.has(mod12(open + f))) opts2.push(f);
      }
      return opts2;
    });

    const cur: Fret[] = new Array(tuning.length).fill(null);
    const walk = (i: number): void => {
      if (i === tuning.length) {
        const key = cur.map((f) => (f === null ? 'x' : f)).join(',');
        if (seen.has(key)) return;
        const cost = evaluate(cur, tuning, pcs, required, rootPc, opts);
        if (cost !== null) seen.set(key, { frets: [...cur], cost });
        return;
      }
      for (const f of options[i] as Fret[]) {
        cur[i] = f;
        walk(i + 1);
      }
      cur[i] = null;
    };
    walk(0);
  }
  return [...seen.values()].sort((a, b) => a.cost - b.cost).slice(0, limit);
}

function evaluate(
  frets: readonly Fret[],
  tuning: readonly number[],
  pcs: Set<number>,
  required: Set<number>,
  rootPc: number,
  opts: VoicingOptions,
): number | null {
  const idx = frets.map((f, i) => (f === null ? -1 : i)).filter((i) => i >= 0);
  // 一般至少 4 條弦；七和弦以上也接受 3 條弦的「殼和弦」（根音、三音、七音，爵士與 Neo-Soul 常用）
  const isShell = idx.length === 3 && required.size >= 3 && pcs.size >= 4;
  if (idx.length < 4 && !isShell) return null;
  const lo = idx[0] as number;
  const hi = idx[idx.length - 1] as number;
  // 中間最多悶一條弦（例如 x 3 x 3 4 x 這類跳弦按法），再多就很難彈乾淨
  const gaps = hi - lo + 1 - idx.length;
  if (gaps > 1) return null;

  const present = new Set(idx.map((i) => mod12((tuning[i] as number) + (frets[i] as number))));
  for (const r of required) if (!present.has(r)) return null;
  for (const p of present) if (!pcs.has(p)) return null;

  const bassPc = mod12((tuning[lo] as number) + (frets[lo] as number));
  if (opts.bassPc !== undefined && bassPc !== opts.bassPc) return null;

  const fretted = idx.map((i) => frets[i] as number).filter((f) => f > 0);
  const minFret = fretted.length ? Math.min(...fretted) : 0;
  const nonBarre = fretted.filter((f) => f !== minFret).length;
  if (nonBarre > 3) return null;

  const avg = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : 0;
  let cost = 0;
  if (opts.prev) cost += voiceLeadingCost(opts.prev, frets) + Math.abs(avg - avgFret(opts.prev)) * 0.5;
  else cost += Math.abs(avg - 5) * 0.3;
  cost += (6 - idx.length) * 0.4;
  cost += gaps * 0.6;
  if (opts.bassPc === undefined && bassPc !== rootPc) cost += 1.5;
  cost += idx.filter((i) => frets[i] === 0).length * 0.2;
  if (avg > 12) cost += 2;
  return Math.round(cost * 100) / 100;
}

function avgFret(frets: readonly Fret[]): number {
  const f = frets.filter((x): x is number => x !== null && x > 0);
  return f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0;
}
