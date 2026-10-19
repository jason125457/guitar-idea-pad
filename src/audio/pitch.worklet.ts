/**
 * AudioWorklet：在音訊執行緒內做音高偵測（McLeod Pitch Method，pitchy），
 * 每 HOP 個取樣回報一次 { t, hz, clarity, rms }，主執行緒只負責顯示與切音。
 *
 * 窗口 2048 取樣（48kHz 約 43ms）能穩定偵測到約 50Hz 以上；hop 512 約每 11ms 一幀。
 */
import { PitchDetector } from 'pitchy';

// AudioWorkletGlobalScope 的型別不在 DOM lib 裡，這裡只宣告用到的部分
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const WINDOW = 2048;
const HOP = 512;
/** 低於這個音量直接當作無聲，不浪費運算也避免底噪被誤判成音高 */
const SILENCE_RMS = 0.004;

export interface PitchMessage {
  type: 'frame';
  t: number;
  hz: number;
  clarity: number;
  rms: number;
}

class PitchProcessor extends AudioWorkletProcessor {
  private readonly ring = new Float32Array(WINDOW);
  private readonly ordered = new Float32Array(WINDOW);
  private readonly detector = PitchDetector.forFloat32Array(WINDOW);
  private write = 0;
  private total = 0;
  private sinceHop = 0;

  constructor() {
    super();
    this.detector.minVolumeAbsolute = SILENCE_RMS;
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.ring[this.write] = channel[i] as number;
      this.write = (this.write + 1) % WINDOW;
      this.total++;
      this.sinceHop++;
      if (this.total >= WINDOW && this.sinceHop >= HOP) {
        this.sinceHop = 0;
        this.analyze();
      }
    }
    return true;
  }

  private analyze(): void {
    // 依時間順序整理成連續陣列（write 指向最舊的取樣）
    const tail = WINDOW - this.write;
    this.ordered.set(this.ring.subarray(this.write), 0);
    this.ordered.set(this.ring.subarray(0, this.write), tail);

    let sum = 0;
    for (let i = 0; i < WINDOW; i++) sum += (this.ordered[i] as number) ** 2;
    const rms = Math.sqrt(sum / WINDOW);

    let hz = 0;
    let clarity = 0;
    if (rms >= SILENCE_RMS) [hz, clarity] = this.detector.findPitch(this.ordered, sampleRate);

    const msg: PitchMessage = {
      type: 'frame',
      t: (this.total - WINDOW / 2) / sampleRate,
      hz,
      clarity,
      rms,
    };
    this.port.postMessage(msg);
  }
}

registerProcessor('pitch-processor', PitchProcessor);
