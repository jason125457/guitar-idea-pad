/**
 * 哼唱音高軌跡 → 旋律音符。純函式，不碰音訊 API，所以可以用合成資料測試。
 *
 * 流程：過濾無效幀 → 中值濾波（去掉八度跳動等單點雜訊）→ 依音高穩定度切音 → 取每個音的中位數吸附到半音。
 * 重點取捨：人聲有顫音與滑音，所以「一個音」的音高取穩定段的中位數，而不是逐幀四捨五入。
 */
import { mod12, type Speller, midiName } from './pitch';

export interface PitchFrame {
  /** 該幀分析窗口中心的時間（秒） */
  t: number;
  hz: number;
  /** 0–1，音高偵測器對結果的把握（pitchy 的 clarity） */
  clarity: number;
  /** 音量 RMS，0–1 */
  rms: number;
}

export interface DetectedNote {
  startSec: number;
  durSec: number;
  /** 吸附後的 MIDI 音高 */
  midi: number;
  /** 實際音高偏離吸附音的音分（−50..50），正值代表偏高 */
  cents: number;
  /** 0–1，該音所有幀 clarity 的平均 */
  confidence: number;
}

export interface SegmentOptions {
  minClarity: number;
  minRms: number;
  minHz: number;
  maxHz: number;
  /** 中值濾波視窗（幀數，奇數） */
  medianWindow: number;
  /** 同一個音內允許的無聲空檔（秒），小於它視為同一音 */
  maxGapSec: number;
  /** 偏離目前音多少半音以上才開始考慮換音 */
  splitSemitones: number;
  /** 偏離需要連續幾幀才確認換音（避免單點雜訊） */
  splitFrames: number;
  /** 短於此秒數的音會被丟掉 */
  minNoteSec: number;
  /** 同音高相鄰、間隔小於此秒數的音會合併（顫音造成的誤切） */
  mergeGapSec: number;
  /** 給定調內音級（pitch class 0–11）時，把音吸附到最近的調內音 */
  scalePcs?: readonly number[];
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  minClarity: 0.9,
  minRms: 0.01,
  minHz: 70,
  maxHz: 1100,
  medianWindow: 5,
  maxGapSec: 0.12,
  splitSemitones: 0.65,
  splitFrames: 3,
  minNoteSec: 0.09,
  mergeGapSec: 0.08,
};

export const hzToMidiFloat = (hz: number): number => 12 * Math.log2(hz / 440) + 69;

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** 在 midi 附近（±1 半音）挑最接近 float 音高、且屬於調內的音；找不到就維持原本四捨五入。 */
export function snapToScale(midiFloat: number, scalePcs: readonly number[]): number {
  const base = Math.round(midiFloat);
  let best = base;
  let bestDist = Infinity;
  for (const c of [base - 1, base, base + 1]) {
    if (!scalePcs.includes(mod12(c))) continue;
    const d = Math.abs(midiFloat - c);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return bestDist === Infinity ? base : best;
}

interface Voiced {
  t: number;
  s: number; // 中值濾波後的音高（浮點 MIDI）
  clarity: number;
}

export function segmentNotes(frames: readonly PitchFrame[], options: Partial<SegmentOptions> = {}): DetectedNote[] {
  const o = { ...DEFAULT_SEGMENT_OPTIONS, ...options };
  if (frames.length === 0) return [];

  // 幀間隔（取中位數，容忍偶爾掉幀）
  const dts: number[] = [];
  for (let i = 1; i < frames.length; i++) dts.push((frames[i] as PitchFrame).t - (frames[i - 1] as PitchFrame).t);
  const hop = dts.length ? Math.max(0.001, median(dts)) : 0.012;

  // 1) 有效幀 → 浮點 MIDI
  const raw = frames.map((f) =>
    f.clarity >= o.minClarity && f.rms >= o.minRms && f.hz >= o.minHz && f.hz <= o.maxHz ? hzToMidiFloat(f.hz) : NaN,
  );

  // 2) 中值濾波：只拿視窗內的有效幀，單點八度跳動會被多數票蓋掉
  const half = Math.floor(o.medianWindow / 2);
  const voiced: Voiced[] = [];
  raw.forEach((v, i) => {
    if (Number.isNaN(v)) return;
    const around: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(raw.length - 1, i + half); j++) {
      const w = raw[j] as number;
      if (!Number.isNaN(w)) around.push(w);
    }
    const f = frames[i] as PitchFrame;
    voiced.push({ t: f.t, s: median(around), clarity: f.clarity });
  });

  // 3) 切音：音高穩定就累積；連續幾幀偏離同一個新音高才換音；有效幀之間隔太久就斷開
  const groups: Voiced[][] = [];
  let cur: Voiced[] = [];
  let pending: Voiced[] = [];
  const center = () => median(cur.slice(-15).map((v) => v.s));
  const close = () => {
    if (cur.length) groups.push(cur);
    cur = [];
    pending = [];
  };
  for (const v of voiced) {
    const last = cur[cur.length - 1];
    if (last && v.t - last.t > o.maxGapSec) close();
    if (cur.length === 0) {
      cur.push(v);
      continue;
    }
    if (Math.abs(v.s - center()) <= o.splitSemitones) {
      cur.push(...pending); // 先前偏離的幀其實只是擺動，歸還給目前的音
      pending = [];
      cur.push(v);
      continue;
    }
    const consistent = pending.every((p) => Math.abs(p.s - v.s) <= 0.5);
    if (!consistent) pending = [];
    pending.push(v);
    if (pending.length >= o.splitFrames) {
      const next = pending;
      groups.push(cur);
      cur = next;
      pending = [];
    }
  }
  close();

  // 4) 每組 → 一個音
  let notes: DetectedNote[] = groups
    .map((g) => {
      const pitch = median(g.map((v) => v.s));
      const midi = o.scalePcs ? snapToScale(pitch, o.scalePcs) : Math.round(pitch);
      const first = g[0] as Voiced;
      const last = g[g.length - 1] as Voiced;
      return {
        startSec: first.t - hop / 2,
        durSec: last.t - first.t + hop,
        midi,
        cents: Math.round((pitch - midi) * 100),
        confidence: g.reduce((s, v) => s + v.clarity, 0) / g.length,
      };
    })
    .filter((n) => n.durSec >= o.minNoteSec);

  // 5) 合併：同音高、空檔很短（顫音或偵測抖動造成的誤切）
  notes = notes.reduce<DetectedNote[]>((acc, n) => {
    const prev = acc[acc.length - 1];
    if (prev && prev.midi === n.midi && n.startSec - (prev.startSec + prev.durSec) < o.mergeGapSec) {
      const end = n.startSec + n.durSec;
      const w1 = prev.durSec;
      const w2 = n.durSec;
      prev.cents = Math.round((prev.cents * w1 + n.cents * w2) / (w1 + w2));
      prev.confidence = (prev.confidence * w1 + n.confidence * w2) / (w1 + w2);
      prev.durSec = end - prev.startSec;
      return acc;
    }
    acc.push({ ...n });
    return acc;
  }, []);

  return notes;
}

export function notesToMelodyText(notes: readonly Pick<DetectedNote, 'midi'>[], speller?: Speller): string {
  return notes.map((n) => midiName(n.midi, speller)).join(' ');
}
