/**
 * 試聽音色：取樣吉他（鋼弦／尼龍弦，FluidR3_GM，CC BY 3.0）或內建合成音色。
 * 取樣檔放在 public/samples，與網站同源，所以可以被 service worker 快取而離線使用。
 * 取樣尚未載入完成（或載入失敗）時，播放會自動退回合成音色，不會沒聲音。
 */
import type { Soundfont } from 'smplr';
import { getContext } from './context';

export type Timbre = 'steel' | 'nylon' | 'synth';
export type SampleTimbre = Exclude<Timbre, 'synth'>;

export const TIMBRES: { id: Timbre; name: string; hint: string }[] = [
  { id: 'steel', name: '鋼弦吉他', hint: '明亮，適合刷弦' },
  { id: 'nylon', name: '尼龍弦吉他', hint: '溫暖柔和，適合指彈' },
  { id: 'synth', name: '合成音色', hint: '免下載，音色較簡單' },
];

const FILE: Record<SampleTimbre, string> = {
  steel: 'acoustic_guitar_steel',
  nylon: 'acoustic_guitar_nylon',
};

export const SAMPLE_TIMBRES = Object.keys(FILE) as SampleTimbre[];

export function sampleUrl(t: SampleTimbre, base: string = import.meta.env.BASE_URL): string {
  return `${base}samples/FluidR3_GM/${FILE[t]}-mp3.js`;
}

/** 刷弦時每條弦間隔（秒）。 */
export const STRUM_GAP_SEC = 0.03;

/**
 * 刷弦力度：由低音弦往高音弦逐漸變輕，整體再乘上 level（0–1）。
 * 回傳 MIDI 力度 1–127。
 */
export function strumVelocity(stringIndex: number, level = 1): number {
  const base = 92 - stringIndex * 3;
  return Math.max(1, Math.min(127, Math.round(base * level)));
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SampleLoad {
  status: LoadStatus;
  loaded: number;
  total: number;
  error?: string;
}

export interface SoundState {
  timbre: Timbre;
  samples: Record<SampleTimbre, SampleLoad>;
}

const TIMBRE_KEY = 'guitar-idea-pad.timbre';

function readTimbre(): Timbre {
  try {
    const v = localStorage.getItem(TIMBRE_KEY);
    if (v === 'steel' || v === 'nylon' || v === 'synth') return v;
  } catch {
    /* 忽略 */
  }
  return 'steel';
}

const idle = (): SampleLoad => ({ status: 'idle', loaded: 0, total: 0 });

let state: SoundState = { timbre: readTimbre(), samples: { steel: idle(), nylon: idle() } };
const listeners = new Set<() => void>();
const players = new Map<SampleTimbre, Soundfont>();
const pending = new Map<SampleTimbre, Promise<void>>();

function set(next: SoundState): void {
  state = next;
  listeners.forEach((l) => l());
}

const patch = (t: SampleTimbre, p: Partial<SampleLoad>): void =>
  set({ ...state, samples: { ...state.samples, [t]: { ...state.samples[t], ...p } } });

export const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getSoundState = (): SoundState => state;

/** 目前選用的取樣音色已載入時回傳播放器；否則 undefined（呼叫端退回合成音色）。 */
export function activePlayer(): Soundfont | undefined {
  return state.timbre === 'synth' ? undefined : players.get(state.timbre);
}

/** 載入（或重試）一種取樣音色；同時多次呼叫只會載入一次。 */
export function loadSamples(t: SampleTimbre): Promise<void> {
  if (players.has(t)) return Promise.resolve();
  const inflight = pending.get(t);
  if (inflight) return inflight;
  patch(t, { status: 'loading', loaded: 0, total: 0, error: undefined });
  const job = (async () => {
    try {
      const { Soundfont: create } = await import('smplr'); // 動態載入，沒用到取樣時不增加首頁大小
      const player = create(getContext(), {
        instrumentUrl: sampleUrl(t),
        loadLoopData: false,
        onLoadProgress: ({ loaded, total }) => patch(t, { loaded, total }),
      });
      await player.ready;
      players.set(t, player);
      patch(t, { status: 'ready' });
    } catch (e) {
      patch(t, { status: 'error', error: e instanceof Error ? e.message : '載入失敗' });
    } finally {
      pending.delete(t);
    }
  })();
  pending.set(t, job);
  return job;
}

export function setTimbre(t: Timbre): void {
  try {
    localStorage.setItem(TIMBRE_KEY, t);
  } catch {
    /* 忽略 */
  }
  set({ ...state, timbre: t });
  if (t !== 'synth') void loadSamples(t);
}

/** 在瀏覽器空檔預先載入目前選用的音色，第一次按播放時通常已經就緒。 */
export function preloadSelected(): void {
  if (state.timbre === 'synth') return;
  const t = state.timbre;
  const run = () => void loadSamples(t);
  // Safari 沒有 requestIdleCallback
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 4000 });
  else window.setTimeout(run, 1500);
}
