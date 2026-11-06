/** 把偵測到的旋律用簡單音色播回來，讓使用者用耳朵確認有沒有抓對。 */
import { getContext } from './context';

let active: OscillatorNode[] = [];

export interface PlayableNote {
  midi: number;
  startSec: number;
  durSec: number;
}

export function stopTones(): void {
  for (const o of active) {
    try {
      o.stop();
    } catch {
      /* 已結束 */
    }
  }
  active = [];
}

/** 把旋律排進時間軸（t0 起算，第一個音的 startSec 對應 t0）；回傳結束時間（相對 t0）。 */
export function scheduleNotes(c: AudioContext, t0: number, notes: readonly PlayableNote[], level = 0.25): number {
  if (notes.length === 0) return 0;
  const origin = (notes[0] as PlayableNote).startSec;
  let end = 0;
  for (const n of notes) {
    const start = t0 + (n.startSec - origin);
    const dur = Math.max(0.08, n.durSec);
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 440 * 2 ** ((n.midi - 69) / 12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(level, start + 0.02);
    g.gain.setValueAtTime(level, start + dur - 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
    active.push(osc);
    end = Math.max(end, start + dur - t0);
  }
  return end;
}

/** 依原本的節奏播放；回傳總長（秒）。 */
export function playNotes(notes: readonly PlayableNote[]): number {
  stopTones();
  const c = getContext();
  return scheduleNotes(c, c.currentTime + 0.08, notes);
}

/** 把旋律排在絕對時間上：startSec 是相對 t0 的秒數（不像 scheduleNotes 會把第一個音對齊 t0）。 */
export function scheduleMelody(c: AudioContext, t0: number, notes: readonly PlayableNote[], level = 0.18): void {
  for (const n of notes) {
    const start = t0 + n.startSec;
    if (start < c.currentTime) continue;
    const dur = Math.max(0.08, n.durSec - 0.03);
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 440 * 2 ** ((n.midi - 69) / 12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(level, start + 0.02);
    g.gain.setValueAtTime(level, start + dur - 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
    active.push(osc);
  }
}

/** 節拍器的「滴」：第一下（accent）高一點。times 是 AudioContext 的絕對時間。 */
export function scheduleClicks(c: AudioContext, times: readonly number[], accentFirst = true): void {
  times.forEach((t, i) => {
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.value = accentFirst && i % 4 === 0 ? 1760 : 1320;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.08);
    active.push(osc);
  });
}
