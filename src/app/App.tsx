import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { playChords, playTimedChords, stopAll } from '../audio/pluck';
import {
  BEAT_CHOICES,
  BPM_RANGE,
  DEFAULT_BEATS,
  addSection,
  analyzeProgression,
  beatsOf,
  bpmOf,
  progressionTimeline,
  analyzeSection,
  analyzeVoicing,
  chordSymbol,
  chordToneSpeller,
  contrastCheck,
  contrastReference,
  findChromaticLines,
  formatFrets,
  formatTab,
  fretsToNotes,
  labelName,
  melodyRange,
  mergeMelody,
  midiName,
  midisOf,
  newId,
  notesToMelodyText,
  parseFretInput,
  parseMelodyText,
  removeSection,
  sectionNames,
  moveSection,
  spellerForKey,
  STANDARD_TUNING,
  suggestNext,
  timedMelodyOf,
  transition,
  updateSection,
  verseGuidance,
  type ChordFunctionInfo,
  type ChordRef,
  type Fret,
  type Idea,
  type Mode,
  type Motion,
  type SectionLabel,
  type Suggestion,
} from '../core';
import { useIdeaStore, type SaveState } from '../store/useIdeaStore';
import { BackupPanel } from './BackupPanel';
import { Fretboard } from './Fretboard';
import { HarmonizePanel } from './HarmonizePanel';
import { HumRecorder } from './HumRecorder';
import { IdeaBar } from './IdeaBar';
import { SoundPanel } from './SoundPanel';
import { UndoToast } from './UndoToast';

const EMPTY: Fret[] = [null, null, null, null, null, null];
const EXAMPLE: Fret[][] = [
  [8, 8, 10, 9, 10, 8],
  [8, 8, 10, 8, 9, 8],
  [7, 7, 9, 7, 8, 7],
];
const STRING_LABELS = ['六弦', '五弦', '四弦', '三弦', '二弦', '一弦'];
const MOTION_LABEL: Record<Motion, string> = {
  'common-tone': '共同音',
  stepwise: '級進',
  planing: '平行移動',
  mixed: '混合',
};
const MOOD_LABEL: Record<Suggestion['mood'], string> = {
  'warm-resolve': '溫暖落地',
  bittersweet: '微酸收尾',
  'neo-soul': 'Neo-Soul',
};

function tagLabel(info: Pick<ChordFunctionInfo, 'tag' | 'detail'>): string {
  switch (info.tag) {
    case 'diatonic':
      return '順階';
    case 'borrowed':
      return (
        {
          'parallel-minor': '借用和弦（平行小調）',
          'parallel-major': '借用和弦（平行大調）',
          neapolitan: '拿坡里和弦（♭II）',
          blues: '藍調屬七',
        } as Record<string, string>
      )[info.detail ?? ''] ?? '借用和弦';
    case 'secondary-dominant':
      return `副屬和弦 ${info.detail ?? ''}`;
    case 'tritone-sub':
      return `三全音替代 ${info.detail ?? ''}`;
    default:
      return '調外和弦';
  }
}

const modeName = (m: Mode) => (m === 'major' ? '大調' : '小調');
const midisOfFrets = (f: Fret[]) => fretsToNotes(f).map((n) => n.midi);

export function App() {
  const store = useIdeaStore();
  if (!store.ready || !store.active) {
    return (
      <div className="app">
        <p className="loading" role="status">載入你的靈感…</p>
      </div>
    );
  }
  return (
    // 切換靈感時整個工作區重建，編輯區與段落選擇都回到乾淨狀態
    <Workspace
      key={store.active.id}
      idea={store.active}
      ideas={store.ideas}
      saveState={store.saveState}
      persistent={!store.loadError}
      store={store}
    />
  );
}

interface WorkspaceProps {
  idea: Idea;
  ideas: Idea[];
  saveState: SaveState;
  persistent: boolean;
  store: ReturnType<typeof useIdeaStore>;
}

function Workspace({ idea, ideas, saveState, persistent, store }: WorkspaceProps) {
  const [sectionId, setSectionId] = useState(idea.sections[0]?.id ?? '');
  const [frets, setFrets] = useState<Fret[]>(EMPTY);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const section = idea.sections.find((s) => s.id === sectionId) ?? (idea.sections[0] as Idea['sections'][number]);
  const names = sectionNames(idea);
  const patch = (p: Parameters<typeof updateSection>[2]) => store.updateActive((i) => updateSection(i, section.id, p));

  // 刪除／清空／取代之後可以復原：記下動作前的整個靈感；之後若又有其他修改就收起提示，避免復原時連帶蓋掉新的修改
  const [undo, setUndo] = useState<{ message: string; before: Idea; after: Idea } | null>(null);
  const withUndo = (message: string, p: Parameters<typeof updateSection>[2]) => {
    const before = idea;
    let after: Idea | undefined;
    store.updateActive((i) => (after = updateSection(i, section.id, p)));
    if (after) setUndo({ message, before, after });
  };
  useEffect(() => {
    if (undo && idea !== undo.after) setUndo(null);
  }, [idea, undo]);

  const items = section.progression;
  const locked = section.keyLock;

  const current = useMemo(() => analyzeVoicing(frets), [frets]);
  // 只在和弦或鎖定的調改變時重新分析；打旋律時 section 物件也會換新，但和弦分析不需要重算
  const sa = useMemo(
    () => analyzeSection({ ...section, melody: '' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section.progression, section.keyLock],
  );
  const { analyzed, chords: refs, keys, key } = sa;
  const speller = useMemo(() => spellerForKey(key?.tonic ?? 0, key?.mode ?? 'major'), [key?.tonic, key?.mode]);
  const infos = useMemo(() => (key ? analyzeProgression(refs, key) : []), [refs, key]);

  const sequence = useMemo(() => items.map((i) => midisOf(i.frets, STANDARD_TUNING)), [items]);
  const transitions = useMemo(
    () => sequence.slice(1).map((m, i) => transition(sequence[i] as (number | null)[], m)),
    [sequence],
  );
  const chromatic = useMemo(() => findChromaticLines(sequence), [sequence]);

  const melody = useMemo(() => parseMelodyText(section.melody), [section.melody]);
  const timed = useMemo(() => timedMelodyOf(section), [section]);
  const lastMelody = melody.midis[melody.midis.length - 1];
  // 建議卡片用延後的值：打字時先更新輸入框，建議在空檔再重算
  const deferredLastMelody = useDeferredValue(lastMelody);
  const suggestions = useMemo(
    () => (key && analyzed.length ? suggestNext(analyzed, key, deferredLastMelody) : []),
    [analyzed, key, deferredLastMelody],
  );

  // 主歌／預副歌：以同一靈感裡的副歌為對比參考
  const ref = contrastReference(idea, section);
  const refView = useMemo(() => {
    if (!ref) return undefined;
    const a = analyzeSection(ref);
    const k = a.key ?? key;
    if (!k) return undefined;
    const range = melodyRange(a.melodyMidis);
    return { name: names[ref.id] ?? '副歌', range, key: k, guidance: verseGuidance(range, a.chords, k) };
    // names 由 idea 推導，ref 變動時一併重算即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, key]);
  const myRange = melodyRange(melody.midis);

  const updateFrets = (next: Fret[]) => {
    setFrets(next);
    setText(formatFrets(next));
    setError('');
  };

  const onText = (value: string) => {
    setText(value);
    if (!value.trim()) {
      setFrets(EMPTY);
      setError('');
      return;
    }
    const r = parseFretInput(value);
    if (r.ok) {
      setFrets(r.frets);
      setError('');
    } else setError(r.error);
  };

  const add = (f: Fret[]) => patch({ progression: [...items, { id: newId('c'), frets: [...f] }] });
  const label = (c: ChordRef | undefined) => (c ? chordSymbol(c, speller) : '?');
  const remove = (id: string) => {
    const i = items.findIndex((x) => x.id === id);
    withUndo(`已刪除 ${label(analyzed[i]?.best)}`, { progression: items.filter((x) => x.id !== id) });
  };
  // 旋律文字被手動改過、和錄音時的節奏對不上（節奏資料還在，只是暫時不能用）
  const timingBroken = !!section.melodyTimed?.length && !timed;

  // 速度輸入框：打字時先存文字，離開或按 Enter 才寫回（避免輸入「1」時就被夾成 40）
  const bpm = bpmOf(section);
  const [bpmText, setBpmText] = useState(String(bpm));
  useEffect(() => setBpmText(String(bpm)), [bpm, section.id]);
  const commitBpm = () => {
    const n = Math.round(Number(bpmText));
    if (!Number.isFinite(n) || bpmText.trim() === '') return setBpmText(String(bpm));
    const clamped = Math.min(BPM_RANGE[1], Math.max(BPM_RANGE[0], n));
    setBpmText(String(clamped));
    if (clamped !== bpm) patch({ bpm: clamped });
  };
  const playProgression = () => {
    const timeline = progressionTimeline(items, bpm);
    playTimedChords(items.map((it, i) => ({ midis: midisOfFrets(it.frets), ...(timeline[i] as { startSec: number; durSec: number }) })));
  };
  const keyButtons = keys.slice(0, 3);
  const showContrastHint = !ref && (section.label === 'verse' || section.label === 'prechorus');

  return (
    <div className="app">
      <header className="top">
        <h1 className="brand">指板靈感本</h1>
        <p className="tagline">按出來的和弦，直接聽、直接懂、直接接下去</p>
      </header>

      <IdeaBar
        ideas={ideas}
        idea={idea}
        activeSectionId={section.id}
        saveState={saveState}
        persistent={persistent}
        onSelectIdea={store.selectIdea}
        onNewIdea={store.newIdea}
        onDuplicateIdea={store.duplicateIdea}
        onDeleteIdea={(id) => void store.removeIdea(id)}
        onRenameIdea={(title) => store.updateActive((i) => ({ ...i, title, updatedAt: Date.now() }))}
        onSelectSection={setSectionId}
        onAddSection={(l: SectionLabel) => {
          const r = addSection(idea, l);
          store.updateActive(() => r.idea);
          setSectionId(r.section.id);
        }}
        onRelabel={(l) => patch({ label: l })}
        onMove={(dir) => store.updateActive((i) => moveSection(i, section.id, dir))}
        onDeleteSection={() => {
          const idx = idea.sections.findIndex((s) => s.id === section.id);
          const fallback = idea.sections[idx + 1] ?? idea.sections[idx - 1];
          store.updateActive((i) => removeSection(i, section.id));
          if (fallback) setSectionId(fallback.id);
        }}
      />

      <SoundPanel />

      <BackupPanel ideas={ideas} current={idea} onImport={store.importIdeas} />

      <main className="layout" id="section-panel" role="tabpanel" aria-labelledby={`tab-${section.id}`}>
        <section className="panel" aria-labelledby="h-input">
          <h2 id="h-input">1 · 輸入指法</h2>
          <label className="field" htmlFor="fret-text">
            六弦 → 一弦，x 代表悶音
          </label>
          <input
            id="fret-text"
            className="input mono"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="8 8 10 9 10 8"
            value={text}
            onChange={(e) => onText(e.target.value)}
            aria-invalid={!!error}
            aria-describedby="fret-help"
          />
          <p id="fret-help" className={error ? 'help err' : 'help'} role={error ? 'alert' : undefined}>
            {error || '兩位數品格請用空格分開；全是單位數時可連著寫，如 x32010'}
          </p>

          <Fretboard frets={frets} onChange={updateFrets} />

          <div className="now" aria-live="polite">
            {current.best ? (
              <>
                <div className="now-name">{chordSymbol(current.best, key ? speller : undefined)}</div>
                <div className="now-notes mono">
                  {current.notes.map((n) => midiName(n.midi, chordToneSpeller(current.best!, key ? speller : undefined))).join(' ')}
                </div>
                {current.candidates.length > 1 && (
                  <div className="alts">
                    其他可能：
                    {current.candidates.slice(1, 4).map((c) => (
                      <span className="alt" key={`${c.rootPc}-${c.qualityId}`}>
                        {chordSymbol(c, key ? speller : undefined)}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="now-empty">{current.notes.length ? '只有單音，還不能判斷和弦' : '先按幾個音，這裡會顯示和弦名稱'}</div>
            )}
          </div>

          <div className="row">
            <button type="button" className="btn" disabled={!current.notes.length} onClick={() => playChords([midisOfFrets(frets)], 1.6)}>
              ▶ 試聽
            </button>
            <button type="button" className="btn btn-primary" disabled={!current.best} onClick={() => add(frets)}>
              ＋ 加入{names[section.id]}
            </button>
          </div>
        </section>

        <div className="stack">
          <section className="panel" aria-labelledby="h-prog">
            <h2 id="h-prog">2 · {names[section.id]}的和弦進行</h2>
            {items.length === 0 ? (
              <div className="empty">
                <p>這個段落還沒有和弦。左邊輸入指法後按「加入」，或先載入範例看看。</p>
                <button type="button" className="btn" onClick={() => patch({ progression: EXAMPLE.map((f) => ({ id: newId('c'), frets: [...f] })) })}>
                  載入範例：Fmaj7/C → Fm7 → Em7
                </button>
              </div>
            ) : (
              <>
                <ol className="chips">
                  {items.map((it, i) => {
                    const a = analyzed[i];
                    const refIndex = a?.best ? refs.indexOf(a.best) : -1;
                    const info = infos[refIndex];
                    return (
                      <li key={it.id} className="chip">
                        <button type="button" className="chip-main" onClick={() => updateFrets(it.frets)} aria-label={`載入 ${label(a?.best)} 到編輯區`}>
                          <span className="chip-name">{label(a?.best)}</span>
                          <span className="chip-roman">{info?.roman ?? ''}</span>
                          <span className={`tag tag-${info?.tag ?? 'chromatic'}`}>{info ? tagLabel(info) : ''}</span>
                        </button>
                        <label className="chip-beats">
                          <span className="sr-only">{label(a?.best)} 的拍數</span>
                          <select
                            value={beatsOf(it)}
                            onChange={(e) =>
                              patch({ progression: items.map((x) => (x.id === it.id ? { ...x, beats: Number(e.target.value) } : x)) })
                            }
                          >
                            {[...new Set([...BEAT_CHOICES, beatsOf(it)])].sort((p, q) => p - q).map((b) => (
                              <option key={b} value={b}>{b} 拍</option>
                            ))}
                          </select>
                        </label>
                        <button type="button" className="chip-x" onClick={() => remove(it.id)} aria-label={`刪除 ${label(a?.best)}`}>
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <div className="row wrap">
                  <button type="button" className="btn btn-primary" onClick={playProgression}>
                    ▶ 播放進行
                  </button>
                  <label className="bpm">
                    <span>速度</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      className="input input-sm mono"
                      min={BPM_RANGE[0]}
                      max={BPM_RANGE[1]}
                      value={bpmText}
                      onChange={(e) => setBpmText(e.target.value)}
                      onBlur={commitBpm}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitBpm();
                      }}
                      aria-describedby="bpm-unit"
                    />
                    <span id="bpm-unit">BPM</span>
                  </label>
                  <button type="button" className="btn" onClick={stopAll}>
                    ■ 停止
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => withUndo(`已清空${names[section.id]}的 ${items.length} 個和弦`, { progression: [] })}>
                    清空此段
                  </button>
                </div>
              </>
            )}
          </section>

          {key && refs.length > 0 && (
            <section className="panel" aria-labelledby="h-analysis">
              <h2 id="h-analysis">3 · 調性與聲部動向</h2>
              <p className="key-line">
                <span className="key-name">
                  {speller(key.tonic)} {modeName(key.mode)}
                </span>
                {!locked && keys[0] && (
                  <span className="conf">
                    把握度：{keys[0].confidence > 0.5 ? '高' : keys[0].confidence > 0.2 ? '中' : '低（可手動指定）'}
                  </span>
                )}
                {locked && <span className="conf">已手動鎖定</span>}
              </p>
              <div className="row wrap" role="group" aria-label="選擇調性">
                {keyButtons.map((k) => {
                  const active = k.tonic === key.tonic && k.mode === key.mode;
                  return (
                    <button
                      key={`${k.tonic}-${k.mode}`}
                      type="button"
                      className={`btn btn-sm ${active ? 'is-active' : ''}`}
                      aria-pressed={active}
                      onClick={() => patch({ keyLock: { tonic: k.tonic, mode: k.mode } })}
                    >
                      {spellerForKey(k.tonic, k.mode)(k.tonic)} {modeName(k.mode)}
                    </button>
                  );
                })}
                <button type="button" className="btn btn-sm btn-ghost" disabled={!locked} onClick={() => patch({ keyLock: null })}>
                  自動判斷
                </button>
              </div>

              {transitions.length > 0 ? (
                <ul className="vl">
                  {transitions.map((t, i) => (
                    <li key={i}>
                      <div className="vl-head">
                        <span className="mono">
                          {label(analyzed[i]?.best)} → {label(analyzed[i + 1]?.best)}
                        </span>
                        <span className="motion">{MOTION_LABEL[t.motion]}</span>
                      </div>
                      <div className="deltas" aria-label="每條弦的半音位移">
                        {t.stringDeltas.map((d, s) => (
                          <span key={s} className={`delta ${d === null ? 'na' : d === 0 ? 'zero' : d < 0 ? 'down' : 'up'}`}>
                            <span className="delta-s">{STRING_LABELS[s]?.[0]}</span>
                            {d === null ? '–' : d === 0 ? '＝' : d > 0 ? `+${d}` : d}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="help">再加一個和弦，就能看到每條弦怎麼移動。</p>
              )}
              {chromatic.length > 0 && (
                <ul className="finds">
                  {chromatic.map((l, i) => (
                    <li key={i}>
                      <strong>{STRING_LABELS[l.string]}</strong> 出現連續 {l.steps} 步半音{l.direction === 'down' ? '下行' : '上行'}
                      （內聲部半音線條）
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {suggestions.length > 0 && (
            <section className="panel" aria-labelledby="h-next">
              <h2 id="h-next">4 · 下一步怎麼接</h2>
              {lastMelody !== undefined ? (
                <p className="help">已參考這段旋律的最後一個音 {midiName(lastMelody, speller)}。</p>
              ) : (
                <p className="help">在下方填入這段的旋律音，建議會避開與落音的半音摩擦。</p>
              )}
              <ul className="cards">
                {suggestions.map((s) => (
                  <li key={s.mood} className={`card mood-${s.mood}`}>
                    <div className="card-head">
                      <span className="mood">{MOOD_LABEL[s.mood]}</span>
                      <span className="card-title">{s.title}</span>
                    </div>
                    <div className="card-chord">
                      <span className="card-name">{s.symbol}</span>
                      <span className="chip-roman">{s.roman}</span>
                      <span className={`tag tag-${s.tag}`}>{tagLabel({ tag: s.tag })}</span>
                    </div>
                    <p className="card-reason">{s.reason}</p>
                    {s.melodyFit && (
                      <p className={`fit fit-${s.melodyFit}`}>
                        旋律落音：{s.melodyFit === 'chord-tone' ? '是和弦音，很穩' : s.melodyFit === 'extension' ? '是延伸音，帶色彩' : '與和弦音差半音，會有摩擦'}
                      </p>
                    )}
                    <pre className="tab mono" aria-label={`${s.symbol} 的 Tab 譜`}>{formatTab(s.frets)}</pre>
                    <div className="row">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          const last = items[items.length - 1];
                          const beat = 60 / bpmOf(section);
                          const lastDur = last ? beatsOf(last) * beat : 0;
                          playTimedChords([
                            ...(last ? [{ midis: midisOfFrets(last.frets), startSec: 0, durSec: lastDur }] : []),
                            { midis: midisOfFrets(s.frets), startSec: lastDur, durSec: DEFAULT_BEATS * beat },
                          ]);
                        }}
                      >
                        ▶ 接著聽
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => add(s.frets)}>
                        ＋ 採用
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel" aria-labelledby="h-melody">
            <h2 id="h-melody">5 · {names[section.id]}的旋律與段落對比</h2>
            <label className="field" htmlFor="melody">
              這段旋律出現的音（空格分開）
            </label>
            <input
              id="melody"
              className="input mono"
              placeholder="A3 B3 D4 E4 G4 A4 C5"
              value={section.melody}
              onChange={(e) => patch({ melody: e.target.value })}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={melody.invalid.length > 0}
              aria-describedby="melody-help"
            />
            <p id="melody-help" className={melody.invalid.length ? 'help err' : 'help'} role={melody.invalid.length ? 'alert' : undefined}>
              {melody.invalid.length
                ? `看不懂：${melody.invalid.join('、')}。請用 A3、Bb3、F#4 這種寫法`
                : myRange
                  ? `音域 ${midiName(myRange.low, speller)}–${midiName(myRange.high, speller)}，中心音約 ${midiName(myRange.median, speller)}`
                  : '音名加八度，例如 A3、Bb3、F#4；最後一個音會用來挑選銜接和弦'}
            </p>

            {timingBroken && (
              <div className="notice warn-notice" role="status">
                <p>
                  旋律被改過，和錄音時記下的節奏對不上，所以暫時不能拿來「配和弦」。錄音的版本還保留著。
                </p>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    withUndo('已還原成錄音時的旋律', { melody: notesToMelodyText(section.melodyTimed ?? [], speller) })
                  }
                >
                  還原成錄音的旋律
                </button>
              </div>
            )}

            <HumRecorder
              keyInfo={key}
              speller={speller}
              hasMelody={section.melody.trim().length > 0}
              hasTiming={!!timed}
              onAppend={(t, added) => patch(mergeMelody(section, added, t, 'append'))}
              onReplace={(t, added) => withUndo('已用新錄的旋律取代原本的旋律', mergeMelody(section, added, t, 'replace'))}
            />

            {refView && (
              <div className="guide">
                <h3>以「{refView.name}」為對比</h3>
                {refView.guidance.range ? (
                  <p>
                    建議落在 <strong>{refView.guidance.range.low}–{refView.guidance.range.high}</strong>，中心音約{' '}
                    <strong>{refView.guidance.range.target}</strong>，寬度不超過 {refView.guidance.range.maxWidthSemitones} 個半音。
                    別碰{refView.name}的最高音，它要留給{refView.name}。
                  </p>
                ) : (
                  <p>{refView.name}還沒有填旋律音，填了之後這裡會給出具體的音域範圍。</p>
                )}
                {refView.range && myRange && (
                  <ul className="checks" aria-label="與副歌的對比檢查">
                    {contrastCheck(refView.range, myRange, speller).map((c) => (
                      <li key={c.message} className={c.ok ? 'ok' : 'warn'}>
                        <span className="check-mark" aria-hidden="true">{c.ok ? '✓' : '!'}</span>
                        <span className="sr-only">{c.ok ? '通過：' : '注意：'}</span>
                        {c.message}
                      </li>
                    ))}
                  </ul>
                )}
                <h3>和聲色彩</h3>
                <ul>{refView.guidance.harmony.map((h) => <li key={h}>{h}</li>)}</ul>
                <h3>節奏與留白</h3>
                <ul>{refView.guidance.rhythm.map((h) => <li key={h}>{h}</li>)}</ul>
              </div>
            )}
            {showContrastHint && (
              <p className="help">
                這個靈感還沒有內容完整的副歌。新增一個「副歌」段落並填入和弦或旋律，這裡就會出現主歌的對比建議。
              </p>
            )}
            {section.label === 'chorus' && (
              <p className="help">
                副歌的和弦與旋律音會成為「{labelName('verse')}」的對比基準；切到主歌段落就能看到建議。
              </p>
            )}
          </section>

          <HarmonizePanel
            timed={timed}
            hasMelodyText={section.melody.trim().length > 0}
            keyLock={locked}
            hasChords={items.length > 0}
            onLockKey={(k) => patch({ keyLock: k })}
            onAdopt={(adopted, mode, harmonizeBpm) => {
              const added = adopted.map((a) => ({ id: newId('c'), frets: [...a.frets], beats: a.beats }));
              // 段落原本是空的才沿用配和弦時的速度，免得改掉使用者已經設好的速度
              const bpmPatch = items.length === 0 ? { bpm: harmonizeBpm } : {};
              if (mode === 'replace' && items.length > 0) {
                withUndo(`已用 ${added.length} 個新和弦取代原本的 ${items.length} 個`, { progression: added, bpm: harmonizeBpm });
              } else patch({ progression: [...items, ...added], ...bpmPatch });
            }}
          />
        </div>
      </main>

      {undo && (
        <UndoToast
          message={undo.message}
          onUndo={() => {
            const restored = { ...undo.before, updatedAt: Date.now() };
            setUndo(null);
            store.updateActive(() => restored);
          }}
          onClose={() => setUndo(null)}
        />
      )}
    </div>
  );
}
