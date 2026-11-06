import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { playChords, playTimedChords } from '../audio/pluck';
import { TIMBRES, getSoundState, setTimbre, subscribe, type Timbre } from '../audio/sound';
import {
  BPM_RANGE,
  DEFAULT_BEATS,
  addSection,
  duplicateSection,
  linkedSections,
  moveSectionTo,
  songLength,
  unlinkSection,
  analyzeProgression,
  beatsOf,
  bpmOf,
  analyzeSection,
  analyzeVoicing,
  chordSymbol,
  contrastCheck,
  contrastReference,
  findChromaticLines,
  formatFrets,
  fretsToNotes,
  labelName,
  melodyRange,
  mergeMelody,
  midiName,
  midisOf,
  newId,
  notesToMelodyText,
  parseMelodyText,
  removeSection,
  sectionNames,
  spellerForKey,
  STANDARD_TUNING,
  timedMelodyOf,
  transition,
  updateSection,
  verseGuidance,
  voiceAfter,
  voicingChoices,
  type ChordFunctionInfo,
  type ChordRef,
  type Fret,
  type Idea,
  type Motion,
  type ProgressionItem,
  type SectionLabel,
  type Suggestion,
  type VoicingStyle,
  suggestNext,
} from '../core';
import { useIdeaStore, type SaveState } from '../store/useIdeaStore';
import { BackupPanel } from './BackupPanel';
import { ChordImportPanel } from './ChordImportPanel';
import { ChordInspector } from './ChordInspector';
import { ChordPalette } from './ChordPalette';
import { HarmonizePanel } from './HarmonizePanel';
import { HumRecorder } from './HumRecorder';
import { SongSidebar, formatDuration } from './SongSidebar';
import { SongStructure } from './SongStructure';
import { SoundPanel } from './SoundPanel';
import { Timeline } from './Timeline';
import { UndoToast } from './UndoToast';
import { usePlayback, type PlanItem } from './usePlayback';

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
const STYLE_KEY = 'guitar-idea-pad.voicingStyle';

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

function readStyle(): VoicingStyle {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    if (v === 'electric' || v === 'open') return v;
  } catch {
    /* 忽略 */
  }
  return 'electric';
}

const midisOfFrets = (f: Fret[]) => fretsToNotes(f).map((n) => n.midi);

function saveText(state: SaveState, persistent: boolean): string {
  if (!persistent) return '無法儲存到本機，內容只暫存在這個分頁';
  switch (state) {
    case 'saving':
      return '儲存中…';
    case 'saved':
      return '已儲存在這台裝置';
    case 'error':
      return '儲存失敗，請稍後再試';
    default:
      return '';
  }
}

export function App() {
  const store = useIdeaStore();
  if (!store.ready || !store.active) {
    return (
      <div className="app">
        <p className="loading" role="status">載入你的歌…</p>
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
  /** 時間軸上選中的和弦；null 代表「自己按一個新和弦」 */
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Fret[]>(EMPTY);
  const [style, setStyleState] = useState<VoicingStyle>(readStyle);
  const [loop, setLoop] = useState(false);
  const [notice, setNotice] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const playback = usePlayback();
  const sound = useSyncExternalStore(subscribe, getSoundState);

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

  // 換段落就取消選取
  useEffect(() => {
    setSelId(null);
    setNotice('');
  }, [section.id]);

  // 整首播放時，畫面跟著切到正在播的段落
  useEffect(() => {
    if (playback.mode === 'song' && playback.pos && playback.pos.sectionId !== section.id) setSectionId(playback.pos.sectionId);
  }, [playback.mode, playback.pos, section.id]);

  const items = section.progression;
  const locked = section.keyLock;
  const selIndex = items.findIndex((x) => x.id === selId);
  const selected = selIndex >= 0 ? items[selIndex] : undefined;
  /** 新和弦插在哪裡：選中的和弦後面，沒選就加在最後 */
  const insertAt = selected ? selIndex + 1 : items.length;

  // 只在和弦或鎖定的調改變時重新分析；打旋律時 section 物件也會換新，但和弦分析不需要重算
  const sa = useMemo(
    () => analyzeSection({ ...section, melody: '' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section.progression, section.keyLock],
  );
  const { analyzed, chords: refs, keys, key } = sa;
  const speller = useMemo(() => spellerForKey(key?.tonic ?? 0, key?.mode ?? 'major'), [key?.tonic, key?.mode]);
  const infos = useMemo(() => (key ? analyzeProgression(refs, key) : []), [refs, key]);
  const infoAt = (i: number) => {
    const best = analyzed[i]?.best;
    return best ? infos[refs.indexOf(best)] : undefined;
  };

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
  const before = useMemo(() => analyzed.slice(0, insertAt), [analyzed, insertAt]);
  const suggestions = useMemo(
    () => (key && before.length ? suggestNext(before, key, deferredLastMelody) : []),
    [before, key, deferredLastMelody],
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

  const setStyle = (s: VoicingStyle) => {
    try {
      localStorage.setItem(STYLE_KEY, s);
    } catch {
      /* 忽略 */
    }
    setStyleState(s);
  };

  const label = (c: ChordRef | undefined) => (c ? chordSymbol(c, speller) : '?');
  const setItems = (next: ProgressionItem[]) => patch({ progression: next });
  const updateItem = (id: string, p: Partial<ProgressionItem>) => setItems(items.map((x) => (x.id === id ? { ...x, ...p } : x)));

  /** 在插入點加入一個和弦（指法），選取它並刷一下讓使用者聽到 */
  const insert = (f: Fret[], beats?: number) => {
    const it: ProgressionItem = { id: newId('c'), frets: [...f], ...(beats ? { beats } : {}) };
    setItems([...items.slice(0, insertAt), it, ...items.slice(insertAt)]);
    setSelId(it.id);
    setNotice('');
    playChords([midisOfFrets(f)], 1.4);
  };
  const addChord = (ch: ChordRef) => {
    const prev = items[insertAt - 1]?.frets;
    const f = voiceAfter(prev, ch, style);
    if (!f) return setNotice(`${chordSymbol(ch)} 找不到好按的指法，換個寫法或改用「在指板上自己按」`);
    insert(f);
  };
  const addSuggestion = (s: Suggestion) => insert(voiceAfter(items[insertAt - 1]?.frets, s.chord, style) ?? s.frets);
  const playSuggestion = (s: Suggestion) => {
    const prev = items[insertAt - 1];
    const beat = 60 / bpmOf(section);
    const f = voiceAfter(prev?.frets, s.chord, style) ?? s.frets;
    const prevDur = prev ? beatsOf(prev) : 0;
    playTimedChords([
      ...(prev ? [{ midis: midisOfFrets(prev.frets), startSec: 0, durSec: prevDur * beat }] : []),
      { midis: midisOfFrets(f), startSec: prevDur * beat, durSec: DEFAULT_BEATS * beat },
    ]);
  };

  const remove = (id: string) => {
    const i = items.findIndex((x) => x.id === id);
    const next = items.filter((x) => x.id !== id);
    withUndo(`已刪除 ${label(analyzed[i]?.best)}`, { progression: next });
    setSelId(next[i]?.id ?? next[i - 1]?.id ?? null);
  };
  const move = (dir: -1 | 1) => {
    const j = selIndex + dir;
    if (selIndex < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[selIndex], next[j]] = [next[j] as ProgressionItem, next[selIndex] as ProgressionItem];
    setItems(next);
  };

  // 換按法：同一個和弦的常用按法輪流換
  const selRef = selected ? analyzeVoicing(selected.frets).best : undefined;
  const shapes = useMemo(() => (selRef ? voicingChoices(selRef, style, 8).map((v) => v.frets) : []), [selRef?.rootPc, selRef?.qualityId, selRef?.bassPc, style]); // eslint-disable-line react-hooks/exhaustive-deps
  const shapeIndex = selected ? shapes.findIndex((f) => formatFrets(f) === formatFrets(selected.frets)) : -1;
  const shapeInfo = selected && shapes.length ? { index: Math.max(0, shapeIndex), count: shapeIndex >= 0 ? shapes.length : shapes.length + 1 } : undefined;
  const nextShape = () => {
    if (!selected || !shapes.length) return;
    const f = shapes[(shapeIndex + 1) % shapes.length] as Fret[];
    updateItem(selected.id, { frets: [...f] });
    playChords([midisOfFrets(f)], 1.4);
  };

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

  const planOf = (s: Idea['sections'][number]): PlanItem[] =>
    s.progression.map((it) => ({ sectionId: s.id, itemId: it.id, midis: midisOfFrets(it.frets), beats: beatsOf(it), beatSec: 60 / bpmOf(s) }));
  const playSection = () => playback.play(planOf(section), { loop, mode: 'section' });
  const playSong = () => playback.play(idea.sections.flatMap(planOf), { mode: 'song' });
  const songHasChords = idea.sections.some((s) => s.progression.length > 0);

  const songLen = songLength(idea);
  const linkedNames = linkedSections(idea, section.id).filter((s) => s.id !== section.id).map((s) => names[s.id] ?? '');
  const blocks = useMemo(
    () =>
      idea.sections.map((s) => {
        const a = analyzeSection({ ...s, melody: '' });
        const sp = a.key ? spellerForKey(a.key.tonic, a.key.mode) : undefined;
        const chordNames = a.analyzed.map((c) => (c.best ? chordSymbol(c.best, sp) : '?'));
        return {
          id: s.id,
          name: names[s.id] ?? '',
          label: s.label,
          bars: s.progression.reduce((n, it) => n + beatsOf(it), 0) / 4,
          summary: chordNames.slice(0, 4).join(' ') + (chordNames.length > 4 ? ' …' : ''),
          linkedWith: linkedSections(idea, s.id).filter((x) => x.id !== s.id).map((x) => names[x.id] ?? ''),
        };
      }),
    // names 由 idea 推導
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idea.sections],
  );
  const selectSection = (id: string) => {
    setSectionId(id);
    if (playback.mode === 'section') playback.stop();
  };

  const totalBeats = items.reduce((n, it) => n + beatsOf(it), 0);
  const bars = totalBeats / 4;
  const sectionName = names[section.id] ?? '';
  const selInfo = selected ? infoAt(selIndex) : undefined;
  const insertHint = selected
    ? `會加在第 ${selIndex + 1} 個（${label(analyzed[selIndex]?.best)}）後面`
    : `會加在${sectionName}的最後`;

  // 旋律文字被手動改過、和錄音時的節奏對不上（節奏資料還在，只是暫時不能用）
  const timingBroken = !!section.melodyTimed?.length && !timed;
  const showContrastHint = !ref && (section.label === 'verse' || section.label === 'prechorus');

  return (
    <div className="shell">
      <SongSidebar
        ideas={ideas}
        currentId={idea.id}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onSelect={store.selectIdea}
        onNew={store.newIdea}
        onDuplicate={store.duplicateIdea}
        onDelete={(id) => void store.removeIdea(id)}
      >
        <SoundPanel />
        <BackupPanel ideas={ideas} current={idea} onImport={store.importIdeas} />
      </SongSidebar>

      <div className="app">
      <header className="song-head">
        <button type="button" className="btn btn-sm btn-ghost nav-btn" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
          ☰ 我的歌
        </button>
        <div className="song-title">
          <label className="sr-only" htmlFor="idea-title">歌名</label>
          <input
            id="idea-title"
            className="song-name"
            value={idea.title}
            maxLength={60}
            onChange={(e) => store.updateActive((i) => ({ ...i, title: e.target.value, updatedAt: Date.now() }))}
            onBlur={(e) => {
              if (!e.target.value.trim()) store.updateActive((i) => ({ ...i, title: '未命名歌曲', updatedAt: Date.now() }));
            }}
            autoComplete="off"
          />
          <p className="song-meta">
            {idea.sections.length} 個段落
            {songLen.beats > 0 && ` · ${Math.round(songLen.beats / 4)} 小節 · 約 ${formatDuration(songLen.seconds)}`}
            <span className="save" role="status">{saveText(saveState, persistent)}</span>
          </p>
        </div>
        {playback.mode === 'song' ? (
          <button type="button" className="btn btn-primary" onClick={playback.stop}>■ 停止</button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!songHasChords} onClick={playSong}>▶ 整首播放</button>
        )}
      </header>

      <SongStructure
        blocks={blocks}
        activeId={section.id}
        playingId={playback.pos?.sectionId ?? null}
        onSelect={selectSection}
        onMoveTo={(id, to) => store.updateActive((i) => moveSectionTo(i, id, to))}
        onAdd={(l: SectionLabel) => {
          const r = addSection(idea, l);
          store.updateActive(() => r.idea);
          setSectionId(r.section.id);
        }}
        onRelabel={(l) => patch({ label: l })}
        onRepeat={(linked) => {
          const r = duplicateSection(idea, section.id, linked);
          if (!r) return;
          store.updateActive(() => r.idea);
          setSectionId(r.section.id);
        }}
        onUnlink={() => store.updateActive((i) => unlinkSection(i, section.id))}
        onDelete={() => {
          const idx = idea.sections.findIndex((s) => s.id === section.id);
          const fallback = idea.sections[idx + 1] ?? idea.sections[idx - 1];
          const before = idea;
          const after = removeSection(idea, section.id);
          store.updateActive(() => after);
          setUndo({ message: `已刪除${sectionName}`, before, after });
          if (fallback) setSectionId(fallback.id);
        }}
      />

      <main id="section-panel" role="tabpanel" aria-labelledby={`tab-${section.id}`}>
        <section className="panel arrange" aria-labelledby="h-prog">
          <div className="arr-head">
            <h2 id="h-prog">{sectionName}的和弦進行</h2>
            {linkedNames.length > 0 && (
              <span className="linked-note">和 {linkedNames.join('、')} 連動，改這裡會一起改</span>
            )}
            <span className="help arr-meta">
              {items.length ? `${items.length} 個和弦 · ${Number.isInteger(bars) ? bars : bars.toFixed(1)} 小節` : '還沒有和弦'}
            </span>
          </div>

          <div className="transport" role="group" aria-label="播放控制">
            {playback.mode === 'section' ? (
              <button type="button" className="btn btn-primary tp-play" onClick={playback.stop}>■ 停止</button>
            ) : (
              <button type="button" className="btn btn-primary tp-play" disabled={!items.length} onClick={playSection}>
                ▶ 播放{sectionName}
              </button>
            )}
            <button type="button" className={`btn btn-sm ${loop ? 'is-active' : ''}`} aria-pressed={loop} onClick={() => setLoop((l) => !l)}>
              ⟳ 循環
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
            <label className="bpm">
              <span>音色</span>
              <select className="input input-sm tp-timbre" value={sound.timbre} onChange={(e) => setTimbre(e.target.value as Timbre)}>
                {TIMBRES.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          </div>

          <Timeline
            chords={items.map((it, i) => {
              const info = infoAt(i);
              return { id: it.id, name: label(analyzed[i]?.best), roman: info?.roman ?? '', tag: info?.tag, beats: beatsOf(it) };
            })}
            selectedId={selId}
            pos={playback.pos?.sectionId === section.id ? playback.pos : null}
            onSelect={(id) => setSelId((cur) => (cur === id ? null : id))}
            onAdd={() => {
              setSelId(null);
              searchRef.current?.focus();
            }}
            addActive={selId === null}
          />

          {items.length === 0 ? (
            <div className="empty">
              <p>點下面和弦盤裡的和弦就會加進來，也可以貼上 AI 給的和弦進行，或先載入範例聽聽看。</p>
              <button type="button" className="btn btn-sm" onClick={() => patch({ progression: EXAMPLE.map((f) => ({ id: newId('c'), frets: [...f] })) })}>
                載入範例：Fmaj7/C → Fm7 → Em7
              </button>
            </div>
          ) : (
            <div className="arr-foot">
              <span className="help">點方塊看指法、改拍數；方塊越寬拍數越多，每 4 拍一小節。</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => withUndo(`已清空${sectionName}的 ${items.length} 個和弦`, { progression: [] })}>
                清空此段
              </button>
            </div>
          )}
          {notice && <p className="notice err" role="alert">{notice}</p>}
        </section>

        <div className={`work ${selected ? '' : 'is-draft'}`}>
          {selected ? (
            <ChordInspector
              key={selected.id}
              mode="edit"
              index={selIndex}
              frets={selected.frets}
              onFrets={(f) => updateItem(selected.id, { frets: f })}
              speller={key ? speller : undefined}
              roman={selInfo?.roman ?? ''}
              tagText={selInfo ? tagLabel(selInfo) : ''}
              tagClass={`tag-${selInfo?.tag ?? 'chromatic'}`}
              beats={beatsOf(selected)}
              onBeats={(n) => updateItem(selected.id, { beats: n })}
              shape={shapeInfo}
              onNextShape={nextShape}
              onPlay={() => playChords([midisOfFrets(selected.frets)], 1.6)}
              onDelete={() => remove(selected.id)}
              onMove={move}
              canMove={{ left: selIndex > 0, right: selIndex < items.length - 1 }}
              onClose={() => setSelId(null)}
            />
          ) : (
            <ChordInspector
              key="draft"
              mode="draft"
              frets={draft}
              onFrets={setDraft}
              speller={key ? speller : undefined}
              sectionName={sectionName}
              onPlay={() => playChords([midisOfFrets(draft)], 1.6)}
              onAdd={() => insert(draft)}
            />
          )}

          <ChordPalette
            keyInfo={key}
            keyGuesses={keys}
            keyLock={locked}
            onLockKey={(k) => patch({ keyLock: k })}
            speller={speller}
            style={style}
            onStyle={setStyle}
            suggestions={suggestions}
            insertHint={insertHint}
            onAddChord={addChord}
            onPlaySuggestion={playSuggestion}
            onAddSuggestion={addSuggestion}
            onDraft={() => setSelId(null)}
            searchRef={searchRef}
          >
            <ChordImportPanel
              style={style}
              sectionName={sectionName}
              hasChords={items.length > 0}
              beatSec={60 / bpm}
              onPreview={(f) => {
                setSelId(null);
                setDraft(f);
              }}
              onAddHere={(list, mode) => {
                const added = list.map((f) => ({ id: newId('c'), frets: [...f] }));
                if (mode === 'replace' && items.length > 0) {
                  withUndo(`已用 ${added.length} 個貼上的和弦取代原本的 ${items.length} 個`, { progression: added });
                } else patch({ progression: [...items, ...added] });
              }}
              onAddSections={(rows) => {
                let next = idea;
                let first: string | undefined;
                for (const r of rows) {
                  const res = addSection(next, r.label);
                  next = updateSection(res.idea, res.section.id, {
                    progression: r.frets.map((f) => ({ id: newId('c'), frets: [...f] })),
                  });
                  first ??= res.section.id;
                }
                store.updateActive(() => next);
                if (first) setSectionId(first);
              }}
            />
          </ChordPalette>
        </div>

        <section className="more" aria-labelledby="h-more">
          <h2 id="h-more" className="more-title">進階工具</h2>

          <details className="panel fold">
            <summary>聲部動向：每條弦怎麼移動</summary>
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
              <p className="help">至少要有兩個和弦，才能看到每條弦怎麼移動。</p>
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
          </details>

          <details className="panel fold">
            <summary>旋律、哼唱錄音與段落對比</summary>
            <label className="field" htmlFor="melody">
              {sectionName}旋律出現的音（空格分開）
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
                  : '音名加八度，例如 A3、Bb3、F#4；最後一個音會用來挑選下一步建議'}
            </p>

            {timingBroken && (
              <div className="notice warn-notice" role="status">
                <p>旋律被改過，和錄音時記下的節奏對不上，所以暫時不能拿來「配和弦」。錄音的版本還保留著。</p>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => withUndo('已還原成錄音時的旋律', { melody: notesToMelodyText(section.melodyTimed ?? [], speller) })}
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
              <p className="help">這首歌還沒有內容完整的副歌。新增一個「副歌」段落並填入和弦或旋律，這裡就會出現主歌的對比建議。</p>
            )}
            {section.label === 'chorus' && (
              <p className="help">副歌的和弦與旋律音會成為「{labelName('verse')}」的對比基準；切到主歌段落就能看到建議。</p>
            )}
          </details>

          <details className="panel fold">
            <summary>旋律配和弦（用錄下的旋律自動配）</summary>
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
          </details>

        </section>
      </main>
      </div>

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
