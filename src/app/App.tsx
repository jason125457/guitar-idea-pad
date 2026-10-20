import { useMemo, useState } from 'react';
import { playChords, stopAll } from '../audio/pluck';
import {
  addSection,
  analyzeProgression,
  analyzeSection,
  analyzeVoicing,
  chordSymbol,
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
      return info.detail === 'parallel-minor' ? '借用和弦（平行小調）' : '借用和弦（平行大調）';
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

  const items = section.progression;
  const locked = section.keyLock;

  const current = useMemo(() => analyzeVoicing(frets), [frets]);
  const sa = useMemo(() => analyzeSection(section), [section]);
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
  const suggestions = useMemo(
    () => (key && analyzed.length ? suggestNext(analyzed, key, lastMelody) : []),
    [analyzed, key, lastMelody],
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
  const remove = (id: string) => patch({ progression: items.filter((x) => x.id !== id) });
  const label = (c: ChordRef | undefined) => (c ? chordSymbol(c, speller) : '?');
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
                  {current.notes.map((n) => `${speller(n.pc)}${Math.floor(n.midi / 12) - 1}`).join(' ')}
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
                        <button type="button" className="chip-x" onClick={() => remove(it.id)} aria-label={`刪除 ${label(a?.best)}`}>
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <div className="row">
                  <button type="button" className="btn btn-primary" onClick={() => playChords(items.map((i) => midisOfFrets(i.frets)))}>
                    ▶ 播放進行
                  </button>
                  <button type="button" className="btn" onClick={stopAll}>
                    ■ 停止
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => patch({ progression: [] })}>
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
                          playChords([...(last ? [midisOfFrets(last.frets)] : []), midisOfFrets(s.frets)]);
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

            <HumRecorder
              keyInfo={key}
              speller={speller}
              hasMelody={section.melody.trim().length > 0}
              hasTiming={!!timed}
              onAppend={(t, added) => patch(mergeMelody(section, added, t, 'append'))}
              onReplace={(t, added) => patch(mergeMelody(section, added, t, 'replace'))}
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
            onAdopt={(voicings, mode) => {
              const added = voicings.map((f) => ({ id: newId('c'), frets: [...f] }));
              patch({ progression: mode === 'replace' ? added : [...items, ...added] });
            }}
          />
        </div>
      </main>
    </div>
  );
}
