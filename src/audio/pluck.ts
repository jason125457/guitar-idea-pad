/**
 * 和弦試聽：優先用取樣吉他（見 sound.ts）；取樣還沒載入、載入失敗，或使用者選了「合成音色」時，
 * 退回零下載的 Karplus-Strong 撥弦合成。
 */

import { getContext as context } from './context';
import { STRUM_GAP_SEC, activePlayer, strumVelocity } from './sound';

const buffers = new Map<number, AudioBuffer>();
let active: AudioBufferSourceNode[] = [];
const stopListeners = new Set<() => void>();

/** 任何地方呼叫 stopAll（包含開始播別的東西）時通知，讓播放游標知道要停。回傳取消訂閱。 */
export function onStopAll(fn: () => void): () => void {
  stopListeners.add(fn);
  return () => stopListeners.delete(fn);
}

function pluck(c: AudioContext, midi: number): AudioBuffer {
  const cached = buffers.get(midi);
  if (cached) return cached;
  const sr = c.sampleRate;
  const freq = 440 * 2 ** ((midi - 69) / 12);
  const period = Math.max(2, Math.round(sr / freq));
  const buf = c.createBuffer(1, Math.floor(sr * 2.4), sr);
  const data = buf.getChannelData(0);
  const ring = new Float32Array(period);
  let prev = 0;
  for (let i = 0; i < period; i++) {
    prev = prev * 0.5 + (Math.random() * 2 - 1) * 0.5; // 預先低通，音色較暖
    ring[i] = prev;
  }
  const decay = 0.9965 - Math.min(0.003, freq / 400000);
  let idx = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] = (ring[idx] as number) * 0.35;
    const next = (((ring[idx] as number) + (ring[(idx + 1) % period] as number)) / 2) * decay;
    ring[idx] = next;
    idx = (idx + 1) % period;
  }
  buffers.set(midi, buf);
  return buf;
}

export function stopAll(): void {
  for (const s of active) {
    try {
      s.stop();
    } catch {
      /* 已結束 */
    }
  }
  active = [];
  activePlayer()?.stop();
  for (const fn of [...stopListeners]) fn();
}

export interface TimedChord {
  midis: number[];
  startSec: number;
  durSec: number;
  /** 這一下的力度倍率（預設 1），用來做重拍 */
  level?: number;
  /** 刷的方向：down 從低音弦先響（預設），up 從高音弦先響 */
  dir?: 'down' | 'up';
  /** 放開後琴弦再響多久（秒，預設 0.5）；悶音用很短的值 */
  ring?: number;
}

/**
 * 每個和弦刷 beats 下、每拍一下，第一拍最重，其餘稍輕，聽起來像在跟著拍子刷，
 * 而不是一個和弦撥一次就放著響。
 */
export function strumBeats(chords: readonly { midis: number[]; beats: number }[], beatSec: number): TimedChord[] {
  let beat = 0;
  return chords.flatMap(({ midis, beats }) => {
    const start = beat;
    beat += beats;
    return Array.from({ length: beats }, (_, b) => ({
      midis,
      startSec: (start + b) * beatSec,
      durSec: beatSec,
      level: b === 0 ? 1 : 0.72,
    }));
  });
}

/** 把和弦排進 AudioContext 時間軸（t0 起算），每個和弦由低到高輕刷；不會先停掉正在播的聲音。 */
export function scheduleChords(c: AudioContext, t0: number, chords: readonly TimedChord[], level = 1): void {
  const player = activePlayer();
  if (player) {
    for (const ch of chords) {
      const notes = [...ch.midis].sort((a, b) => a - b);
      notes.forEach((m, ni) => {
        // 往上刷時高音弦先響；力度仍依弦的位置（低音弦較重）
        const order = ch.dir === 'up' ? notes.length - 1 - ni : ni;
        // time 是 AudioContext 的絕對時間；多留一點讓琴弦自然收尾
        player.start({
          note: m,
          time: t0 + ch.startSec + order * STRUM_GAP_SEC,
          duration: ch.durSec + (ch.ring ?? 0.5),
          velocity: strumVelocity(ni, level * (ch.level ?? 1)),
        });
      });
    }
    return;
  }
  for (const ch of chords) {
    const notes = [...ch.midis].sort((a, b) => a - b);
    const ring = ch.ring ?? 0.5;
    notes.forEach((m, ni) => {
      const order = ch.dir === 'up' ? notes.length - 1 - ni : ni;
      const src = c.createBufferSource();
      src.buffer = pluck(c, m);
      const gain = c.createGain();
      const start = t0 + ch.startSec + order * 0.028;
      gain.gain.setValueAtTime(level * (ch.level ?? 1), start);
      gain.gain.setTargetAtTime(0, start + Math.max(ring < 0.2 ? 0.04 : 0.2, ch.durSec - 0.15), ring < 0.2 ? 0.02 : 0.08);
      src.connect(gain).connect(c.destination);
      src.start(start);
      src.stop(start + ch.durSec + Math.max(0.1, ring - 0.1));
      active.push(src);
    });
  }
}

/** 依各和弦自己的開始時間與長度播放（速度與拍數由呼叫端換算成秒）。回傳總時長（秒）。 */
export function playTimedChords(chords: readonly TimedChord[]): number {
  stopAll();
  const c = context();
  scheduleChords(c, c.currentTime + 0.05, chords);
  return chords.reduce((end, ch) => Math.max(end, ch.startSec + ch.durSec), 0);
}

/** 依序播放多個和弦；每個和弦由低到高輕刷。回傳總時長（秒）。 */
export function playChords(chords: number[][], secondsPerChord = 1.3): number {
  stopAll();
  const c = context();
  scheduleChords(c, c.currentTime + 0.05, chords.map((midis, i) => ({ midis, startSec: i * secondsPerChord, durSec: secondsPerChord })));
  return chords.length * secondsPerChord;
}
