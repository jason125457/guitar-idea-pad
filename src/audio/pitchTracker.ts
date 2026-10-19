import type { PitchFrame } from '../core';
import type { PitchMessage } from './pitch.worklet';
import workletUrl from './pitch.worklet.ts?worker&url';

export class TrackerError extends Error {
  constructor(
    readonly code: 'insecure' | 'unsupported' | 'denied' | 'no-device' | 'busy' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

export type TrackerSource = 'mic' | 'demo';

export interface TrackerInfo {
  sampleRate: number;
  /** 取樣窗口造成的延遲 + 瀏覽器回報的輸入延遲（毫秒，粗估） */
  latencyMs: number;
}

/** 內建測試旋律：用振盪器直接餵給偵測器，不需要麥克風，用來驗證整條處理鏈。 */
export const DEMO_MELODY: { midi: number; dur: number; vibrato?: number }[] = [
  { midi: 57, dur: 0.5 }, // A3
  { midi: 59, dur: 0.5 }, // B3
  { midi: 62, dur: 0.7, vibrato: 0.35 }, // D4，帶顫音
  { midi: 64, dur: 0.5 }, // E4
  { midi: 67, dur: 0.6 }, // G4
];
const DEMO_GAP = 0.09;

/** 一次錄音／偵測的工作階段：開麥克風（或測試訊號）→ worklet → 音高幀。 */
export class PitchTracker {
  frames: PitchFrame[] = [];
  info: TrackerInfo | undefined;
  onFrame: ((f: PitchFrame) => void) | undefined;
  onEnded: (() => void) | undefined;

  private ctx: AudioContext | undefined;
  private node: AudioWorkletNode | undefined;
  private stream: MediaStream | undefined;
  private stopTimer: number | undefined;
  private starting = false;

  get running(): boolean {
    return !!this.ctx;
  }

  async start(source: TrackerSource): Promise<void> {
    if (this.ctx || this.starting) throw new TrackerError('busy', '已經在錄音了');
    if (typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
      throw new TrackerError('unsupported', '這個瀏覽器不支援 AudioWorklet，無法做即時音高偵測');
    }
    if (source === 'mic' && (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)) {
      throw new TrackerError('insecure', '麥克風只能在 HTTPS 或 localhost 網址使用');
    }
    this.starting = true;
    this.frames = [];
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      await ctx.resume();
      await ctx.audioWorklet.addModule(workletUrl);

      const node = new AudioWorkletNode(ctx, 'pitch-processor', { numberOfInputs: 1, numberOfOutputs: 0 });
      node.port.onmessage = (e: MessageEvent<PitchMessage>) => {
        if (e.data.type !== 'frame') return;
        const f: PitchFrame = { t: e.data.t, hz: e.data.hz, clarity: e.data.clarity, rms: e.data.rms };
        this.frames.push(f);
        this.onFrame?.(f);
      };
      this.node = node;

      if (source === 'mic') {
        // 關掉瀏覽器的人聲處理：回音消除／降噪／自動增益都會改變音高與音量，造成誤判
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        });
        ctx.createMediaStreamSource(this.stream).connect(node);
      } else {
        this.stopTimer = window.setTimeout(() => this.finish(), this.startDemo(ctx, node) * 1000 + 400);
      }

      const windowMs = (2048 / ctx.sampleRate) * 1000;
      this.info = {
        sampleRate: ctx.sampleRate,
        latencyMs: Math.round(windowMs / 2 + (ctx.baseLatency || 0) * 1000),
      };
    } catch (e) {
      this.release();
      throw toTrackerError(e);
    } finally {
      this.starting = false;
    }
  }

  /** 停止並回傳這次收到的所有幀。 */
  stop(): PitchFrame[] {
    window.clearTimeout(this.stopTimer);
    this.release();
    return this.frames;
  }

  private finish(): void {
    this.release();
    this.onEnded?.();
  }

  private release(): void {
    window.clearTimeout(this.stopTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.port.close();
    this.node?.disconnect();
    void this.ctx?.close();
    this.stream = undefined;
    this.node = undefined;
    this.ctx = undefined;
  }

  /** 排程測試旋律，回傳總長（秒）。振盪器只接到偵測器，不會發出聲音。 */
  private startDemo(ctx: AudioContext, node: AudioWorkletNode): number {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const gate = ctx.createGain();
    gate.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6;
    const depth = ctx.createGain();
    depth.gain.value = 0;
    lfo.connect(depth).connect(osc.frequency);
    osc.connect(gate).connect(node);

    let t = ctx.currentTime + 0.3;
    for (const n of DEMO_MELODY) {
      const hz = 440 * 2 ** ((n.midi - 69) / 12);
      osc.frequency.setValueAtTime(hz, t);
      depth.gain.setValueAtTime(n.vibrato ? hz * (2 ** (n.vibrato / 12) - 1) : 0, t);
      gate.gain.setValueAtTime(0.3, t);
      gate.gain.setValueAtTime(0, t + n.dur);
      t += n.dur + DEMO_GAP;
    }
    osc.start();
    lfo.start();
    return t - ctx.currentTime;
  }
}

function toTrackerError(e: unknown): TrackerError {
  if (e instanceof TrackerError) return e;
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new TrackerError('denied', '麥克風權限被拒絕。請在網址列旁的網站設定裡允許麥克風後再試一次');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new TrackerError('no-device', '找不到可用的麥克風');
  }
  if (name === 'NotReadableError') {
    return new TrackerError('failed', '麥克風被其他程式佔用了，關掉它再試一次');
  }
  return new TrackerError('failed', e instanceof Error ? `音訊初始化失敗：${e.message}` : '音訊初始化失敗');
}
