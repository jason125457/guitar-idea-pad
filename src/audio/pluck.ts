/**
 * 和弦試聽：優先用取樣吉他（見 sound.ts）；取樣還沒載入、載入失敗，或使用者選了「合成音色」時，
 * 退回零下載的 Karplus-Strong 撥弦合成。
 */

import { getContext as context } from './context';
import { STRUM_GAP_SEC, activePlayer, strumVelocity } from './sound';

const buffers = new Map<number, AudioBuffer>();
let active: AudioBufferSourceNode[] = [];

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
}

export interface TimedChord {
  midis: number[];
  startSec: number;
  durSec: number;
}

/** 把和弦排進 AudioContext 時間軸（t0 起算），每個和弦由低到高輕刷；不會先停掉正在播的聲音。 */
export function scheduleChords(c: AudioContext, t0: number, chords: readonly TimedChord[], level = 1): void {
  const player = activePlayer();
  if (player) {
    for (const ch of chords) {
      [...ch.midis]
        .sort((a, b) => a - b)
        .forEach((m, ni) => {
          // time 是 AudioContext 的絕對時間；多留 0.5 秒讓琴弦自然收尾
          player.start({ note: m, time: t0 + ch.startSec + ni * STRUM_GAP_SEC, duration: ch.durSec + 0.5, velocity: strumVelocity(ni, level) });
        });
    }
    return;
  }
  for (const ch of chords) {
    [...ch.midis]
      .sort((a, b) => a - b)
      .forEach((m, ni) => {
        const src = c.createBufferSource();
        src.buffer = pluck(c, m);
        const gain = c.createGain();
        const start = t0 + ch.startSec + ni * 0.028;
        gain.gain.setValueAtTime(level, start);
        gain.gain.setTargetAtTime(0, start + Math.max(0.2, ch.durSec - 0.15), 0.08);
        src.connect(gain).connect(c.destination);
        src.start(start);
        src.stop(start + ch.durSec + 0.4);
        active.push(src);
      });
  }
}

/** 依序播放多個和弦；每個和弦由低到高輕刷。回傳總時長（秒）。 */
export function playChords(chords: number[][], secondsPerChord = 1.3): number {
  stopAll();
  const c = context();
  scheduleChords(c, c.currentTime + 0.05, chords.map((midis, i) => ({ midis, startSec: i * secondsPerChord, durSec: secondsPerChord })));
  return chords.length * secondsPerChord;
}
