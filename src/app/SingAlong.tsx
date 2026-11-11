import { useEffect, useRef, useState } from 'react';
import { getContext } from '../audio/context';
import { onStopAll } from '../audio/pluck';
import { PitchTracker, TrackerError } from '../audio/pitchTracker';
import {
  alignFreeMelody,
  hzToMidiFloat,
  melodyFromNoteText,
  midiName,
  quantizeMelody,
  suspiciousNotes,
  scalePcsForKey,
  segmentNotes,
  type BeatNote,
  type KeyGuess,
  type Speller,
  type SuspectReason,
} from '../core';

const REASON: Record<SuspectReason, string> = {
  'out-of-key': '不在這個調裡',
  blip: '很短、跟旁邊只差半音，可能是滑過去的音',
  octave: '跟前後差了一個八度以上，可能抓錯八度',
  range: '太低或太高，不太像唱出來的音',
};

const COUNT_IN = 4;
const QUIET_RMS = 0.01;
/** 自由哼最長錄多久（秒） */
const FREE_MAX_SEC = 90;
const FREE_BPM: readonly [number, number] = [40, 200];

export interface TakeInfo {
  id: string;
  label: string;
  count: number;
  current: boolean;
}

interface Props {
  /** 這段有沒有和弦可以跟著唱；沒有的話只放節拍器，唱 bars 小節 */
  hasChords: boolean;
  bars: number;
  onBars: (n: number) => void;
  takes: TakeInfo[];
  onUseTake: (id: string) => void;
  onHearTake: (id: string) => void;
  onClose: () => void;
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
  /** 試聽一串音（確認錄音結果時用），會跟這段的和弦一起播 */
  onHearNotes: (notes: BeatNote[], beatSec?: number) => void;
  /** 自由哼（沒跟節拍器）確認完：旋律和估出來的速度一起存 */
  onDoneFree?: (notes: BeatNote[], bpm: number) => void;
  /** 直接打音名當旋律 */
  onTyped: (notes: BeatNote[]) => void;
}

type Phase = 'idle' | 'starting' | 'recording' | 'review';

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
  const [live, setLive] = useState({ note: '', cents: 0, level: 0, count: 0 });
  /** 唱完還沒放進時間軸的音，讓使用者先確認、改錯 */
  const [review, setReview] = useState<BeatNote[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  /** 還沒有和弦時可以選：跟節拍器唱，或不管拍子自由哼（哼完再估速度） */
  const [mode, setMode] = useState<'beat' | 'free'>(() => (p.hasChords || !p.onDoneFree ? 'beat' : 'free'));
  const free = mode === 'free' && !p.hasChords && !!p.onDoneFree;
  /** 自由哼的原始結果：還沒對齊拍子的音、目前用的速度、補滿之後幾拍 */
  const [hum, setHum] = useState<{ raw: { midi: number; startSec: number; durSec: number }[]; bpm: number; totalBeats: number } | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const player = useRef<HTMLAudioElement | null>(null);
  const rec = useRef<{ tr: PitchTracker; offset: number; t0: number; timer: number; off: () => void; free: boolean } | null>(null);
  const liveRef = useRef({ hz: 0, clarity: 0, rms: 0 });

  const finish = () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    window.clearTimeout(r.timer);
    r.off();
    const frames = r.tr.stop();
    if (r.free) {
      setPhase('idle');
      const raw = segmentNotes(frames, {}).map((n) => ({ midi: n.midi, startSec: n.startSec, durSec: n.durSec }));
      const aligned = alignFreeMelody(raw);
      if (!aligned) {
        setError('沒有抓到旋律。靠近麥克風、用「啦」或「嗚」哼大聲一點，每個音拉長一點再試一次。');
        return;
      }
      setHum({ raw, bpm: aligned.bpm, totalBeats: aligned.totalBeats });
      setReview(aligned.notes);
      setPicked(null);
      setPhase('review');
      // 原始錄音晚一點才會好；好了就能按「聽原本的錄音」對照
      void (r.tr as { audio?: Promise<Blob | undefined> }).audio?.then((blob) => {
        if (blob) setAudioUrl(URL.createObjectURL(blob));
      });
      return;
    }
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
    setReview(grid);
    setPicked(null);
    setPhase('review');
  };

  /** 換一個速度重新對齊（估出來的速度常差一倍）；會蓋掉在下面手動修過的音 */
  const retime = (bpm: number) => {
    if (!hum) return;
    const next = Math.round(Math.min(FREE_BPM[1], Math.max(FREE_BPM[0], bpm)));
    const aligned = alignFreeMelody(hum.raw, next);
    if (!aligned) return;
    setHum({ ...hum, bpm: aligned.bpm, totalBeats: aligned.totalBeats });
    setReview(aligned.notes);
    setPicked(null);
  };
  const stopOriginal = () => {
    player.current?.pause();
    player.current = null;
  };
  const hearOriginal = () => {
    stopOriginal();
    p.stop();
    if (!audioUrl) return;
    const a = new Audio(audioUrl);
    player.current = a;
    void a.play().catch(() => setError('這個瀏覽器放不出剛剛的錄音'));
  };
  const clearHum = () => {
    stopOriginal();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl('');
    setHum(null);
  };

  const keep = () => {
    if (!review.length) return;
    if (hum && p.onDoneFree) {
      p.onDoneFree(review, hum.bpm);
      setMessage(`已放進時間軸：${review.length} 個音，速度設成 ${hum.bpm} BPM。可以按「依旋律配上和弦」讓工具先配一版`);
      clearHum();
      setReview([]);
      setPicked(null);
      setPhase('idle');
      return;
    }
    p.onDone(review);
    setMessage(`已放進時間軸：${review.length} 個音${p.hasChords ? '' : '。可以按「依旋律配上和弦」讓工具先配一版'}`);
    setReview([]);
    setPicked(null);
    setPhase('idle');
  };
  const nudge = (i: number, d: number) => setReview((r) => r.map((n, j) => (j === i ? { ...n, midi: n.midi + d } : n)));
  const drop = (i: number) => {
    setReview((r) => r.filter((_, j) => j !== i));
    setPicked(null);
  };
  const typedNotes = typed.trim() ? melodyFromNoteText(typed) : undefined;

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
    clearHum();
    if (free) {
      // 自由哼：不放節拍器、不數拍，按下去就開始錄，哼完自己按停
      p.stop();
      const timer = window.setTimeout(finish, FREE_MAX_SEC * 1000);
      rec.current = { tr, offset: 0, t0: -1, timer, off: () => {}, free: true };
      setPhase('recording');
      return;
    }
    const res = p.start({ clickOnly: clickOnly || !p.hasChords, countInBeats: COUNT_IN });
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
    rec.current = { tr, offset, t0: res.t0, timer, off, free: false };
    setPhase('recording');
  };

  // 錄音中定時更新：數拍、目前唱到的音、音量
  useEffect(() => {
    if (phase !== 'recording') return;
    const id = window.setInterval(() => {
      const r = rec.current;
      if (!r) return;
      const ctx = getContext();
      const beatsLeft = r.free ? 0 : Math.ceil((r.t0 - ctx.currentTime) / p.beatSec);
      const { hz, clarity, rms } = liveRef.current;
      const f = hz > 0 && clarity >= 0.9 ? hzToMidiFloat(hz) : undefined;
      setLive({
        count: beatsLeft > 0 ? beatsLeft : 0,
        note: f !== undefined ? midiName(Math.round(f), p.speller) : '',
        cents: f !== undefined ? Math.round((f - Math.round(f)) * 100) : 0,
        level: rms,
      });
    }, 80);
    return () => window.clearInterval(id);
  }, [phase, p.beatSec, p.speller]);

  // 離開頁面或切換段落時收掉麥克風
  useEffect(
    () => () => {
      player.current?.pause();
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

  const recording = phase === 'recording';
  const suspects = suspiciousNotes(review, snap ? undefined : p.keyInfo);
  return (
    <section className="panel sing-panel" aria-labelledby="h-sing">
      <div className="insp-head">
        <h2 id="h-sing">唱旋律</h2>
        <button type="button" className="btn btn-sm btn-ghost insp-x" onClick={p.onClose} disabled={recording} aria-label="關閉，回到加和弦">✕</button>
      </div>

      {recording ? (
        <div className="sing-rec" role="status">
          <span className="sing-count" aria-label={live.count ? `倒數 ${live.count}` : '錄音中'}>
            {live.count ? live.count : live.note || '…'}
          </span>
          {!live.count && (
            <div className="tuner" aria-hidden="true">
              <div className="tuner-scale">
                <span className="tuner-mid" />
                {live.note && <span className="tuner-needle" style={{ left: `${50 + live.cents}%` }} />}
              </div>
              <span className={`tuner-text ${live.note && Math.abs(live.cents) <= 15 ? 'is-ok' : ''}`}>
                {!live.note ? '還沒聽到穩定的音' : Math.abs(live.cents) <= 15 ? '音很準' : live.cents > 0 ? `偏高 ${live.cents} 音分` : `偏低 ${-live.cents} 音分`}
              </span>
            </div>
          )}
          <p className="help sing-hint">
            {live.count
              ? '數完四拍就開始唱'
              : live.level < QUIET_RMS
                ? '聽不太到你的聲音：靠近麥克風一點'
                : free
                  ? '隨口哼就好，不用管拍子；哼完按下面的按鈕'
                  : `正在錄${p.sectionName}，唱完會自動停`}
          </p>
          <button type="button" className="btn btn-primary sing-go" onClick={finish}>{free ? '■ 哼完了' : '■ 唱完了'}</button>
        </div>
      ) : phase === 'review' ? (
        <div className="review">
          <h3 className="shapes-title">抓到這些音，先確認一下</h3>
          {hum && (
            <div className="hum-tempo" role="group" aria-label="自由哼的速度">
              <p className="hum-tempo-now">
                估計速度 <strong>{hum.bpm} BPM</strong>，共 {hum.totalBeats / 4} 小節
              </p>
              <div className="review-tools">
                <button type="button" className="btn btn-sm" disabled={hum.bpm / 2 < FREE_BPM[0]} onClick={() => retime(hum.bpm / 2)}>慢一半</button>
                <button type="button" className="btn btn-sm" disabled={hum.bpm <= FREE_BPM[0]} onClick={() => retime(hum.bpm - 4)} aria-label="速度慢一點">−</button>
                <button type="button" className="btn btn-sm" disabled={hum.bpm >= FREE_BPM[1]} onClick={() => retime(hum.bpm + 4)} aria-label="速度快一點">＋</button>
                <button type="button" className="btn btn-sm" disabled={hum.bpm * 2 > FREE_BPM[1]} onClick={() => retime(hum.bpm * 2)}>快一倍</button>
              </div>
              <p className="help">按「聽聽看」，節奏跟你哼的對不上就調速度（小節數太多按「慢一半」）。先調好速度再修下面的音，改速度會重新對齊。</p>
            </div>
          )}
          <p className="help">點一個音可以調高、調低半音或刪掉；虛線框的是可能抓錯的。</p>
          <ul className="review-notes">
            {review.map((n, i) => {
              const why = suspects.get(i);
              return (
                <li key={`${n.beat}-${i}`}>
                  <button
                    type="button"
                    className={`rnote ${why ? 'is-sus' : ''} ${picked === i ? 'is-on' : ''}`}
                    aria-pressed={picked === i}
                    title={why ? REASON[why] : undefined}
                    onClick={() => setPicked(picked === i ? null : i)}
                  >
                    {midiName(n.midi, p.speller)}
                    <small>第 {Math.floor(n.beat / 4) + 1} 小節</small>
                  </button>
                </li>
              );
            })}
          </ul>
          {picked !== null && review[picked] && (
            <div className="review-tools">
              {suspects.get(picked) && <p className="help err">{REASON[suspects.get(picked) as SuspectReason]}</p>}
              <button type="button" className="btn btn-sm" onClick={() => nudge(picked, 1)}>高半音</button>
              <button type="button" className="btn btn-sm" onClick={() => nudge(picked, -1)}>低半音</button>
              <button type="button" className="btn btn-sm" onClick={() => nudge(picked, 12)}>高八度</button>
              <button type="button" className="btn btn-sm" onClick={() => nudge(picked, -12)}>低八度</button>
              <button type="button" className="btn btn-sm btn-ghost insp-del" onClick={() => drop(picked)}>刪掉</button>
            </div>
          )}
          <div className="review-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={!review.length}
              onClick={() => {
                stopOriginal();
                if (hum) p.onHearNotes(review, 60 / hum.bpm);
                else p.onHearNotes(review);
              }}
            >
              ▶ 聽聽看
            </button>
            {hum && (
              <button type="button" className="btn btn-sm" disabled={!audioUrl} onClick={hearOriginal} title={audioUrl ? undefined : '這個瀏覽器沒有留下原始錄音'}>
                ▶ 聽原本的錄音
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void begin()}>{hum ? '重哼' : '重唱'}</button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                clearHum();
                setReview([]);
                setPhase('idle');
              }}
            >
              不要了
            </button>
          </div>
          <button type="button" className="btn btn-primary sing-go" disabled={!review.length} onClick={keep}>放進時間軸</button>
        </div>
      ) : (
        <>
          {!p.hasChords && p.onDoneFree && (
            <div className="seg seg-sm sing-mode" role="group" aria-label="怎麼唱">
              <button type="button" className={`seg-btn ${free ? 'is-on' : ''}`} aria-pressed={free} onClick={() => setMode('free')}>
                自由哼
              </button>
              <button type="button" className={`seg-btn ${!free ? 'is-on' : ''}`} aria-pressed={!free} onClick={() => setMode('beat')}>
                跟節拍器
              </button>
            </div>
          )}
          <p className="help sing-intro">
            {p.hasChords
              ? '先數四拍，再從頭播這段，你跟著唱（用「啦」也可以）。'
              : free
                ? '不用管拍子，想到什麼就哼（用「啦」也可以）。哼完工具會估速度、分好小節，之後再配和弦。'
                : '這段還沒有和弦：只放節拍器，先把旋律唱下來，之後再配和弦。'}
          </p>
          {!p.hasChords && !free && (
            <label className="menu-row">
              <span>唱幾小節</span>
              <select className="input input-sm" value={p.bars} onChange={(e) => p.onBars(Number(e.target.value))}>
                {[2, 4, 8, 16].map((n) => (
                  <option key={n} value={n}>{n} 小節</option>
                ))}
              </select>
            </label>
          )}
          {p.hasChords && (
            <div className="menu-row">
              <span>伴奏</span>
              <div className="seg seg-sm" role="group" aria-label="錄音時的伴奏">
                <button type="button" className={`seg-btn ${!clickOnly ? 'is-on' : ''}`} aria-pressed={!clickOnly} onClick={() => setClickOnly(false)}>
                  和弦
                </button>
                <button type="button" className={`seg-btn ${clickOnly ? 'is-on' : ''}`} aria-pressed={clickOnly} onClick={() => setClickOnly(true)}>
                  只放節拍器
                </button>
              </div>
            </div>
          )}
          {p.hasChords && !clickOnly && <p className="help">放和弦時建議戴耳機，麥克風才不會收到吉他聲。</p>}
          {keyName && (
            <label className="check sing-opt">
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
              音有點偏時，吸附到 {keyName} 的音
            </label>
          )}
          <button type="button" className="btn btn-primary sing-go" disabled={phase === 'starting'} onClick={() => void begin()}>
            <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            {free ? (p.takes.length ? '再哼一次' : '開始哼') : p.takes.length ? '再唱一次' : '開始唱'}
          </button>
          <form
            className="sing-typed"
            onSubmit={(e) => {
              e.preventDefault();
              if (!typedNotes) return;
              p.onTyped(typedNotes);
              setTyped('');
              setMessage(`已用 ${typedNotes.length} 個音當旋律（每個音一拍）`);
            }}
          >
            <label className="field" htmlFor="typed-melody">或直接打音名</label>
            <div className="pal-search">
              <input
                id="typed-melody"
                className={`input input-sm mono ${typed.trim() && !typedNotes ? 'bad' : ''}`}
                placeholder="E4 G4 A4 C5"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
              <button type="submit" className="btn btn-sm" disabled={!typedNotes}>用這些音</button>
            </div>
            {typed.trim() && !typedNotes && <p className="help err">請打音名加八度，例如 E4 G4 A4，空格分開，至少兩個音。</p>}
          </form>
        </>
      )}

      {error && <p className="help err" role="alert">{error}</p>}
      {message && !error && <p className="notice" role="status">{message}</p>}

      {p.takes.length > 0 && !recording && (
        <div className="takes">
          <h3 className="shapes-title">唱過的 <span className="help">點「用這次」換成那一次</span></h3>
          <ul className="take-list">
            {p.takes.map((t) => (
              <li key={t.id} className={`take ${t.current ? 'is-on' : ''}`}>
                <span className="take-name">{t.label}<small>{t.count} 個音</small></span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => p.onHearTake(t.id)} aria-label={`聽${t.label}`}>▶</button>
                {t.current ? (
                  <span className="shape-badge sb-now">使用中</span>
                ) : (
                  <button type="button" className="btn btn-sm" onClick={() => p.onUseTake(t.id)}>用這次</button>
                )}
              </li>
            ))}
          </ul>
          <label className="check sing-opt">
            <input type="checkbox" checked={p.withMelody} onChange={(e) => p.onWithMelody(e.target.checked)} />
            播放時一起放旋律
          </label>
          {p.hasMelody && <button type="button" className="btn btn-sm btn-ghost" onClick={p.onClear}>清除旋律</button>}
        </div>
      )}
    </section>
  );
}
