import { useEffect, useMemo, useState } from 'react';
import { playArrangement, stopArrangement } from '../audio/arrangement';
import {
  buildWindows,
  chordSymbol,
  estimateTempo,
  formatTab,
  fretsToNotes,
  harmonize,
  inferKeyFromMelody,
  midiName,
  spellerForKey,
  voiceChords,
  type ChordChoice,
  type Fret,
  type HarmonizeSettings,
  type KeyLock,
  type TimedNote,
} from '../core';

const TAG_LABEL: Record<ChordChoice['tag'], string> = {
  diatonic: '順階',
  borrowed: '借用',
  'secondary-dominant': '副屬',
  'tritone-sub': '三全音替代',
  chromatic: '調外',
};

interface Props {
  timed: TimedNote[] | undefined;
  hasMelodyText: boolean;
  keyLock: KeyLock | null;
  hasChords: boolean;
  onLockKey: (k: KeyLock | null) => void;
  /** 把配好的和弦（指法）加進這個段落 */
  onAdopt: (frets: Fret[][], mode: 'append' | 'replace') => void;
}

const modeName = (m: 'major' | 'minor') => (m === 'major' ? '大調' : '小調');

export function HarmonizePanel({ timed, hasMelodyText, keyLock, hasChords, onLockKey, onAdopt }: Props) {
  const [bpm, setBpm] = useState(90);
  const [beatsPerBar, setBeatsPerBar] = useState<3 | 4>(4);
  const [pickupBeats, setPickupBeats] = useState(0);
  const [chordsPerBar, setChordsPerBar] = useState<1 | 2>(1);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [playing, setPlaying] = useState(false);
  const [adopted, setAdopted] = useState('');

  // 旋律換了就重新估計速度並清掉手動挑選
  useEffect(() => {
    if (timed) setBpm(estimateTempo(timed));
    setPicks({});
    setAdopted('');
  }, [timed]);

  useEffect(() => () => stopArrangement(), []);

  const settings: HarmonizeSettings = { bpm, beatsPerBar, pickupBeats, chordsPerBar };
  const melodyKeys = useMemo(() => (timed ? inferKeyFromMelody(timed) : []), [timed]);
  const key: { tonic: number; mode: 'major' | 'minor' } | undefined = keyLock ?? melodyKeys[0];

  const result = useMemo(() => {
    if (!timed || !key || timed.length < 3) return undefined;
    return harmonize(buildWindows(timed, settings), key);
    // settings 的欄位已逐一列為依賴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, key?.tonic, key?.mode, bpm, beatsPerBar, pickupBeats, chordsPerBar]);

  const chosen = useMemo(
    () => (result ? result.choices.map((ch, i) => ch[picks[i] ?? 0] as ChordChoice) : []),
    [result, picks],
  );
  const voicings = useMemo(() => voiceChords(chosen), [chosen]);

  const speller = spellerForKey(key?.tonic ?? 0, key?.mode ?? 'major');

  if (!timed || timed.length < 3 || !key || !result) {
    return (
      <section className="panel" aria-labelledby="h-harm">
        <h2 id="h-harm">6 · 旋律配和弦</h2>
        <p className="help">
          {hasMelodyText && !timed
            ? '這段旋律是手動輸入的，沒有節奏資料，不知道哪幾個音屬於同一個和弦。請用上面的「哼唱錄入旋律」重新錄，並選「取代原旋律」。'
            : timed
              ? '至少要有 3 個音才能配和弦。'
              : '用上面的「哼唱錄入旋律」哼一段旋律，這裡會依你哼的節奏，幫你每小節配上和弦。'}
        </p>
      </section>
    );
  }

  const beat = 60 / bpm;
  const winBeats = beatsPerBar / chordsPerBar;
  const melodyEnd = Math.max(...timed.map((n) => n.startSec + n.durSec));
  /** 第 i 個窗的和弦從哪裡開始（第一個和弦從旋律開頭起，涵蓋弱起） */
  const startOf = (i: number) => (i === 0 ? 0 : pickupBeats * beat + i * winBeats * beat);

  const play = () => {
    const chords = chosen.map((_, i) => ({
      midis: fretsToNotes(voicings[i] ?? []).map((n) => n.midi),
      startSec: startOf(i),
      durSec: (i + 1 < chosen.length ? startOf(i + 1) : Math.max(melodyEnd, startOf(i) + winBeats * beat)) - startOf(i),
    }));
    const total = playArrangement(timed, chords);
    setPlaying(true);
    window.setTimeout(() => setPlaying(false), total * 1000 + 400);
  };

  const adopt = (mode: 'append' | 'replace') => {
    onAdopt(voicings, mode);
    setAdopted(`已把 ${voicings.length} 個和弦${mode === 'replace' ? '取代進' : '加進'}這個段落的和弦進行`);
  };

  const numberField = (id: string, label: string, value: number, min: number, max: number, on: (n: number) => void) => (
    <div className="hz-field">
      <label className="field" htmlFor={id}>{label}</label>
      <input id={id} type="number" className="input input-sm mono" min={min} max={max} value={value}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) on(Math.max(min, Math.min(max, Math.round(n)))); }} />
    </div>
  );

  const segmented = <T extends number>(label: string, options: { v: T; text: string }[], value: T, on: (v: T) => void) => (
    <div className="hz-field" role="group" aria-label={label}>
      <span className="field">{label}</span>
      <div className="row">
        {options.map((o) => (
          <button key={o.v} type="button" className={`btn btn-sm ${value === o.v ? 'is-active' : ''}`} aria-pressed={value === o.v} onClick={() => on(o.v)}>
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <section className="panel" aria-labelledby="h-harm">
      <h2 id="h-harm">6 · 旋律配和弦</h2>
      <p className="help">
        依你哼的節奏把旋律切成小節，每小節挑出最能撐住旋律音的和弦，再讓整串和弦走得順。速度是從你的節奏估計的，不準請直接改。
      </p>

      <p className="key-line">
        <span className="key-name">{speller(key.tonic)} {modeName(key.mode)}</span>
        <span className="conf">{keyLock ? '已手動鎖定' : `從旋律推論，把握度${(melodyKeys[0]?.confidence ?? 0) > 0.5 ? '高' : (melodyKeys[0]?.confidence ?? 0) > 0.2 ? '中' : '低（可手動指定）'}`}</span>
      </p>
      <div className="row wrap" role="group" aria-label="選擇調性">
        {melodyKeys.map((k) => {
          const on = k.tonic === key.tonic && k.mode === key.mode;
          return (
            <button key={`${k.tonic}-${k.mode}`} type="button" className={`btn btn-sm ${on ? 'is-active' : ''}`} aria-pressed={on}
              onClick={() => onLockKey({ tonic: k.tonic, mode: k.mode })}>
              {spellerForKey(k.tonic, k.mode)(k.tonic)} {modeName(k.mode)}
            </button>
          );
        })}
        <button type="button" className="btn btn-sm btn-ghost" disabled={!keyLock} onClick={() => onLockKey(null)}>自動判斷</button>
      </div>

      <div className="hz-settings">
        {numberField('hz-bpm', '速度 BPM', bpm, 40, 200, setBpm)}
        {segmented('拍號', [{ v: 4 as 3 | 4, text: '4/4' }, { v: 3 as 3 | 4, text: '3/4' }], beatsPerBar, setBeatsPerBar)}
        {segmented('弱起拍數', [0, 1, 2, 3].map((v) => ({ v, text: String(v) })), pickupBeats, setPickupBeats)}
        {segmented('每小節換和弦', [{ v: 1 as 1 | 2, text: '1 次' }, { v: 2 as 1 | 2, text: '2 次' }], chordsPerBar, setChordsPerBar)}
      </div>

      <div className="row wrap">
        <button type="button" className="btn btn-primary" onClick={play}>▶ 旋律＋和弦</button>
        <button type="button" className="btn btn-ghost" disabled={!playing} onClick={() => { stopArrangement(); setPlaying(false); }}>■ 停止</button>
      </div>

      <ol className="hz-list">
        {result.windows.map((w, i) => {
          const picked = chosen[i] as ChordChoice;
          const label = chordsPerBar === 2 ? `第 ${w.bar + 1} 小節 ${w.startBeat % beatsPerBar === 0 ? '前半' : '後半'}` : `第 ${w.bar + 1} 小節`;
          const notes = w.notes.filter((n) => n.weight >= 0.5).map((n) => midiName(n.midi, speller));
          return (
            <li key={i} className="hz-card">
              <div className="hz-head">
                <span className="hz-bar">{label}</span>
                <span className="hz-notes mono">{w.empty ? '（休止，沿用上一個和弦）' : notes.join(' ')}</span>
              </div>
              <div className="card-chord">
                <span className="card-name">{chordSymbol(picked, speller)}</span>
                <span className="chip-roman">{picked.roman}</span>
                <span className={`tag tag-${picked.tag}`}>{TAG_LABEL[picked.tag]}</span>
              </div>
              {!w.empty && (
                <div className="row wrap" role="group" aria-label={`${label}的和弦選擇`}>
                  {(result.choices[i] as ChordChoice[]).map((c, k) => (
                    <button key={`${c.rootPc}-${c.qualityId}`} type="button"
                      className={`btn btn-sm ${(picks[i] ?? 0) === k ? 'is-active' : ''}`} aria-pressed={(picks[i] ?? 0) === k}
                      onClick={() => setPicks((p) => ({ ...p, [i]: k }))}>
                      {chordSymbol(c, speller)}
                      {k === 0 && <span className="hz-best"> 推薦</span>}
                    </button>
                  ))}
                </div>
              )}
              <details className="hz-tab">
                <summary>指法</summary>
                <pre className="tab mono" aria-label={`${chordSymbol(picked, speller)} 的 Tab 譜`}>{formatTab(voicings[i] ?? [])}</pre>
              </details>
            </li>
          );
        })}
      </ol>

      <div className="row wrap">
        {hasChords ? (
          <>
            <button type="button" className="btn btn-primary" onClick={() => adopt('append')}>接在現有和弦後面</button>
            <button type="button" className="btn" onClick={() => adopt('replace')}>取代現有和弦</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => adopt('append')}>採用這 {voicings.length} 個和弦</button>
        )}
      </div>
      {adopted && <p className="notice" role="status">{adopted}，往上看第 2 區。</p>}
    </section>
  );
}
