import { analyzeVoicing, chordPcs, STANDARD_TUNING, type ChordRef, type Fret } from './chord';
import { mod12 } from './pitch';
import { quality, type QualityDef } from './qualities';
import { computeFingering, shapesFor, type Finger } from './shapes';
import { voiceLeadingCost } from './voiceLeading';

export interface VoicingCandidate {
  frets: Fret[];
  cost: number;
  /** 建議手指（來自按法庫，或依常見按法推算） */
  fingers?: Finger[];
}

/**
 * 指法風格：
 *  - open：一般指法，開放和弦優先，其次是封閉和弦
 *  - electric：電吉他高把位，只用可移動的形狀（不用空弦），偏好第 5～12 品
 */
export type VoicingStyle = 'open' | 'electric';

export interface VoicingOptions {
  /** 指定低音（斜線和弦）；未指定則偏好根音在低音 */
  bassPc?: number;
  /** 前一個和弦的指法，用於計算聲部移動成本 */
  prev?: readonly Fret[];
  tuning?: readonly number[];
  limit?: number;
  maxFret?: number;
  style?: VoicingStyle;
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
    opts.style ?? 'open',
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
        const openOk = f === 0 && base <= 2 && opts.style !== 'electric';
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
  const electric = opts.style === 'electric';
  const isShell = idx.length === 3 && required.size >= 3 && pcs.size >= 4;
  // 電吉他常在相鄰三條弦上彈三和弦（例如二、三、四弦），所以三條弦都可以
  if (idx.length < 4 && !isShell && !(electric && idx.length === 3)) return null;
  if (electric && idx.length === 6) return null;
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
  // 手指排不出來（超過四指、封閉中間夾著悶音或空弦）的不要
  if (!computeFingering(frets)) return null;

  const fretted = idx.map((i) => frets[i] as number).filter((f) => f > 0);
  const minFret = fretted.length ? Math.min(...fretted) : 0;
  const nonBarre = fretted.filter((f) => f !== minFret).length;
  if (nonBarre > 3) return null;

  const avg = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : 0;
  if (electric) return electricCost(frets, idx, gaps, avg, opts);
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

/** 電吉他高把位：四條弦最好、不碰六弦低音、待在第 5～12 品，前後和弦盡量留在同一個把位。 */
function electricCost(frets: readonly Fret[], idx: number[], gaps: number, avg: number, opts: VoicingOptions): number {
  let cost = 0;
  if (opts.prev) cost += voiceLeadingCost(opts.prev, frets) * 0.6 + Math.abs(avg - avgFret(opts.prev)) * 0.8;
  else cost += Math.abs(avg - 7.5) * 0.35;
  cost += Math.abs(idx.length - 4) * 0.5;
  cost += gaps * 0.8;
  if (avg < 5) cost += (5 - avg) * 0.8;
  if (avg > 12) cost += (avg - 12) * 0.8;
  // 六弦當低音在破音或大量殘響下容易糊
  if (idx[0] === 0) cost += 0.6;
  return Math.round(cost * 100) / 100;
}

/**
 * 一個和弦的候選指法（成本低的在前）。
 * 先用按法庫裡的常用形狀（吉他手實際會按、附手指編號）；庫裡沒有的和弦才用枚舉補上，
 * 而且只留「手指排得出來」且「放回引擎辨識後仍是同一個和弦」的。
 */
export function voicingChoices(ch: ChordRef, style: VoicingStyle = 'open', limit = 6): VoicingCandidate[] {
  const fromLibrary: VoicingCandidate[] = shapesFor(ch)
    .filter((sh) => style === 'open' || sh.movable)
    .map((sh) => ({ frets: sh.frets, fingers: sh.fingers, cost: shapeCost(sh.frets, sh.tier, sh.movable, style) }));

  const all = generateVoicings(ch.rootPc, quality(ch.qualityId), { bassPc: ch.bassPc, style, limit: 24 });
  const same = all.filter((v) => {
    const best = analyzeVoicing(v.frets).best;
    return best !== undefined && best.rootPc === ch.rootPc && best.qualityId === ch.qualityId && best.bassPc === ch.bassPc;
  });
  // 枚舉出來的不是常見按法，排在按法庫後面
  const generated = (same.length ? same : all).map((v) => ({
    frets: v.frets,
    cost: v.cost + 3,
    ...(computeFingering(v.frets) ? { fingers: computeFingering(v.frets) } : {}),
  }));

  const seen = new Set<string>();
  const out: VoicingCandidate[] = [];
  for (const v of [...fromLibrary.sort((a, b) => a.cost - b.cost), ...generated]) {
    const k = v.frets.map((f) => (f === null ? 'x' : f)).join(' ');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  // 按法庫有夠多選擇時，就不拿枚舉的來湊數
  const libCount = out.filter((v) => fromLibrary.some((l) => l.frets === v.frets)).length;
  return out.slice(0, libCount >= 3 ? Math.min(limit, libCount) : limit);
}

/** 按法庫形狀的成本：電吉他偏好第 5～12 品；一般指法偏好開放和弦，再來是低把位的封閉和弦。 */
function shapeCost(frets: readonly Fret[], tier: 1 | 2, movable: boolean, style: VoicingStyle): number {
  const avg = avgFret(frets);
  const strings = frets.filter((f) => f !== null).length;
  let cost = tier === 2 ? 1.2 : 0;
  if (style === 'electric') {
    if (avg < 5) cost += (5 - avg) * 0.4;
    if (avg > 12) cost += (avg - 12) * 0.4;
    if (strings === 6) cost += 0.4;
  } else if (movable) {
    cost += 0.8 + Math.max(0, avg - 5) * 0.3;
  }
  return Math.round(cost * 100) / 100;
}

/**
 * 為一整串和弦挑指法：每個和弦先列出幾個候選，再用動態規劃找整串最順手的組合
 * （手指移動少、把位不亂跳），不是一個接一個貪心地挑。
 * 候選來自 voicingChoices，畫面上顯示的和弦名稱才會和輸入的一致。
 */
export function voiceProgression(chords: readonly ChordRef[], style: VoicingStyle = 'open'): Fret[][] {
  const empty: Fret[] = [null, null, null, null, null, null];
  const options = chords.map((ch) => {
    const pool = voicingChoices(ch, style, 10);
    return pool.length ? pool : [{ frets: empty, cost: 0 }];
  });
  if (!options.length) return [];

  const move = moveCost(style);
  // best[i][k]：前 i 個和弦、第 i 個用候選 k 的最小總成本
  let best = (options[0] as VoicingCandidate[]).map((v) => v.cost);
  const back: number[][] = [];
  for (let i = 1; i < options.length; i++) {
    const prevOpts = options[i - 1] as VoicingCandidate[];
    const row: number[] = [];
    const from: number[] = [];
    for (const v of options[i] as VoicingCandidate[]) {
      let min = Infinity;
      let arg = 0;
      prevOpts.forEach((p, j) => {
        const c = (best[j] as number) + move(p.frets, v.frets);
        if (c < min) [min, arg] = [c, j];
      });
      row.push(min + v.cost);
      from.push(arg);
    }
    best = row;
    back.push(from);
  }
  let k = best.indexOf(Math.min(...best));
  const out: Fret[][] = new Array(options.length);
  for (let i = options.length - 1; i >= 0; i--) {
    out[i] = [...((options[i] as VoicingCandidate[])[k] as VoicingCandidate).frets];
    if (i > 0) k = (back[i - 1] as number[])[k] as number;
  }
  return out;
}

function avgFret(frets: readonly Fret[]): number {
  const f = frets.filter((x): x is number => x !== null && x > 0);
  return f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0;
}

/** 換和弦的成本：電吉他重視留在同一個把位；一般指法讓開放和弦優先，換把位的成本壓低。 */
const moveCost = (style: VoicingStyle) => (a: readonly Fret[], b: readonly Fret[]) =>
  style === 'electric'
    ? voiceLeadingCost(a, b) * 0.6 + Math.abs(avgFret(a) - avgFret(b)) * 0.8
    : voiceLeadingCost(a, b) * 0.15 + Math.abs(avgFret(a) - avgFret(b)) * 0.2;

/** 接在使用者現有的 prev 後面加一個和弦：用和整串配指法一樣的成本挑最順手的候選；沒有 prev 時挑最常見的。 */
export function voiceAfter(prev: readonly Fret[] | undefined, ch: ChordRef, style: VoicingStyle = 'open'): Fret[] | undefined {
  const pool = voicingChoices(ch, style, 10);
  if (!pool.length) return undefined;
  if (!prev || !prev.some((f) => f !== null)) return [...(pool[0] as VoicingCandidate).frets];
  const move = moveCost(style);
  let best = pool[0] as VoicingCandidate;
  let min = Infinity;
  for (const v of pool) {
    const c = v.cost + move(prev, v.frets);
    if (c < min) [min, best] = [c, v];
  }
  return [...best.frets];
}
