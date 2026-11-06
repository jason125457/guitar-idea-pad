/**
 * 試聽音色：取樣吉他（鋼弦／尼龍弦／乾淨電吉他，FluidR3_GM，CC BY 3.0）或內建合成音色。
 * 取樣檔放在 public/samples，與網站同源，所以可以被 service worker 快取而離線使用。
 * 取樣尚未載入完成（或載入失敗）時，播放會自動退回合成音色，不會沒聲音。
 */
import type { Soundfont } from 'smplr';
import { getContext } from './context';

export type Timbre = 'steel' | 'nylon' | 'electric' | 'synth';
export type SampleTimbre = Exclude<Timbre, 'synth'>;

export const TIMBRES: { id: Timbre; name: string; hint: string }[] = [
  { id: 'steel', name: '鋼弦吉他', hint: '明亮，適合刷弦' },
  { id: 'nylon', name: '尼龍弦吉他', hint: '溫暖柔和，適合指彈' },
  { id: 'electric', name: '電吉他（Clean）', hint: '乾淨清亮，適合聽高把位的色彩和弦' },  { id: 'synth', name: '合成音色', hint: '免下載，音色較簡單' },
];

const FILE: Record<SampleTimbre, string> = {
  steel: 'acoustic_guitar_steel',
  nylon: 'acoustic_guitar_nylon',
  electric: 'electric_guitar_clean',
};

/** 這個音色用哪一個取樣檔；合成音色不用。 */
export function sampleOf(t: Timbre): SampleTimbre | undefined {
  if (t === 'synth') return undefined;
  return t;
}

const TIMBRE_IDS = new Set<string>(['steel', 'nylon', 'electric', 'synth']);

export const SAMPLE_TIMBRES = Object.keys(FILE) as SampleTimbre[];

export function sampleUrl(t: SampleTimbre, base: string = import.meta.env.BASE_URL): string {
  return `${base}samples/FluidR3_GM/${FILE[t]}-mp3.js`;
}

/**
 * 只解碼吉他音域內、每隔 3 個半音的取樣（E2..E6，共 17 個），其餘音由最近的取樣變調補上（最多差 1 個半音，聽不太出來）。
 * 原始檔有 88 個音（A0..C8），全部解碼一種音色約 100 MB，手機容易吃不消；這樣約剩 1/5。
 */
export const GUITAR_LOW = 40; // E2：標準調弦六弦空弦
export const GUITAR_HIGH = 88; // E6：一弦第 24 品
export const SAMPLE_STEP = 3;
export const SAMPLE_NOTES: number[] = Array.from(
  { length: Math.floor((GUITAR_HIGH - GUITAR_LOW) / SAMPLE_STEP) + 1 },
  (_, i) => GUITAR_LOW + i * SAMPLE_STEP,
);

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
    if (v && TIMBRE_IDS.has(v)) return v as Timbre;
  } catch {
    /* 忽略 */
  }
  return 'steel';
}

const idle = (): SampleLoad => ({ status: 'idle', loaded: 0, total: 0 });

let state: SoundState = { timbre: readTimbre(), samples: { steel: idle(), nylon: idle(), electric: idle() } };
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
  const s = sampleOf(state.timbre);
  return s ? players.get(s) : undefined;
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
        notesToLoad: { notes: SAMPLE_NOTES, fallback: 'nearest' },
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
  const s = sampleOf(t);
  if (s) void loadSamples(s);
}

/** 在瀏覽器空檔預先載入目前選用的音色，第一次按播放時通常已經就緒。 */
export function preloadSelected(): void {
  const t = sampleOf(state.timbre);
  if (!t) return;
  const run = () => void loadSamples(t);
  // Safari 沒有 requestIdleCallback
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 4000 });
  else window.setTimeout(run, 1500);
}
