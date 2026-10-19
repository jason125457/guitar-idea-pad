import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PitchTracker, TrackerError, type TrackerSource } from '../audio/pitchTracker';
import { playNotes, stopTones } from '../audio/tone';
import {
  DEFAULT_SEGMENT_OPTIONS,
  hzToMidiFloat,
  midiName,
  notesToMelodyText,
  segmentNotes,
  type PitchFrame,
} from '../core';

const WINDOW_SEC = 8; // 軌跡圖顯示最近幾秒

interface Live {
  hz: number;
  clarity: number;
  rms: number;
}

interface Stats {
  frames: number;
  voicedRatio: number;
  meanClarity: number;
  fps: number;
}

function stats(frames: PitchFrame[], minClarity: number): Stats {
  if (frames.length < 2) return { frames: frames.length, voicedRatio: 0, meanClarity: 0, fps: 0 };
  const voiced = frames.filter((f) => f.hz > 0 && f.clarity >= minClarity);
  const span = (frames[frames.length - 1] as PitchFrame).t - (frames[0] as PitchFrame).t;
  return {
    frames: frames.length,
    voicedRatio: voiced.length / frames.length,
    meanClarity: voiced.length ? voiced.reduce((s, f) => s + f.clarity, 0) / voiced.length : 0,
    fps: span > 0 ? (frames.length - 1) / span : 0,
  };
}

export function LabApp() {
  const trackerRef = useRef<PitchTracker | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<Live>({ hz: 0, clarity: 0, rms: 0 });
  const [running, setRunning] = useState<TrackerSource | null>(null);
  const [error, setError] = useState('');
  const [frames, setFrames] = useState<PitchFrame[]>([]);
  const [live, setLive] = useState<Live>({ hz: 0, clarity: 0, rms: 0 });
  const [latency, setLatency] = useState<number | undefined>();
  const [minClarity, setMinClarity] = useState(DEFAULT_SEGMENT_OPTIONS.minClarity);
  const [minNoteMs, setMinNoteMs] = useState(Math.round(DEFAULT_SEGMENT_OPTIONS.minNoteSec * 1000));
  const [playing, setPlaying] = useState(false);

  const notes = useMemo(
    () => segmentNotes(frames, { minClarity, minNoteSec: minNoteMs / 1000 }),
    [frames, minClarity, minNoteMs],
  );
  const st = useMemo(() => stats(frames, minClarity), [frames, minClarity]);

  const draw = useCallback(
    (all: PitchFrame[], showNotes: boolean, followLive: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const g = canvas.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(document.documentElement);
      const color = (name: string) => css.getPropertyValue(name).trim() || '#888';
      g.clearRect(0, 0, w, h);

      const last = all[all.length - 1];
      const tEnd = followLive ? (last?.t ?? WINDOW_SEC) : Math.max(WINDOW_SEC, last?.t ?? 0);
      const tStart = followLive ? tEnd - WINDOW_SEC : 0;
      const span = followLive ? WINDOW_SEC : Math.max(tEnd, 1);

      const voiced = all.filter((f) => f.hz > 0 && f.clarity >= minClarity && f.t >= tStart);
      const ms = voiced.map((f) => hzToMidiFloat(f.hz));
      const lo = Math.floor((ms.length ? Math.min(...ms) : 55) - 2);
      const hi = Math.ceil((ms.length ? Math.max(...ms) : 70) + 2);
      const lowBound = Math.min(lo, hi - 12);
      const x = (t: number) => ((t - tStart) / span) * w;
      const y = (m: number) => h - ((m - lowBound) / (hi - lowBound)) * h;

      // 半音格線與 C 音標示
      g.font = '11px Poppins, system-ui, sans-serif';
      g.textBaseline = 'middle';
      for (let m = Math.ceil(lowBound); m <= hi; m++) {
        const isC = m % 12 === 0;
        g.strokeStyle = color('--border');
        g.globalAlpha = isC ? 0.9 : 0.35;
        g.beginPath();
        g.moveTo(0, y(m));
        g.lineTo(w, y(m));
        g.stroke();
        if (isC || hi - lowBound < 16) {
          g.globalAlpha = 1;
          g.fillStyle = color('--muted');
          g.fillText(midiName(m), 4, y(m) - 7);
        }
      }
      g.globalAlpha = 1;

      if (showNotes) {
        g.fillStyle = color('--accent');
        g.globalAlpha = 0.28;
        for (const n of notes) {
          if (n.startSec + n.durSec < tStart) continue;
          g.fillRect(x(n.startSec), y(n.midi + 0.5), (n.durSec / span) * w, y(n.midi - 0.5) - y(n.midi + 0.5));
        }
        g.globalAlpha = 1;
      }

      // 原始音高軌跡
      g.fillStyle = color('--text');
      for (const f of voiced) {
        g.beginPath();
        g.arc(x(f.t), y(hzToMidiFloat(f.hz)), 2, 0, Math.PI * 2);
        g.fill();
      }
    },
    [minClarity, notes],
  );

  // 錄音中：用 requestAnimationFrame 畫圖並限制畫面更新頻率（幀本身約每 11ms 一筆）
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastState = 0;
    const loop = (now: number) => {
      const tr = trackerRef.current;
      if (tr) {
        draw(tr.frames, false, true);
        if (now - lastState > 80) {
          lastState = now;
          setLive({ ...liveRef.current });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, draw]);

  // 停止後：完整軌跡加上偵測到的音
  useEffect(() => {
    if (!running) draw(frames, true, false);
  }, [running, frames, draw]);

  useEffect(() => {
    const onResize = () => {
      if (!running) draw(frames, true, false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [running, frames, draw]);

  useEffect(
    () => () => {
      trackerRef.current?.stop();
      stopTones();
    },
    [],
  );

  const stop = useCallback(() => {
    const tr = trackerRef.current;
    if (!tr) return;
    setFrames([...tr.stop()]);
    trackerRef.current = null;
    setRunning(null);
    setLive({ hz: 0, clarity: 0, rms: 0 });
  }, []);

  const start = async (source: TrackerSource) => {
    setError('');
    stopTones();
    setPlaying(false);
    const tr = new PitchTracker();
    tr.onFrame = (f) => {
      liveRef.current = { hz: f.hz, clarity: f.clarity, rms: f.rms };
    };
    tr.onEnded = () => {
      setFrames([...tr.frames]);
      trackerRef.current = null;
      setRunning(null);
      setLive({ hz: 0, clarity: 0, rms: 0 });
    };
    try {
      await tr.start(source);
      trackerRef.current = tr;
      setLatency(tr.info?.latencyMs);
      setFrames([]);
      setRunning(source);
    } catch (e) {
      setError(e instanceof TrackerError ? e.message : '無法開始錄音');
    }
  };

  const liveMidi = live.hz > 0 && live.clarity >= minClarity ? hzToMidiFloat(live.hz) : undefined;
  const liveNote = liveMidi === undefined ? undefined : Math.round(liveMidi);
  const liveCents = liveMidi === undefined || liveNote === undefined ? 0 : Math.round((liveMidi - liveNote) * 100);
  const melodyText = notesToMelodyText(notes);

  return (
    <div className="app lab">
      <header className="top">
        <h1 className="brand">哼唱音高偵測實驗室</h1>
        <p className="tagline">
          先確認「你的麥克風 + 你的聲音」抓得準不準，再把這套搬進主程式。
          <a href="/" className="lab-link">回到指板靈感本</a>
        </p>
      </header>

      <div className="lab-grid">
        <section className="panel" aria-labelledby="lab-control">
          <h2 id="lab-control">1 · 錄音</h2>
          <div className="row wrap">
            {running ? (
              <button type="button" className="btn btn-primary" onClick={stop}>■ 停止</button>
            ) : (
              <>
                <button type="button" className="btn btn-primary" onClick={() => void start('mic')}>● 開始哼唱</button>
                <button type="button" className="btn" onClick={() => void start('demo')}>用測試訊號驗證</button>
              </>
            )}
          </div>
          <p className="help">
            {running === 'demo'
              ? '正在播放內建測試旋律（A3 B3 D4 E4 G4，D4 帶顫音）直接餵給偵測器，不需要麥克風，也不會發出聲音。'
              : running === 'mic'
                ? '哼一段旋律吧。每個音拉長一點、換音時稍微停頓，結果會更準。'
                : '建議在安靜的地方、離麥克風約一個拳頭遠，用「嗚」或「啦」哼。測試訊號可以不用麥克風確認偵測程式本身是正常的。'}
          </p>
          {error && <p className="notice err" role="alert">{error}</p>}

          <div className="live" aria-live="off">
            <div className="live-note" aria-label="目前偵測到的音">
              {liveNote === undefined ? '—' : midiName(liveNote)}
            </div>
            <div className="meter" role="img" aria-label={liveNote === undefined ? '沒有偵測到音高' : `偏差 ${liveCents} 音分`}>
              <div className="meter-center" />
              {liveNote !== undefined && <div className="meter-needle" style={{ left: `${50 + liveCents}%` }} />}
            </div>
            <div className="live-meta mono">
              <span>{live.hz > 0 ? `${live.hz.toFixed(1)} Hz` : '— Hz'}</span>
              <span>{liveNote === undefined ? '' : `${liveCents > 0 ? '+' : ''}${liveCents}¢`}</span>
              <span>把握度 {live.clarity.toFixed(2)}</span>
              <span>音量 {live.rms.toFixed(3)}</span>
            </div>
          </div>

          <h3>偵測參數</h3>
          <label className="field" htmlFor="clarity">最低把握度 {minClarity.toFixed(2)}（越高越保守）</label>
          <input id="clarity" type="range" min="0.8" max="0.99" step="0.01" value={minClarity} onChange={(e) => setMinClarity(Number(e.target.value))} />
          <label className="field" htmlFor="minnote">最短音長 {minNoteMs} 毫秒</label>
          <input id="minnote" type="range" min="40" max="300" step="10" value={minNoteMs} onChange={(e) => setMinNoteMs(Number(e.target.value))} />
        </section>

        <div className="stack">
          <section className="panel" aria-labelledby="lab-contour">
            <h2 id="lab-contour">2 · 音高軌跡</h2>
            <canvas ref={canvasRef} className="contour" aria-hidden="true" />
            <p className="help">
              圓點是每一幀偵測到的音高；停止後金色色塊是切出來的音符。{running ? `（顯示最近 ${WINDOW_SEC} 秒）` : ''}
            </p>
            <dl className="stats">
              <div><dt>幀數</dt><dd>{st.frames}</dd></div>
              <div><dt>幀率</dt><dd>{st.fps ? `${st.fps.toFixed(0)}/s` : '—'}</dd></div>
              <div><dt>有聲比例</dt><dd>{st.frames ? `${Math.round(st.voicedRatio * 100)}%` : '—'}</dd></div>
              <div><dt>平均把握度</dt><dd>{st.meanClarity ? st.meanClarity.toFixed(2) : '—'}</dd></div>
              <div><dt>估計延遲</dt><dd>{latency !== undefined ? `約 ${latency} ms` : '—'}</dd></div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="lab-result">
            <h2 id="lab-result">3 · 偵測結果</h2>
            {notes.length === 0 ? (
              <p className="help">{frames.length ? '沒有切出音符。試著降低「最低把握度」，或哼得更大聲、更穩一點。' : '錄完之後，音符會顯示在這裡。'}</p>
            ) : (
              <>
                <p className="melody-text mono" aria-label="偵測到的旋律">{melodyText}</p>
                <div className="table-wrap">
                  <table className="notes">
                    <thead>
                      <tr><th scope="col">開始</th><th scope="col">長度</th><th scope="col">音</th><th scope="col">音準</th><th scope="col">把握度</th></tr>
                    </thead>
                    <tbody>
                      {notes.map((n, i) => (
                        <tr key={i}>
                          <td>{n.startSec.toFixed(2)}s</td>
                          <td>{n.durSec.toFixed(2)}s</td>
                          <td className="mono">{midiName(n.midi)}</td>
                          <td>{n.cents > 0 ? '+' : ''}{n.cents}¢</td>
                          <td>{n.confidence.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const total = playNotes(notes);
                      setPlaying(true);
                      window.setTimeout(() => setPlaying(false), total * 1000 + 300);
                    }}
                  >
                    ▶ 播放偵測結果
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={!playing} onClick={() => { stopTones(); setPlaying(false); }}>■ 停止</button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
