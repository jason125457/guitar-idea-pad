import { useEffect, useMemo, useRef, useState } from 'react';
import { PitchTracker, TrackerError } from '../audio/pitchTracker';
import { playNotes, stopTones } from '../audio/tone';
import {
  hzToMidiFloat,
  midiName,
  notesToMelodyText,
  scalePcsForKey,
  segmentNotes,
  type DetectedNote,
  type KeyGuess,
  type PitchFrame,
  type Speller,
  type TimedNote,
} from '../core';

const MAX_SECONDS = 30;

interface Props {
  /** 目前段落的調（用來吸附到調內音與決定升降記號拼寫） */
  keyInfo: Pick<KeyGuess, 'tonic' | 'mode'> | undefined;
  speller: Speller;
  hasMelody: boolean;
  /** 原本的旋律是否有節奏資料；沒有的話接上新錄的，整段都會失去節奏 */
  hasTiming: boolean;
  /** 一併交出每個音的時間，之後才能依拍點配和弦 */
  onAppend: (text: string, timed: TimedNote[]) => void;
  onReplace: (text: string, timed: TimedNote[]) => void;
}

/** 以第一個音為 0 的時間軸。 */
function toTimed(notes: readonly DetectedNote[]): TimedNote[] {
  const t0 = notes[0]?.startSec ?? 0;
  return notes.map((n) => ({ midi: n.midi, startSec: Math.max(0, n.startSec - t0), durSec: n.durSec }));
}

type Phase = 'idle' | 'recording' | 'review';

export function HumRecorder({ keyInfo, speller, hasMelody, hasTiming, onAppend, onReplace }: Props) {
  const trackerRef = useRef<PitchTracker | null>(null);
  const liveRef = useRef<{ hz: number; clarity: number }>({ hz: 0, clarity: 0 });
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [frames, setFrames] = useState<PitchFrame[]>([]);
  const [liveNote, setLiveNote] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [snap, setSnap] = useState(false);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [playing, setPlaying] = useState(false);

  const scalePcs = snap && keyInfo ? scalePcsForKey(keyInfo) : undefined;
  const detected = useMemo(() => segmentNotes(frames, { scalePcs }), [frames, scalePcs]);
  const notes = detected.filter((_, i) => !removed.has(i));

  // 錄音中定時更新「現在唱到哪個音」與秒數（避免每一幀都重新渲染）
  useEffect(() => {
    if (phase !== 'recording') return;
    const id = window.setInterval(() => {
      const { hz, clarity } = liveRef.current;
      setLiveNote(hz > 0 && clarity >= 0.9 ? midiName(Math.round(hzToMidiFloat(hz)), speller) : '');
      const tr = trackerRef.current;
      const last = tr?.frames[tr.frames.length - 1];
      setSeconds(last ? Math.floor(last.t) : 0);
      if (last && last.t >= MAX_SECONDS) finish();
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, speller]);

  useEffect(
    () => () => {
      trackerRef.current?.stop();
      stopTones();
    },
    [],
  );

  const finish = () => {
    const tr = trackerRef.current;
    if (!tr) return;
    setFrames([...tr.stop()]);
    trackerRef.current = null;
    setRemoved(new Set());
    setLiveNote('');
    setPhase('review');
  };

  const begin = async () => {
    setError('');
    stopTones();
    setPlaying(false);
    const tr = new PitchTracker();
    tr.onFrame = (f) => {
      liveRef.current = { hz: f.hz, clarity: f.clarity };
    };
    try {
      await tr.start('mic');
      trackerRef.current = tr;
      setSeconds(0);
      setPhase('recording');
    } catch (e) {
      setError(e instanceof TrackerError ? e.message : '無法開始錄音');
    }
  };

  const discard = () => {
    stopTones();
    setPlaying(false);
    setFrames([]);
    setRemoved(new Set());
    setPhase('idle');
  };

  const text = notesToMelodyText(notes, speller);

  return (
    <div className="hum">
      {phase === 'idle' && (
        <>
          <button type="button" className="btn" onClick={() => void begin()}>
            <svg className="icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            哼唱錄入旋律
          </button>
          <p className="help">用「嗚」或「啦」哼，每個音拉長一點、換音停一下，會比較準。最長 {MAX_SECONDS} 秒。
            <a className="lab-link" href={`${import.meta.env.BASE_URL}pitch-lab.html`}>偵測不準？到實驗室調整</a>
          </p>
        </>
      )}

      {phase === 'recording' && (
        <div className="hum-rec" role="status">
          <button type="button" className="btn btn-primary" onClick={finish}>■ 停止（{seconds} 秒）</button>
          <span className="hum-live" aria-label="目前偵測到的音">{liveNote || '…'}</span>
        </div>
      )}

      {phase === 'review' && (
        <div className="hum-review">
          {notes.length === 0 ? (
            <p className="help">{frames.length ? '沒有偵測到穩定的音。靠近麥克風一點、哼大聲一點再試一次。' : '沒有收到聲音。'}</p>
          ) : (
            <>
              <p className="help" role="status">偵測到 {notes.length} 個音，點音符可以刪掉不要的：</p>
              <ul className="hum-notes">
                {detected.map((n, i) =>
                  removed.has(i) ? null : (
                    <li key={i}>
                      <button
                        type="button"
                        className="hum-note"
                        aria-label={`刪除 ${midiName(n.midi, speller)}${n.cents ? `（${n.cents > 0 ? '偏高' : '偏低'} ${Math.abs(n.cents)} 音分）` : ''}`}
                        onClick={() => setRemoved((s) => new Set(s).add(i))}
                      >
                        <span>{midiName(n.midi, speller)}</span>
                        <span className="hum-cents">{n.cents > 0 ? '+' : ''}{n.cents}¢</span>
                      </button>
                    </li>
                  ),
                )}
              </ul>
              {keyInfo && (
                <label className="check">
                  <input type="checkbox" checked={snap} onChange={(e) => { setSnap(e.target.checked); setRemoved(new Set()); }} />
                  <span>吸附到調內音（會把偏離調性的音拉進音階，唱藍調音或借用音時請關掉）</span>
                </label>
              )}
              <div className="row wrap">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const total = playNotes(notes);
                    setPlaying(true);
                    window.setTimeout(() => setPlaying(false), total * 1000 + 300);
                  }}
                >
                  ▶ 聽聽看
                </button>
                <button type="button" className="btn btn-ghost" disabled={!playing} onClick={() => { stopTones(); setPlaying(false); }}>■</button>
                <button type="button" className="btn btn-primary" onClick={() => { onAppend(text, toTimed(notes)); discard(); }}>
                  {hasMelody ? '接在旋律後面' : '寫入旋律'}
                </button>
                {hasMelody && (
                  <button type="button" className="btn" onClick={() => { onReplace(text, toTimed(notes)); discard(); }}>取代原旋律</button>
                )}
              </div>
              {hasMelody && !hasTiming && (
                <p className="help">
                  原本的旋律是手動輸入的，沒有節奏資料。接在後面的話，整段旋律就不能拿來配和弦；想配和弦請選「取代原旋律」。
                </p>
              )}
            </>
          )}
          <div className="row">
            <button type="button" className="btn btn-ghost" onClick={() => void begin()}>重錄</button>
            <button type="button" className="btn btn-ghost" onClick={discard}>放棄</button>
          </div>
        </div>
      )}

      {error && <p className="notice err" role="alert">{error}</p>}
    </div>
  );
}
