import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { playChords, playTimedChords } from '../audio/pluck';
import {
  BPM_RANGE,
  DEFAULT_BEATS,
  addSection,
  addTake,
  harmonizeBarsFlow,
  inferKeyFromMelody,
  checkChordAgainstMelody,
  chordsForMelody,
  melodyIn,
  duplicateSection,
  linkedSections,
  moveSectionTo,
  songLength,
  unlinkSection,
  analyzeProgression,
  beatsOf,
  patternOf,
  STRUM_PATTERNS,
  bpmOf,
  analyzeSection,
  analyzeVoicing,
  chordSymbol,
  contrastCheck,
  contrastReference,
  findChromaticLines,
  fretsToNotes,
  labelName,
  melodyRange,
  midiName,
  midisOf,
  newId,
  notesToMelodyText,
  parseMelodyText,
  removeSection,
  sectionNames,
  spellerForKey,
  STANDARD_TUNING,
  transition,
  updateSection,
  verseGuidance,
  voiceAfter,
  rankShapes,
  type ChordFunctionInfo,
  type ChordRef,
  type BeatNote,
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
import { ChordPalette, type PaletteTab } from './ChordPalette';
import { SectionMenu } from './SectionMenu';
import { SongSidebar, formatDuration } from './SongSidebar';
import { SingAlong } from './SingAlong';
import { SongSheet } from './SongSheet';
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
  const [withMelody, setWithMelody] = useState(true);
  /** 右邊工具欄：唱旋律打開時優先；否則選了和弦就看和弦，沒選就是加和弦 */
  const [singOpen, setSingOpen] = useState(false);
  const [palTab, setPalTab] = useState<PaletteTab>('common');
  /** 選了和弦時也想看完整加和弦盤（新和弦照樣插在選中的後面） */
  const [palOpen, setPalOpen] = useState(false);
  const [singBars, setSingBars] = useState(4);
  /** 播放鍵要播哪裡 */
  const [scope, setScope] = useState<'section' | 'song'>('section');
  const [pasteSeed, setPasteSeed] = useState<{ text: string; n: number } | undefined>();
  const searchRef = useRef<HTMLInputElement>(null);
  const playback = usePlayback();

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

  // 換段落就取消選取（從譜上點和弦過來時，改成選取那個和弦）
  const pendingSel = useRef<string | null>(null);
  useEffect(() => {
    setSelId(pendingSel.current);
    pendingSel.current = null;
    setNotice('');
  }, [section.id]);
  const [view, setView] = useState<'edit' | 'sheet'>('edit');
  const editFromSheet = (sid: string, itemId: string) => {
    setView('edit');
    if (sid === section.id) setSelId(itemId);
    else {
      pendingSel.current = itemId;
      setSectionId(sid);
    }
    requestAnimationFrame(() => document.querySelector('.arrange')?.scrollIntoView?.({ block: 'start' }));
  };

  // 整首播放時，畫面跟著切到正在播的段落
  useEffect(() => {
    if (playback.mode === 'song' && playback.pos && playback.pos.sectionId !== section.id) setSectionId(playback.pos.sectionId);
  }, [playback.mode, playback.pos, section.id]);

  const items = section.progression;
  const locked = section.keyLock;
  const selIndex = items.findIndex((x) => x.id === selId);
  const selected = selIndex >= 0 ? items[selIndex] : undefined;
  // 換選別的和弦（或加完新和弦後選到新的）就回到檢視器
  useEffect(() => setPalOpen(false), [selId]);
  /** 新和弦插在哪裡：選中的和弦後面，沒選就加在最後 */
  const insertAt = selected ? selIndex + 1 : items.length;
  /** 插入點前面的小節只差 2 拍就滿時，新和弦先補 2 拍湊齊；其餘用預設拍數（undefined） */
  const fillBeats = items.slice(0, insertAt).reduce((n, x) => n + beatsOf(x), 0) % 4 === 2 ? 2 : undefined;

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
    const b = beats ?? fillBeats;
    const it: ProgressionItem = { id: newId('c'), frets: [...f], ...(b ? { beats: b } : {}) };
    setItems([...items.slice(0, insertAt), it, ...items.slice(insertAt)]);
    setSelId(it.id);
    setNotice('');
    playChords([midisOfFrets(f)], 1.4);
  };
  /**
   * 新和弦的指法：這段裡已經有同一個和弦就沿用那個按法（彈回同一個和弦時通常按同一個位置），
   * 否則挑跟前一個和弦最好接的。
   */
  const sameChord = (a: ChordRef, b: ChordRef | undefined) =>
    !!b && a.rootPc === b.rootPc && a.qualityId === b.qualityId && a.bassPc === b.bassPc;
  const voiceFor = (ch: ChordRef, prev: Fret[] | undefined, extra: readonly Fret[][] = []): Fret[] | undefined => {
    const known = [...items.map((it) => it.frets), ...extra].find((f) => sameChord(ch, analyzeVoicing(f).best));
    return known ? [...known] : voiceAfter(prev, ch, style);
  };
  const addChord = (ch: ChordRef) => {
    const prev = items[insertAt - 1]?.frets;
    const f = voiceFor(ch, prev);
    if (!f) return setNotice(`${chordSymbol(ch)} 找不到好按的指法，換個寫法或改用「在指板上自己按」`);
    insert(f);
  };
  /** 一次加一串和弦：每個都接著前一個挑最順手的指法，最後選取最後一個 */
  const addChords = (chs: ChordRef[]) => {
    let prev = items[insertAt - 1]?.frets;
    const added: ProgressionItem[] = [];
    const skipped: string[] = [];
    for (const ch of chs) {
      const f = voiceFor(ch, prev, added.map((a) => a.frets));
      if (!f) {
        skipped.push(chordSymbol(ch));
        continue;
      }
      added.push({ id: newId('c'), frets: f, ...(!added.length && fillBeats ? { beats: fillBeats } : {}) });
      prev = f;
    }
    if (!added.length) return setNotice(`${skipped.join('、')} 找不到好按的指法`);
    setItems([...items.slice(0, insertAt), ...added, ...items.slice(insertAt)]);
    setSelId((added[added.length - 1] as ProgressionItem).id);
    setNotice(skipped.length ? `已加入 ${added.length} 個和弦；${skipped.join('、')} 找不到好按的指法，已跳過` : '');
  };
  const addSuggestion = (s: Suggestion) => insert(voiceFor(s.chord, items[insertAt - 1]?.frets) ?? s.frets);
  const playSuggestion = (s: Suggestion) => {
    const prev = items[insertAt - 1];
    const beat = 60 / bpmOf(section);
    const f = voiceFor(s.chord, prev?.frets) ?? s.frets;
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

  /** 拖曳排序：把這個和弦移到第 to 個位置，其他的順位補上，選取不變 */
  const reorder = (id: string, to: number) => {
    const from = items.findIndex((x) => x.id === id);
    if (from < 0 || to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it as ProgressionItem);
    setItems(next);
  };

  // 換按法：同一個和弦的常用按法輪流換
  const selRef = selected ? analyzeVoicing(selected.frets).best : undefined;
  const prevFrets = items[selIndex - 1]?.frets;
  const nextFrets = items[selIndex + 1]?.frets;
  const shapes = useMemo(
    () => (selected && selRef ? rankShapes(selRef, selected.frets, prevFrets, nextFrets, style, 8) : []),
    // 和弦本身、前後和弦或風格變了才重排
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selRef?.rootPc, selRef?.qualityId, selRef?.bassPc, selected?.frets, prevFrets, nextFrets, style],
  );
  const pickShape = (f: Fret[]) => {
    if (!selected) return;
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

  const planOf = (s: Idea['sections'][number]): PlanItem[] => {
    let at = 0;
    return s.progression.map((it) => {
      const sectionBeat = at;
      at += beatsOf(it);
      return { sectionId: s.id, itemId: it.id, midis: midisOfFrets(it.frets), beats: beatsOf(it), beatSec: 60 / bpmOf(s), pattern: patternOf(s), sectionBeat };
    });
  };
  /** 對齊拍點的旋律換成秒（給播放用），offset 是這段在整個播放裡從第幾秒開始 */
  const melodySecs = (s: Idea['sections'][number], offset = 0) =>
    (s.melodyGrid ?? []).map((n) => ({ midi: n.midi, startSec: offset + n.beat * (60 / bpmOf(s)), durSec: n.beats * (60 / bpmOf(s)) }));
  // 有選取和弦時從那個和弦開始播（像 DAW 的播放游標），沒選就從頭
  const playSection = () =>
    playback.play(planOf(section), {
      loop,
      mode: 'section',
      startAt: selIndex >= 0 ? selIndex : 0,
      ...(withMelody ? { melody: melodySecs(section) } : {}),
    });
  const playSong = () => {
    let offset = 0;
    const melody = idea.sections.flatMap((s) => {
      const m = melodySecs(s, offset);
      offset += (s.progression.reduce((n, it) => n + beatsOf(it), 0) * 60) / bpmOf(s);
      return m;
    });
    playback.play(idea.sections.flatMap(planOf), { mode: 'song', ...(withMelody ? { melody } : {}) });
  };
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

  // ── 跟著和弦唱的旋律 ──
  const grid: BeatNote[] = section.melodyGrid ?? [];
  /** 每個和弦從第幾拍開始 */
  const starts = items.reduce<number[]>((acc, _it, i) => [...acc, i === 0 ? 0 : (acc[i - 1] as number) + beatsOf(items[i - 1] as ProgressionItem)], []);
  const melodyAt = (i: number) => melodyIn(grid, starts[i] ?? 0, (starts[i] ?? 0) + beatsOf(items[i] as ProgressionItem));
  const names2 = (ms: readonly number[]) => ms.map((m) => midiName(m, speller)).join('、');
  const gridPatch = (g: BeatNote[]) => {
    const beatSec = 60 / bpm;
    return {
      melodyGrid: g,
      melody: notesToMelodyText(g, speller),
      melodyTimed: g.map((n) => ({ midi: n.midi, startSec: n.beat * beatSec, durSec: n.beats * beatSec })),
    };
  };
  const saveMelody = (g: BeatNote[]) => {
    const { takes: next } = addTake(section, g);
    withUndo(`已錄好${sectionName}的旋律（${g.length} 個音）`, { ...gridPatch(g), melodyTakes: next });
  };
  /** 選中和弦的旋律分析：唱了什麼、合不合、還能配什麼 */
  const selMelody = (() => {
    if (!selected || !selRef || !grid.length) return undefined;
    const notes = melodyAt(selIndex);
    if (!notes.length) return undefined;
    const check = checkChordAgainstMelody(selRef, notes);
    const k = key ?? { tonic: selRef.rootPc, mode: 'major' as const };
    const ideas = chordsForMelody(notes, k, selRef, 4)
      .filter((i) => !(i.chord.rootPc === selRef.rootPc && i.chord.qualityId === selRef.qualityId && i.chord.bassPc === selRef.bassPc))
      .slice(0, 3);
    const beatSec = 60 / bpm;
    const start = starts[selIndex] ?? 0;
    return {
      sung: names2([...new Set(notes.map((n) => n.midi))]),
      fit: check.fit,
      clashText: names2(check.clashes),
      ideas: ideas.map((i) => {
        const f = voiceAfter(prevFrets, i.chord, style) ?? selected.frets;
        return {
          name: chordSymbol(i.chord, speller),
          fit: i.fit,
          onUse: () => {
            withUndo(`已把 ${label(selRef)} 換成 ${chordSymbol(i.chord, speller)}`, {
              progression: items.map((x) => (x.id === selected.id ? { ...x, frets: [...f] } : x)),
            });
            playChords([midisOfFrets(f)], 1.4);
          },
          onHear: () =>
            playback.play(
              [{ ...(planOf(section)[selIndex] as PlanItem), midis: midisOfFrets(f) }],
              { mode: 'section', melody: notes.map((n) => ({ midi: n.midi, startSec: (n.beat - start) * beatSec, durSec: n.beats * beatSec })) },
            ),
        };
      }),
    };
  })();
  const sectionName = names[section.id] ?? '';
  const selInfo = selected ? infoAt(selIndex) : undefined;
  const insertHint = selected
    ? `會加在第 ${selIndex + 1} 個（${label(analyzed[selIndex]?.best)}）後面`
    : `會加在${sectionName}的最後`;

  // 旋律文字被手動改過、和錄音時的節奏對不上（節奏資料還在，只是暫時不能用）
  const showContrastHint = !ref && (section.label === 'verse' || section.label === 'prechorus');

  // ── 右邊工具欄、旋律的幾次錄音、只有旋律還沒配和弦的小節 ──
  const panelMode: 'sing' | 'chord' | 'add' = singOpen ? 'sing' : selected && !palOpen ? 'chord' : 'add';
  const openAdd = (tab: PaletteTab = 'common') => {
    setSingOpen(false);
    setPalOpen(false);
    setSelId(null);
    setPalTab(tab);
  };
  const takes = section.melodyTakes ?? [];
  const takeTime = (t: number) => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  const takeInfos =
    takes.length > 0
      ? takes.map((t, i) => ({
          id: t.id,
          label: `第 ${takes.length - i} 次 · ${takeTime(t.at)}`,
          count: t.notes.length,
          current: JSON.stringify(t.notes) === JSON.stringify(grid),
        }))
      : grid.length
        ? [{ id: 'current', label: '目前的旋律', count: grid.length, current: true }]
        : [];
  const melodyEnd = grid.reduce((e, n) => Math.max(e, n.beat + n.beats), 0);
  const ghostBars = Math.max(0, Math.ceil((melodyEnd - totalBeats) / 4 - 1e-9));
  /** 還沒有和弦時錄音用的「無聲小節」 */
  const silentPlan = (n: number): PlanItem[] =>
    Array.from({ length: n }, (_, i) => ({ sectionId: section.id, itemId: `bar-${i}`, midis: [], beats: 4, beatSec: 60 / bpm, pattern: 'beat', sectionBeat: i * 4 }));
  const recordPlan = () => (items.length ? planOf(section) : silentPlan(singBars));
  const hearTake = (id: string) => hearNotes(takes.find((x) => x.id === id)?.notes ?? grid);
  /** 把一串對齊拍點的音跟這段的和弦一起播（沒有和弦就只放旋律） */
  const hearNotes = (notes: readonly BeatNote[]) => {
    const beatSec = 60 / bpm;
    const n = Math.max(1, Math.ceil(notes.reduce((e, x) => Math.max(e, x.beat + x.beats), 0) / 4));
    playback.play(items.length ? planOf(section) : silentPlan(n), {
      mode: 'section',
      melody: notes.map((x) => ({ midi: x.midi, startSec: x.beat * beatSec, durSec: x.beats * beatSec })),
    });
  };
  /** 依旋律 g，從第 fromBeat 拍起每小節配一個和弦（四拍），接在現有的和弦後面挑順手的按法 */
  const chordsForMelodyBars = (g: readonly BeatNote[], fromBeat: number, n: number): ProgressionItem[] => {
    const k = key ?? inferKeyFromMelody(g.map((x) => ({ midi: x.midi, durSec: x.beats })))[0] ?? { tonic: 0, mode: 'major' as const };
    const refsForBars = harmonizeBarsFlow(g, fromBeat, n, k, analyzed[items.length - 1]?.best);
    let prev = items[items.length - 1]?.frets;
    const added: ProgressionItem[] = [];
    for (const ch of refsForBars) {
      const f = voiceFor(ch, prev, added.map((a) => a.frets));
      if (!f) continue;
      added.push({ id: newId('c'), frets: f, beats: 4 });
      prev = f;
    }
    return added;
  };
  const fillFromMelody = () => {
    const added = chordsForMelodyBars(grid, totalBeats, ghostBars);
    if (!added.length) return;
    withUndo(`已依旋律配上 ${added.length} 小節的和弦`, { progression: [...items, ...added] });
    setSingOpen(false);
    setSelId(added[0]?.id ?? null);
  };
  /** 在和弦輸入框打了一串旋律音：當成這段的旋律；這段還沒有和弦的話，順便每小節配一個 */
  const applyTypedMelody = (g: BeatNote[]) => {
    const { takes: next } = addTake(section, g);
    if (items.length) {
      withUndo(`已把 ${g.length} 個音當成${sectionName}的旋律`, { ...gridPatch(g), melodyTakes: next });
      return;
    }
    const end = g.reduce((e, x) => Math.max(e, x.beat + x.beats), 0);
    const added = chordsForMelodyBars(g, 0, Math.max(1, Math.ceil(end / 4)));
    withUndo(`已把 ${g.length} 個音當成旋律，並配上 ${added.length} 小節的和弦`, { ...gridPatch(g), melodyTakes: next, progression: added });
    setSelId(added[0]?.id ?? null);
  };
  const playNow = () => (scope === 'song' ? playSong() : playSection());
  const canPlay = scope === 'song' ? songHasChords : items.length > 0;
  const moveSectionBy = (dir: -1 | 1) => {
    const idx = idea.sections.findIndex((x) => x.id === section.id);
    store.updateActive((i) => moveSectionTo(i, section.id, idx + dir));
  };

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
      <header className="topbar">
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
            {songLen.beats > 0 ? `${idea.sections.length} 段 · ${Math.round(songLen.beats / 4)} 小節 · 約 ${formatDuration(songLen.seconds)}` : `${idea.sections.length} 段`}
            <span className="save" role="status">{saveText(saveState, persistent)}</span>
          </p>
        </div>

        <div className="transport" role="group" aria-label="播放">
          {playback.mode ? (
            <button type="button" className="btn btn-primary tp-play" onClick={playback.stop}>■ 停止</button>
          ) : (
            <button type="button" className="btn btn-primary tp-play" disabled={!canPlay} onClick={playNow}>
              ▶ {scope === 'song' ? '播放整首' : selIndex > 0 ? `從第 ${selIndex + 1} 個播放` : `播放${sectionName}`}
            </button>
          )}
          <div className="seg seg-sm" role="group" aria-label="播放範圍">
            <button type="button" className={`seg-btn ${scope === 'section' ? 'is-on' : ''}`} aria-pressed={scope === 'section'} onClick={() => setScope('section')}>這段</button>
            <button type="button" className={`seg-btn ${scope === 'song' ? 'is-on' : ''}`} aria-pressed={scope === 'song'} onClick={() => setScope('song')}>整首</button>
          </div>
          <button type="button" className={`btn btn-sm tp-loop ${loop ? 'is-active' : ''}`} aria-pressed={loop} onClick={() => setLoop((l) => !l)} title="循環播放這段">
            ⟳<span className="sr-only">循環</span>
          </button>
          <label className="bpm">
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
              aria-label={`${sectionName}的速度（BPM）`}
            />
            <span aria-hidden="true">BPM</span>
          </label>
        </div>

        <div className="view-switch seg seg-sm no-print" role="group" aria-label="檢視">
          <button type="button" className={`seg-btn ${view === 'edit' ? 'is-on' : ''}`} aria-pressed={view === 'edit'} onClick={() => setView('edit')}>
            編曲
          </button>
          <button type="button" className={`seg-btn ${view === 'sheet' ? 'is-on' : ''}`} aria-pressed={view === 'sheet'} onClick={() => setView('sheet')}>
            譜（和弦＋指法）
          </button>
        </div>
      </header>

      {view === 'sheet' ? (
        <SongSheet idea={idea} names={names} onEdit={editFromSheet} />
      ) : (
      <div className="ws">
      <div className="ws-main">
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
      />

      <main id="section-panel" role="tabpanel" aria-labelledby={`tab-${section.id}`}>
        <section className="panel arrange" aria-labelledby="h-prog">
          <div className="arr-head">
            <h2 id="h-prog">{sectionName}</h2>
            <span className="arr-meta">
              {items.length ? `${items.length} 個和弦 · ${Number.isInteger(bars) ? bars : bars.toFixed(1)} 小節` : '還沒有和弦'}
            </span>
            <label className="arr-pattern">
              <select
                className="input input-sm"
                value={patternOf(section)}
                onChange={(e) => {
                  patch({ pattern: e.target.value as (typeof STRUM_PATTERNS)[number]['id'] });
                  // 播放中換彈法就先停下，按播放再聽新的彈法
                  if (playback.mode === 'section') playback.stop();
                }}
                aria-label={`${sectionName}的彈法`}
                title={STRUM_PATTERNS.find((x) => x.id === patternOf(section))?.hint}
              >
                {STRUM_PATTERNS.map((x) => (
                  <option key={x.id} value={x.id}>彈法：{x.name}</option>
                ))}
              </select>
            </label>
            <SectionMenu
              name={sectionName}
              label={section.label}
              linked={linkedNames.length > 0}
              canMove={{ left: idea.sections[0]?.id !== section.id, right: idea.sections[idea.sections.length - 1]?.id !== section.id }}
              canDelete={idea.sections.length > 1}
              hasChords={items.length > 0}
              onRelabel={(l) => patch({ label: l })}
              onMove={moveSectionBy}
              onRepeat={(linked) => {
                const r = duplicateSection(idea, section.id, linked);
                if (!r) return;
                store.updateActive(() => r.idea);
                setSectionId(r.section.id);
              }}
              onUnlink={() => store.updateActive((i) => unlinkSection(i, section.id))}
              onClear={() => withUndo(`已清空${sectionName}的 ${items.length} 個和弦`, { progression: [] })}
              onDelete={() => {
                const idx = idea.sections.findIndex((x) => x.id === section.id);
                const fallback = idea.sections[idx + 1] ?? idea.sections[idx - 1];
                const before = idea;
                const after = removeSection(idea, section.id);
                store.updateActive(() => after);
                setUndo({ message: `已刪除${sectionName}`, before, after });
                if (fallback) setSectionId(fallback.id);
              }}
            />
          </div>
          {linkedNames.length > 0 && <p className="linked-note">和 {linkedNames.join('、')} 連動，改這裡會一起改</p>}

          <Timeline
            chords={items.map((it, i) => {
              const info = infoAt(i);
              const best = analyzed[i]?.best;
              const check = best && grid.length ? checkChordAgainstMelody(best, melodyAt(i)) : undefined;
              return {
                id: it.id,
                name: label(best),
                roman: info?.roman ?? '',
                tag: info?.tag,
                beats: beatsOf(it),
                fit: check?.fit,
                clashText: check ? names2(check.clashes) : '',
              };
            })}
            melody={grid}
            onReorder={reorder}
            onBeats={(id, n) => updateItem(id, { beats: n })}
            ghostBars={ghostBars}
            selectedId={selId}
            pos={playback.pos?.sectionId === section.id ? playback.pos : null}
            onSelect={(id) => {
              setSingOpen(false);
              setSelId((cur) => (cur === id ? null : id));
            }}
            onAdd={() => openAdd('common')}
            addActive={panelMode === 'add'}
          />

          <div className="arr-actions">
            <button
              type="button"
              className={`btn ${panelMode === 'sing' ? 'is-active' : ''}`}
              onClick={() => {
                setSelId(null);
                setSingOpen(true);
              }}
            >
              <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
              唱旋律
            </button>
            {ghostBars > 0 && (
              <button type="button" className="btn btn-primary" onClick={fillFromMelody}>
                依旋律配上和弦（{ghostBars} 小節）
              </button>
            )}
          </div>

          {items.length === 0 && grid.length === 0 && (
            <div className="empty">
              <p>從右邊點和弦加進來，或按「唱旋律」先把旋律唱下來。</p>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => patch({ progression: EXAMPLE.map((f) => ({ id: newId('c'), frets: [...f] })) })}>
                載入範例聽聽看
              </button>
            </div>
          )}
          {notice && <p className="notice err" role="alert">{notice}</p>}
        </section>

        <details className="more-tools">
          <summary>更多工具：聲部動向、主歌與副歌的對比</summary>
          <div className="more">

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
            <summary>主歌與副歌的對比</summary>
            {myRange ? (
              <p className="help">
                {sectionName}旋律的音域 {midiName(myRange.low, speller)}–{midiName(myRange.high, speller)}，中心音約 {midiName(myRange.median, speller)}。
              </p>
            ) : (
              <p className="help">按「唱旋律」把{sectionName}的旋律唱下來，這裡就會比較主歌和副歌的音域。</p>
            )}
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
                  <p>{refView.name}還沒有旋律，唱下來之後這裡會給出具體的音域範圍。</p>
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
              <p className="help">這首歌還沒有內容完整的副歌。新增一個「副歌」段落並加上和弦或旋律，這裡就會出現主歌的對比建議。</p>
            )}
            {section.label === 'chorus' && (
              <p className="help">副歌的和弦與旋律會成為「{labelName('verse')}」的對比基準；切到主歌段落就能看到建議。</p>
            )}
          </details>

          </div>
        </details>
      </main>
      </div>

      <aside className="ws-side" aria-label="工具">
        {panelMode === 'sing' ? (
          <SingAlong
            key={section.id}
            hasChords={items.length > 0}
            bars={singBars}
            onBars={setSingBars}
            takes={takeInfos}
            onUseTake={(id) => {
              const t = takes.find((x) => x.id === id);
              if (t) patch(gridPatch(t.notes));
            }}
            onHearTake={hearTake}
            onHearNotes={hearNotes}
            onTyped={applyTypedMelody}
            onClose={() => setSingOpen(false)}
            sectionName={sectionName}
            beatSec={60 / bpm}
            totalBeats={items.length ? totalBeats : singBars * 4}
            keyInfo={key}
            speller={speller}
            hasMelody={grid.length > 0}
            start={(o) => playback.play(recordPlan(), { mode: 'section', startAt: 0, ...o })}
            stop={playback.stop}
            onDone={saveMelody}
            onClear={() => withUndo(`已清除${sectionName}的旋律`, { melodyGrid: undefined, melody: '', melodyTimed: undefined, melodyTakes: undefined })}
            withMelody={withMelody}
            onWithMelody={setWithMelody}
          />
        ) : panelMode === 'chord' && selected ? (
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
            shapes={shapes}
            onPickShape={pickShape}
            {...(selMelody ? { melody: selMelody } : {})}
            onPlay={() => playChords([midisOfFrets(selected.frets)], 1.6)}
            next={suggestions.map((s) => ({
              key: s.mood,
              symbol: s.symbol,
              roman: s.roman,
              reason: s.reason,
              onHear: () => playSuggestion(s),
              onInsert: () => addSuggestion(s),
            }))}
            onMoreChords={() => {
              setPalTab('common');
              setPalOpen(true);
            }}
            onDelete={() => remove(selected.id)}
            onMove={move}
            canMove={{ left: selIndex > 0, right: selIndex < items.length - 1 }}
            onClose={() => setSelId(null)}
          />
        ) : (
          <>
          {selected && (
            <button type="button" className="btn btn-sm btn-ghost pal-back" onClick={() => setPalOpen(false)}>
              ← 回到第 {selIndex + 1} 個和弦
            </button>
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
            onAddChords={addChords}
            onMelodyNotes={applyTypedMelody}
            onPasteText={(text) => {
              setPasteSeed((x) => ({ text, n: (x?.n ?? 0) + 1 }));
              setPalTab('type');
            }}
            onPlaySuggestion={playSuggestion}
            onAddSuggestion={addSuggestion}
            searchRef={searchRef}
            tab={palTab}
            onTab={setPalTab}
            board={
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
            }
          >
            <ChordImportPanel
              seed={pasteSeed}
              style={style}
              sectionName={sectionName}
              hasChords={items.length > 0}
              beatSec={60 / bpm}
              onPreview={(f) => {
                setDraft(f);
                setPalTab('board');
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
          </>
        )}
      </aside>
      </div>
      )}
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
