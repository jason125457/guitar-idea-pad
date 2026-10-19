/**
 * 旋律配和弦：旋律（含節奏）→ 調性 → 以小節為單位切窗 → 每窗挑和弦。
 *
 * 做法是規則 + 動態規劃，不是機器學習：
 *  - 發射分數：窗內每個旋律音對候選和弦的契合度（和弦音最好，半音摩擦扣分），以音長與拍點加權
 *  - 轉移分數：常見的和聲走向（下行五度、屬到主、離調等）
 *  - 用 Viterbi 找整體最順的一條路，並用前後向分數為每窗列出可替換的候選
 */
import type { ChordRef, Fret } from './chord';
import { classifyChord, scalePcsForKey, type ChordTag, type KeyGuess, type Mode } from './key';
import { mod12 } from './pitch';
import { quality } from './qualities';
import type { TimedNote } from './song';
import { generateVoicings } from './voicing';

// ── 調性（從旋律推論） ──

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = (a[i] as number) - ma;
    const y = (b[i] as number) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/**
 * 以音長加權的音級分布對照 Krumhansl-Kessler 調性輪廓；結尾落在主音加分（旋律通常回到主音收尾）。
 * 回傳前幾名，confidence 只有第一名有意義（與第二名的差距）。
 */
export function inferKeyFromMelody(notes: readonly Pick<TimedNote, 'midi' | 'durSec'>[], topN = 3): KeyGuess[] {
  if (notes.length === 0) return [];
  const hist = new Array<number>(12).fill(0);
  for (const n of notes) hist[mod12(n.midi)] = (hist[mod12(n.midi)] as number) + Math.max(0.05, n.durSec);
  const lastPc = mod12((notes[notes.length - 1] as { midi: number }).midi);
  const all: Omit<KeyGuess, 'confidence'>[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const profile = mode === 'major' ? KK_MAJOR : KK_MINOR;
      const rotated = Array.from({ length: 12 }, (_, pc) => profile[mod12(pc - tonic)] as number);
      all.push({ tonic, mode, score: correlation(hist, rotated) + (lastPc === tonic ? 0.06 : 0) });
    }
  }
  all.sort((a, b) => b.score - a.score || (a.mode === 'major' ? -1 : 1));
  const gap = (all[0] as { score: number }).score - (all[1] as { score: number }).score;
  const confidence = Math.max(0, Math.min(1, gap / 0.12));
  return all.slice(0, topN).map((k, i) => ({ ...k, confidence: i === 0 ? confidence : 0 }));
}

// ── 速度 ──

/**
 * 從音符起點估計速度：在 50–160 BPM 之間找最能讓起點落在拍點（與半拍）上的值，
 * 並偏好 70–120 這個常見範圍。人聲節奏不精準，所以結果只當預設值，使用者可修改。
 */
export function estimateTempo(notes: readonly Pick<TimedNote, 'startSec' | 'durSec'>[]): number {
  if (notes.length < 3) return 90;
  const t0 = (notes[0] as TimedNote).startSec;
  let best = 90;
  let bestScore = -Infinity;
  for (let bpm = 50; bpm <= 160; bpm++) {
    const beat = 60 / bpm;
    let s = 0;
    for (const n of notes) {
      const phase = (n.startSec - t0) / beat;
      const w = Math.min(1.5, n.durSec) + 0.3;
      s += w * (Math.cos(2 * Math.PI * phase) + 0.5 * Math.cos(4 * Math.PI * phase));
    }
    const prior = Math.exp(-((Math.log2(bpm / 92)) ** 2) / (2 * 0.45 ** 2));
    const score = (s / notes.length) * (0.6 + 0.4 * prior);
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  return best;
}

// ── 切窗 ──

export interface HarmonizeSettings {
  bpm: number;
  beatsPerBar: 3 | 4;
  /** 第一個音前面有幾拍「弱起」；這些拍不算進第一小節 */
  pickupBeats: number;
  /** 每小節換幾次和弦 */
  chordsPerBar: 1 | 2;
}

export interface WindowNote {
  midi: number;
  /** 在這個窗裡的分量：重疊拍數 + 起音加成 + 強拍加成 */
  weight: number;
  /** 起音落在窗的開頭附近（強拍） */
  strong: boolean;
}

export interface HarmonyWindow {
  index: number;
  bar: number;
  startBeat: number;
  endBeat: number;
  notes: WindowNote[];
  /** 這個窗裡沒有旋律（休止），會沿用前一個和弦 */
  empty: boolean;
}

export function buildWindows(notes: readonly TimedNote[], s: HarmonizeSettings): HarmonyWindow[] {
  if (notes.length === 0) return [];
  const beat = 60 / s.bpm;
  const t0 = (notes[0] as TimedNote).startSec;
  const gridStart = t0 + s.pickupBeats * beat;
  const winBeats = s.beatsPerBar / s.chordsPerBar;
  const endSec = Math.max(...notes.map((n) => n.startSec + n.durSec));
  const count = Math.max(1, Math.ceil((endSec - gridStart) / beat / winBeats - 1e-6));
  const windows: HarmonyWindow[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * winBeats;
    const b = a + winBeats;
    const inWin: WindowNote[] = [];
    for (const n of notes) {
      const ns = (n.startSec - gridStart) / beat;
      const ne = ns + n.durSec / beat;
      const overlap = Math.min(ne, b) - Math.max(ns, a);
      if (overlap > 0) {
        const onset = ns >= a - 0.25 && ns < b;
        const strong = ns >= a - 0.25 && ns < a + 0.25;
        inWin.push({ midi: n.midi, weight: overlap + (onset ? 0.5 : 0) + (strong ? 1 : 0), strong });
      } else if (i === 0 && ne <= 0 && ne > -s.pickupBeats - 0.01) {
        inWin.push({ midi: n.midi, weight: 0.3, strong: false }); // 弱起的音：只輕輕影響第一小節
      }
    }
    windows.push({ index: i, bar: Math.floor(a / s.beatsPerBar), startBeat: a, endBeat: b, notes: inWin, empty: inWin.length === 0 });
  }
  return windows;
}

// ── 候選和弦與分數 ──

export interface ChordChoice extends ChordRef {
  roman: string;
  tag: ChordTag;
  function: 'T' | 'S' | 'D' | 'other';
  /** 旋律契合度 −0.6..1（窗內加權平均） */
  fit: number;
  /** 整體路徑分數（含前後文），用於排序 */
  score: number;
}

interface Candidate {
  rel: number; // 根音相對主音的半音數
  qualityId: string;
  /** 越高越不常用，從分數扣掉 */
  penalty: number;
}

const c = (rel: number, qualityId: string, penalty = 0): Candidate => ({ rel, qualityId, penalty });

const MAJOR_CANDIDATES: Candidate[] = [
  c(0, 'maj'), c(0, 'maj7', 0.12), c(0, 'add9', 0.15),
  c(2, 'min'), c(2, 'm7', 0.1),
  c(4, 'min'), c(4, 'm7', 0.1),
  c(5, 'maj'), c(5, 'maj7', 0.12), c(5, 'add9', 0.15),
  c(7, 'maj'), c(7, '7', 0.08),
  c(9, 'min'), c(9, 'm7', 0.1),
  c(11, 'm7b5', 0.45),
  // 借用與副屬（常見但不是預設）
  c(10, 'maj', 0.35), c(5, 'min', 0.35), c(8, 'maj', 0.4), c(3, 'maj', 0.45),
  c(2, '7', 0.5), c(4, '7', 0.5), c(9, '7', 0.5),
];

const MINOR_CANDIDATES: Candidate[] = [
  c(0, 'min'), c(0, 'm7', 0.1),
  c(2, 'm7b5', 0.4),
  c(3, 'maj'), c(3, 'maj7', 0.12),
  c(5, 'min'), c(5, 'm7', 0.1),
  c(7, 'min', 0.15), c(7, 'maj', 0.1), c(7, '7', 0.15),
  c(8, 'maj'), c(8, 'maj7', 0.12),
  c(10, 'maj'), c(10, '7', 0.2),
  c(5, 'maj', 0.35), c(0, 'maj', 0.5),
];

/** 單一旋律音對和弦的契合度：和弦音 1，延伸音 .45，調內經過音 .15，半音摩擦或調外音為負。 */
function noteFit(midi: number, chord: { rootPc: number; qualityId: string }, scale: Set<number>, strong: boolean): number {
  const q = quality(chord.qualityId);
  const rel = mod12(midi - chord.rootPc);
  if (q.intervals.includes(rel)) return 1;
  const inScale = scale.has(mod12(midi));
  if ((rel === 2 || rel === 9) && inScale && q.family !== 'diminished') return 0.45;
  const rubs = q.intervals.some((t) => mod12(rel - t) === 1);
  if (inScale) return rubs ? (strong ? -0.5 : -0.1) : 0.15;
  return -0.6;
}

function windowFit(w: HarmonyWindow, chord: { rootPc: number; qualityId: string }, scale: Set<number>): number {
  if (w.notes.length === 0) return 0;
  let sum = 0;
  let total = 0;
  for (const n of w.notes) {
    sum += n.weight * noteFit(n.midi, chord, scale, n.strong);
    total += n.weight;
  }
  return sum / total;
}

const EMISSION_SCALE = 3;

function transition(a: ChordRef, b: ChordRef, nextEmpty: boolean): number {
  const same = a.rootPc === b.rootPc && a.qualityId === b.qualityId;
  if (nextEmpty) return same ? 0.8 : -0.5; // 休止：沿用前一個和弦
  const step = mod12(b.rootPc - a.rootPc);
  let s = 0;
  if (a.rootPc === b.rootPc) s = same ? -0.25 : -0.05;
  else if (step === 5) s = 0.6; // 下行五度（V→I、ii→V、I→IV）
  else if (step === 7) s = 0.35; // 上行五度（IV→I）
  else if (step === 2 || step === 9) s = 0.3; // 級進上行、I→vi 等
  else if (step === 10 || step === 8 || step === 3) s = 0.28;
  else if (step === 6) s = -0.3;
  else s = 0.05;
  if (quality(a.qualityId).family === 'dominant') s += step === 5 ? 0.5 : -0.2; // 屬七要往下解決
  return s;
}

function startBonus(rel: number, mode: Mode): number {
  if (rel === 0) return 0.5;
  if (mode === 'major' && (rel === 9 || rel === 5)) return 0.2;
  if (mode === 'minor' && (rel === 8 || rel === 5)) return 0.15;
  return rel === 7 ? -0.1 : 0;
}

function endBonus(rel: number, mode: Mode): number {
  if (rel === 0) return 0.6;
  if (rel === 7) return 0.2;
  if (mode === 'major' && rel === 9) return 0.1;
  return 0;
}

export interface HarmonizeResult {
  windows: HarmonyWindow[];
  /** 每個窗的候選，第 0 個是整體最順的路徑上的選擇，其後依序是替代 */
  choices: ChordChoice[][];
}

export function harmonize(
  windows: readonly HarmonyWindow[],
  key: Pick<KeyGuess, 'tonic' | 'mode'>,
  alternatives = 3,
): HarmonizeResult {
  const n = windows.length;
  if (n === 0) return { windows: [], choices: [] };
  const scale = new Set(scalePcsForKey(key));
  const cands = (key.mode === 'major' ? MAJOR_CANDIDATES : MINOR_CANDIDATES).map((cd) => ({
    ...cd,
    rootPc: mod12(key.tonic + cd.rel),
    bassPc: mod12(key.tonic + cd.rel),
  }));
  const K = cands.length;

  // 發射分數（休止窗的所有和弦都是 0，轉移分數決定要不要沿用）
  const E = windows.map((w) =>
    cands.map((cd) => (w.empty ? 0 : EMISSION_SCALE * windowFit(w, cd, scale) - cd.penalty)),
  );
  const T = (i: number, p: number, q: number) => transition(cands[p] as Candidate & ChordRef, cands[q] as Candidate & ChordRef, (windows[i] as HarmonyWindow).empty);

  // 前向（Viterbi）
  const delta: number[][] = [];
  const back: number[][] = [];
  delta[0] = cands.map((cd, k) => ((E[0] as number[])[k] as number) + startBonus(cd.rel, key.mode));
  back[0] = new Array<number>(K).fill(-1);
  for (let i = 1; i < n; i++) {
    const d: number[] = [];
    const bp: number[] = [];
    for (let k = 0; k < K; k++) {
      let best = -Infinity;
      let arg = 0;
      for (let p = 0; p < K; p++) {
        const v = ((delta[i - 1] as number[])[p] as number) + T(i, p, k);
        if (v > best) {
          best = v;
          arg = p;
        }
      }
      d.push(best + ((E[i] as number[])[k] as number));
      bp.push(arg);
    }
    delta[i] = d;
    back[i] = bp;
  }
  // 後向：從窗 i 的和弦往後，到結尾能再拿到的最高分（不含窗 i 自己的發射分數）
  const beta: number[][] = new Array<number[]>(n);
  beta[n - 1] = cands.map((cd) => endBonus(cd.rel, key.mode));
  for (let i = n - 2; i >= 0; i--) {
    beta[i] = cands.map((_, k) => {
      let best = -Infinity;
      for (let q = 0; q < K; q++) {
        best = Math.max(best, T(i + 1, k, q) + ((E[i + 1] as number[])[q] as number) + ((beta[i + 1] as number[])[q] as number));
      }
      return best;
    });
  }

  // 最佳路徑
  const total = (delta[n - 1] as number[]).map((v, k) => v + ((beta[n - 1] as number[])[k] as number));
  let cur = total.indexOf(Math.max(...total));
  const path = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    path[i] = cur;
    cur = (back[i] as number[])[cur] as number;
  }

  const choices = windows.map((w, i) => {
    const constrained = cands.map((cd, k) => ({ k, s: ((delta[i] as number[])[k] as number) + ((beta[i] as number[])[k] as number), cd }));
    constrained.sort((a, b) => b.s - a.s);
    const chosen = constrained.find((x) => x.k === path[i]) as (typeof constrained)[number];
    // 替代：先挑不同根音，不夠再補同根音的其他色彩
    const picked = [chosen];
    for (const x of constrained) {
      if (picked.length >= alternatives) break;
      if (!picked.includes(x) && !picked.some((p) => p.cd.rootPc === x.cd.rootPc)) picked.push(x);
    }
    for (const x of constrained) {
      if (picked.length >= alternatives) break;
      if (!picked.includes(x)) picked.push(x);
    }
    return picked.map(({ cd, s }): ChordChoice => {
      const ref: ChordRef = { rootPc: cd.rootPc, qualityId: cd.qualityId, bassPc: cd.bassPc };
      const info = classifyChord(ref, key.tonic, key.mode);
      return { ...ref, roman: info.roman, tag: info.tag, function: info.function, fit: windowFit(w, cd, scale), score: s };
    });
  });
  return { windows: [...windows], choices };
}

/** 為一串和弦配上吉他指法，前後和弦的聲部移動盡量小；第一個和弦選在中段把位。 */
export function voiceChords(chords: readonly ChordRef[]): Fret[][] {
  const out: Fret[][] = [];
  let prev: Fret[] | undefined;
  for (const ch of chords) {
    const q = quality(ch.qualityId);
    const v = generateVoicings(ch.rootPc, q, { prev, bassPc: ch.rootPc, limit: 1 })[0] ?? generateVoicings(ch.rootPc, q, { prev, limit: 1 })[0];
    const frets: Fret[] = v?.frets ?? [null, null, null, null, null, null];
    out.push(frets);
    prev = frets;
  }
  return out;
}
