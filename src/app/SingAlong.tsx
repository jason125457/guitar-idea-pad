import { useEffect, useRef, useState } from 'react';
import { getContext } from '../audio/context';
import { onStopAll } from '../audio/pluck';
import { PitchTracker, TrackerError } from '../audio/pitchTracker';
import {
  hzToMidiFloat,
  midiName,
  quantizeMelody,
  scalePcsForKey,
  segmentNotes,
  type BeatNote,
  type KeyGuess,
  type Speller,
} from '../core';

const COUNT_IN = 4;
const QUIET_RMS = 0.01;

interface Props {
  /** 這段有沒有和弦可以跟著唱 */
  ready: boolean;
  sectionName: string;
  beatSec: number;
  totalBeats: number;
  keyInfo: Pick<KeyGuess, 'tonic' | 'mode'> | undefined;
  speller: Speller;
  hasMelody: boolean;
  /** 從頭播這段（先數 COUNT_IN 拍），回傳第 0 拍的音訊時間與長度 */
  start: (opts: { clickOnly: boolean; countInBeats: number }) => { t0: number; total: number } | undefined;
  stop: () => void;
  onDone: (notes: BeatNote[]) => void;
  onClear: () => void;
  withMelody: boolean;
  onWithMelody: (on: boolean) => void;
}

type Phase = 'idle' | 'starting' | 'recording';

/**
 * 跟著和弦唱旋律：先數四拍，接著從頭播這段，你跟著唱；唱完自動停，
 * 錄到的音直接對齊到這段的拍點上（不用另外估速度）。
 */
export function SingAlong(p: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [clickOnly, setClickOnly] = useState(false);
  const [snap, setSnap] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [live, setLive] = useState({ note: '', level: 0, count: 0 });
  const rec = useRef<{ tr: PitchTracker; offset: number; t0: number; timer: number; off: () => void } | null>(null);
  const liveRef = useRef({ hz: 0, clarity: 0, rms: 0 });

  const finish = () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    window.clearTimeout(r.timer);
    r.off();
    const frames = r.tr.stop();
    p.stop();
    setPhase('idle');
    const ctx = getContext();
    // 你是聽到喇叭的聲音才唱：扣掉輸出延遲，再扣一點收音處理的延遲
    const latency = (ctx.outputLatency || ctx.baseLatency || 0) + 0.03;
    const scalePcs = snap && p.keyInfo ? scalePcsForKey(p.keyInfo) : undefined;
    const detected = segmentNotes(frames, { scalePcs });
    const notes = detected.map((n) => ({ midi: n.midi, startSec: n.startSec + r.offset - latency - r.t0, durSec: n.durSec }));
    const grid = quantizeMelody(notes, p.beatSec, p.totalBeats);
    if (!grid.length) {
      setError('沒有抓到旋律。靠近麥克風、用「啦」或「嗚」唱大聲一點，每個音拉長一點再試一次。');
      return;
    }
    setMessage(`錄到 ${grid.length} 個音，已經放到和弦上面了`);
    p.onDone(grid);
  };

  const begin = async () => {
    setError('');
    setMessage('');
    setPhase('starting');
    const tr = new PitchTracker();
    tr.onFrame = (f) => {
      liveRef.current = { hz: f.hz, clarity: f.clarity, rms: f.rms };
    };
    try {
      await tr.start('mic');
    } catch (e) {
      setPhase('idle');
      setError(e instanceof TrackerError ? e.message : '無法開始錄音');
      return;
    }
    const res = p.start({ clickOnly, countInBeats: COUNT_IN });
    if (!res) {
      tr.stop();
      setPhase('idle');
      return;
    }
    const ctx = getContext();
    // 兩個 AudioContext 的時鐘在同一個瞬間各讀一次，之後就能把錄到的時間換算成播放的時間
    const offset = ctx.currentTime - tr.now();
    const timer = window.setTimeout(finish, (res.t0 - ctx.currentTime + res.total + 0.4) * 1000);
    // 播放被別的地方停掉（按了停止、播了別的）就結束錄音
    const off = onStopAll(() => finish());
    rec.current = { tr, offset, t0: res.t0, timer, off };
    setPhase('recording');
  };

  // 錄音中定時更新：數拍、目前唱到的音、音量
  useEffect(() => {
    if (phase !== 'recording') return;
    const id = window.setInterval(() => {
      const r = rec.current;
      if (!r) return;
      const ctx = getContext();
      const beatsLeft = Math.ceil((r.t0 - ctx.currentTime) / p.beatSec);
      const { hz, clarity, rms } = liveRef.current;
      setLive({
        count: beatsLeft > 0 ? beatsLeft : 0,
        note: hz > 0 && clarity >= 0.9 ? midiName(Math.round(hzToMidiFloat(hz)), p.speller) : '',
        level: rms,
      });
    }, 80);
    return () => window.clearInterval(id);
  }, [phase, p.beatSec, p.speller]);

  // 離開頁面或切換段落時收掉麥克風
  useEffect(
    () => () => {
      const r = rec.current;
      if (!r) return;
      rec.current = null;
      window.clearTimeout(r.timer);
      r.off();
      r.tr.stop();
    },
    [],
  );

  const keyName = p.keyInfo ? `${p.speller(p.keyInfo.tonic)} ${p.keyInfo.mode === 'major' ? '大調' : '小調'}` : '';

  return (
    <div className="sing">
      {phase === 'recording' ? (
        <div className="sing-rec" role="status">
          <button type="button" className="btn btn-primary" onClick={finish}>■ 唱完了</button>
          <span className="sing-count" aria-label={live.count ? `倒數 ${live.count}` : '錄音中'}>
            {live.count ? live.count : live.note || '…'}
          </span>
          <span className="help sing-hint">
            {live.count ? '數完四拍就開始唱' : live.level < QUIET_RMS ? '聽不太到你的聲音：靠近麥克風一點' : `正在錄${p.sectionName}的旋律，唱完會自動停`}
          </span>
        </div>
      ) : (
        <div className="sing-row">
          <button type="button" className="btn" disabled={!p.ready || phase === 'starting'} onClick={() => void begin()}>
            <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            {p.hasMelody ? '重新唱一次旋律' : '跟著和弦唱旋律'}
          </button>
          <div className="seg" role="group" aria-label="錄音時的伴奏">
            <button type="button" className={`seg-btn ${!clickOnly ? 'is-on' : ''}`} aria-pressed={!clickOnly} onClick={() => setClickOnly(false)}>
              放和弦
            </button>
            <button type="button" className={`seg-btn ${clickOnly ? 'is-on' : ''}`} aria-pressed={clickOnly} onClick={() => setClickOnly(true)}>
              只放節拍器
            </button>
          </div>
          {keyName && (
            <label className="check sing-opt">
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
              音唱得有點偏時，吸附到 {keyName} 的音
            </label>
          )}
          {p.hasMelody && (
            <>
              <label className="check sing-opt">
                <input type="checkbox" checked={p.withMelody} onChange={(e) => p.onWithMelody(e.target.checked)} />
                播放時一起放旋律
              </label>
              <button type="button" className="btn btn-sm btn-ghost" onClick={p.onClear}>清除旋律</button>
            </>
          )}
        </div>
      )}
      {phase === 'idle' && !p.hasMelody && !error && (
        <p className="help">
          {p.ready
            ? '會先數四拍，再從頭播這段，你跟著唱就好（用「啦」或「嗚」也可以）。放和弦時建議戴耳機，麥克風才不會收到吉他聲。'
            : '先在這段加幾個和弦，就能跟著和弦唱旋律。'}
        </p>
      )}
      {error && <p className="help err" role="alert">{error}</p>}
      {message && !error && <p className="notice" role="status">{message}</p>}
    </div>
  );
}
