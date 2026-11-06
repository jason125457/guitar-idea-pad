/**
 * 靈感（Idea）→ 段落（Section）→ 和弦進行 的資料結構與純函式。
 * 所有函式都不改動輸入，回傳新物件，方便 React 狀態與測試。
 * 儲存的是原始輸入（指法、旋律音文字）；和弦名稱、調性等一律由引擎重算。
 */
import { analyzeVoicing, MAX_FRET, type AnalyzedChord, type Fret } from './chord';
import { inferKey, type KeyGuess, type Mode } from './key';
import { parseMelodyText } from './structure';

export const SCHEMA_VERSION = 2;

export type SectionLabel = 'intro' | 'verse' | 'prechorus' | 'chorus' | 'interlude' | 'solo' | 'bridge' | 'outro';

export const SECTION_LABELS: { id: SectionLabel; name: string }[] = [
  { id: 'intro', name: '前奏' },
  { id: 'verse', name: '主歌' },
  { id: 'prechorus', name: '預副歌' },
  { id: 'chorus', name: '副歌' },
  { id: 'interlude', name: '間奏' },
  { id: 'solo', name: 'Solo' },
  { id: 'bridge', name: '橋段' },
  { id: 'outro', name: '尾奏' },
];

const LABEL_IDS = new Set<string>(SECTION_LABELS.map((l) => l.id));
export const labelName = (l: SectionLabel): string => SECTION_LABELS.find((x) => x.id === l)?.name ?? l;

export interface ProgressionItem {
  id: string;
  frets: Fret[];
  /** 這個和弦佔幾拍；未設定時視為 DEFAULT_BEATS（4/4 的一小節） */
  beats?: number;
}

export const DEFAULT_BPM = 90;
export const DEFAULT_BEATS = 4;
export const BPM_RANGE: [number, number] = [40, 240];
export const BEAT_CHOICES = [1, 2, 3, 4, 6, 8];

export const beatsOf = (p: Pick<ProgressionItem, 'beats'>): number => p.beats ?? DEFAULT_BEATS;
export const bpmOf = (s: Pick<Section, 'bpm'>): number => s.bpm ?? DEFAULT_BPM;

/** 每個和弦的開始時間與長度（秒），依段落速度與各和弦拍數計算。 */
export function progressionTimeline(
  progression: readonly Pick<ProgressionItem, 'beats'>[],
  bpm: number,
): { startSec: number; durSec: number }[] {
  const beat = 60 / bpm;
  let t = 0;
  return progression.map((p) => {
    const dur = beatsOf(p) * beat;
    const slot = { startSec: t, durSec: dur };
    t += dur;
    return slot;
  });
}

export interface KeyLock {
  tonic: number;
  mode: Mode;
}

/** 帶節奏的旋律音：哼唱錄入時一併記下，用來把旋律配上和弦。 */
export interface TimedNote {
  midi: number;
  /** 相對於旋律開頭（第一個音 = 0） */
  startSec: number;
  durSec: number;
}

export interface Section {
  id: string;
  label: SectionLabel;
  progression: ProgressionItem[];
  /** 使用者手動鎖定的調；null = 自動推論 */
  keyLock: KeyLock | null;
  /** 這個段落的旋律音，空格分開，例如 "A3 B3 D4" */
  melody: string;
  /**
   * 旋律每個音的時間。只有哼唱錄入會產生；手動改過旋律文字後
   * 兩者音高對不上，就視為失效（見 timedMelodyOf）。
   */
  melodyTimed?: TimedNote[];
  /** 播放速度（每分鐘拍數）；未設定時為 DEFAULT_BPM */
  bpm?: number;
  /**
   * 連動群組：同一首歌裡 link 相同的段落是同一段音樂重複出現（例如副歌 1、副歌 2），
   * 改其中一個，和弦、旋律、速度、調性與段落類型會一起改。
   */
  link?: string;
}

/** 連動段落之間共用的內容。 */
const SHARED_KEYS = ['label', 'progression', 'keyLock', 'melody', 'melodyTimed', 'bpm'] as const;

/** 旋律文字與時間資料音高完全對得上才回傳；否則代表旋律被手動改過，時間資料不可信。 */
export function timedMelodyOf(section: Pick<Section, 'melody' | 'melodyTimed'>): TimedNote[] | undefined {
  const t = section.melodyTimed;
  if (!t || t.length === 0) return undefined;
  const midis = parseMelodyText(section.melody).midis;
  return midis.length === t.length && midis.every((m, i) => m === (t[i] as TimedNote).midi) ? t : undefined;
}

/** 空白（秒）：接在既有旋律後面時，兩段之間預留的間隔。 */
export const APPEND_GAP_SEC = 0.8;

/**
 * 把新錄的音接在旋律後面（或取代）。回傳新的 melody 文字與時間資料；
 * 原本旋律沒有時間資料（手動輸入或已失效）時，接上後整段就沒有時間資料。
 */
export function mergeMelody(
  section: Pick<Section, 'melody' | 'melodyTimed'>,
  added: readonly TimedNote[],
  addedText: string,
  mode: 'append' | 'replace',
): { melody: string; melodyTimed: TimedNote[] | undefined } {
  const fresh = added.map((n) => ({ ...n }));
  const existingText = section.melody.trim();
  if (mode === 'replace' || existingText === '') return { melody: addedText, melodyTimed: fresh.length ? fresh : undefined };
  const melody = `${existingText} ${addedText}`.trim();
  const existing = timedMelodyOf(section);
  if (!existing || fresh.length === 0) return { melody, melodyTimed: undefined };
  const last = existing[existing.length - 1] as TimedNote;
  const shift = last.startSec + last.durSec + APPEND_GAP_SEC - (fresh[0] as TimedNote).startSec;
  return {
    melody,
    melodyTimed: [...existing, ...fresh.map((n) => ({ ...n, startSec: n.startSec + shift }))],
  };
}

export interface Idea {
  schema: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sections: Section[];
}

let seq = 0;
export function newId(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${rand}`;
}

export function createSection(label: SectionLabel = 'verse'): Section {
  return { id: newId('s'), label, progression: [], keyLock: null, melody: '' };
}

export function createIdea(title = '未命名歌曲', now = Date.now()): Idea {
  return {
    schema: SCHEMA_VERSION,
    id: newId('i'),
    title,
    createdAt: now,
    updatedAt: now,
    sections: [createSection('verse')],
  };
}

export const touch = (idea: Idea, now = Date.now()): Idea => ({ ...idea, updatedAt: now });

export function addSection(idea: Idea, label: SectionLabel): { idea: Idea; section: Section } {
  const section = createSection(label);
  return { idea: touch({ ...idea, sections: [...idea.sections, section] }), section };
}

/** 連動群組只剩一個段落時，就不算連動了。 */
function dropLonelyLinks(sections: Section[]): Section[] {
  const count = new Map<string, number>();
  for (const s of sections) if (s.link) count.set(s.link, (count.get(s.link) ?? 0) + 1);
  return sections.map((s) => {
    if (!s.link || (count.get(s.link) ?? 0) > 1) return s;
    const { link: _drop, ...rest } = s;
    return rest;
  });
}

/** 至少保留一個段落。 */
export function removeSection(idea: Idea, sectionId: string): Idea {
  if (idea.sections.length <= 1) return idea;
  return touch({ ...idea, sections: dropLonelyLinks(idea.sections.filter((s) => s.id !== sectionId)) });
}

/** 和這個段落連動的所有段落（含自己）；沒有連動時只有自己。 */
export function linkedSections(idea: Idea, sectionId: string): Section[] {
  const s = idea.sections.find((x) => x.id === sectionId);
  if (!s) return [];
  return s.link ? idea.sections.filter((x) => x.link === s.link) : [s];
}

/** 修改段落；共用的內容（和弦、旋律等）會同步到所有連動的段落。 */
export function updateSection(idea: Idea, sectionId: string, patch: Partial<Omit<Section, 'id'>>): Idea {
  const target = idea.sections.find((s) => s.id === sectionId);
  const shared: Partial<Section> = {};
  for (const k of SHARED_KEYS) if (k in patch) (shared as Record<string, unknown>)[k] = patch[k];
  return touch({
    ...idea,
    sections: idea.sections.map((s) => {
      if (s.id === sectionId) return { ...s, ...patch };
      if (target?.link && s.link === target.link) return { ...s, ...shared };
      return s;
    }),
  });
}

/**
 * 重複一個段落，插在它後面。linked = true 時兩者連動（改一個另一個跟著變）；
 * false 時是獨立的複本。
 */
export function duplicateSection(idea: Idea, sectionId: string, linked: boolean): { idea: Idea; section: Section } | undefined {
  const i = idea.sections.findIndex((s) => s.id === sectionId);
  const src = idea.sections[i];
  if (!src) return undefined;
  const link = linked ? (src.link ?? newId('l')) : undefined;
  const { link: _old, ...content } = src;
  const copy: Section = {
    ...content,
    id: newId('s'),
    progression: src.progression.map((p) => ({ ...p, id: newId('c'), frets: [...p.frets] })),
    ...(src.melodyTimed ? { melodyTimed: src.melodyTimed.map((n) => ({ ...n })) } : {}),
    ...(link ? { link } : {}),
  };
  const sections = [...idea.sections];
  if (link) sections[i] = { ...src, link };
  sections.splice(i + 1, 0, copy);
  return { idea: touch({ ...idea, sections: dropLonelyLinks(sections) }), section: copy };
}

/** 取消連動：這個段落保留目前內容，之後各改各的。 */
export function unlinkSection(idea: Idea, sectionId: string): Idea {
  return touch({
    ...idea,
    sections: dropLonelyLinks(
      idea.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const { link: _drop, ...rest } = s;
        return rest;
      }),
    ),
  });
}

/** 把段落移到第 to 個位置（拖曳排序用）。 */
export function moveSectionTo(idea: Idea, sectionId: string, to: number): Idea {
  const i = idea.sections.findIndex((s) => s.id === sectionId);
  const j = Math.max(0, Math.min(idea.sections.length - 1, to));
  if (i < 0 || i === j) return idea;
  const next = [...idea.sections];
  const [s] = next.splice(i, 1);
  next.splice(j, 0, s as Section);
  return touch({ ...idea, sections: next });
}

export function moveSection(idea: Idea, sectionId: string, dir: -1 | 1): Idea {
  const i = idea.sections.findIndex((s) => s.id === sectionId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= idea.sections.length) return idea;
  const next = [...idea.sections];
  [next[i], next[j]] = [next[j] as Section, next[i] as Section];
  return touch({ ...idea, sections: next });
}

export function duplicateIdea(idea: Idea, now = Date.now()): Idea {
  return {
    ...idea,
    id: newId('i'),
    title: `${idea.title}（複本）`,
    createdAt: now,
    updatedAt: now,
    sections: idea.sections.map((s) => ({
      ...s,
      id: newId('s'),
      progression: s.progression.map((p) => ({ ...p, id: newId('c'), frets: [...p.frets] })),
    })),
  };
}

/** 整首歌的總拍數與長度（秒）；每個段落用自己的速度。 */
export function songLength(idea: Pick<Idea, 'sections'>): { beats: number; seconds: number } {
  let beats = 0;
  let seconds = 0;
  for (const s of idea.sections) {
    const b = s.progression.reduce((n, p) => n + beatsOf(p), 0);
    beats += b;
    seconds += (b * 60) / bpmOf(s);
  }
  return { beats, seconds };
}

/** 段落顯示名稱：同類型有多個時加編號（主歌 1、主歌 2）。 */
export function sectionNames(idea: Idea): Record<string, string> {
  const totals = new Map<SectionLabel, number>();
  for (const s of idea.sections) totals.set(s.label, (totals.get(s.label) ?? 0) + 1);
  const seen = new Map<SectionLabel, number>();
  const out: Record<string, string> = {};
  for (const s of idea.sections) {
    const n = (seen.get(s.label) ?? 0) + 1;
    seen.set(s.label, n);
    out[s.id] = (totals.get(s.label) ?? 0) > 1 ? `${labelName(s.label)} ${n}` : labelName(s.label);
  }
  return out;
}

export interface SectionAnalysis {
  analyzed: AnalyzedChord[];
  /** 辨識得出名稱的和弦（單音等無法辨識的會被略過） */
  chords: NonNullable<AnalyzedChord['best']>[];
  keys: KeyGuess[];
  /** 鎖定的調優先，否則取推論第一名 */
  key: Pick<KeyGuess, 'tonic' | 'mode'> | undefined;
  melodyMidis: number[];
}

export function analyzeSection(section: Section): SectionAnalysis {
  const analyzed = section.progression.map((p) => analyzeVoicing(p.frets));
  const chords = analyzed.map((a) => a.best).filter((b): b is NonNullable<typeof b> => !!b);
  const keys = inferKey(chords);
  return {
    analyzed,
    chords,
    keys,
    key: section.keyLock ?? keys[0],
    melodyMidis: parseMelodyText(section.melody).midis,
  };
}

/** 主歌／預副歌對比所參考的段落：第一個有內容的副歌。 */
export function contrastReference(idea: Idea, section: Section): Section | undefined {
  if (section.label !== 'verse' && section.label !== 'prechorus') return undefined;
  return idea.sections.find((s) => s.label === 'chorus' && s.id !== section.id && (s.progression.length > 0 || s.melody.trim()));
}

// ── 載入資料的驗證與舊版遷移 ──

const isFret = (f: unknown): f is Fret => f === null || (Number.isInteger(f) && (f as number) >= 0 && (f as number) <= MAX_FRET);
const isFrets = (x: unknown): x is Fret[] => Array.isArray(x) && x.length === 6 && x.every(isFret);

const validBeats = (b: unknown): b is number => typeof b === 'number' && Number.isFinite(b) && b >= 0.5 && b <= 32;
const validBpm = (b: unknown): b is number => typeof b === 'number' && Number.isFinite(b) && b >= BPM_RANGE[0] && b <= BPM_RANGE[1];

function normalizeProgression(x: unknown): ProgressionItem[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((p): p is { id?: unknown; frets: Fret[]; beats?: unknown } => typeof p === 'object' && p !== null && isFrets((p as { frets?: unknown }).frets))
    .map((p) => {
      const item: ProgressionItem = { id: typeof p.id === 'string' ? p.id : newId('c'), frets: [...p.frets] };
      if (validBeats(p.beats)) item.beats = p.beats;
      return item;
    });
}

function normalizeSection(x: unknown): Section | undefined {
  if (typeof x !== 'object' || x === null) return undefined;
  const o = x as Record<string, unknown>;
  const lock = o.keyLock as Partial<KeyLock> | null | undefined;
  const keyLock =
    lock && Number.isInteger(lock.tonic) && (lock.mode === 'major' || lock.mode === 'minor')
      ? { tonic: ((lock.tonic as number) % 12 + 12) % 12, mode: lock.mode }
      : null;
  const section: Section = {
    id: typeof o.id === 'string' ? o.id : newId('s'),
    label: typeof o.label === 'string' && LABEL_IDS.has(o.label) ? (o.label as SectionLabel) : 'verse',
    progression: normalizeProgression(o.progression),
    keyLock,
    melody: typeof o.melody === 'string' ? o.melody : '',
  };
  const timed = normalizeTimed(o.melodyTimed);
  if (timed) section.melodyTimed = timed;
  if (validBpm(o.bpm)) section.bpm = Math.round(o.bpm);
  if (typeof o.link === 'string' && o.link) section.link = o.link;
  return section;
}

function normalizeTimed(x: unknown): TimedNote[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const ok = x.filter(
    (n): n is TimedNote =>
      typeof n === 'object' &&
      n !== null &&
      Number.isInteger((n as TimedNote).midi) &&
      (n as TimedNote).midi >= 0 &&
      (n as TimedNote).midi <= 127 &&
      Number.isFinite((n as TimedNote).startSec) &&
      (n as TimedNote).startSec >= 0 &&
      Number.isFinite((n as TimedNote).durSec) &&
      (n as TimedNote).durSec > 0,
  );
  // 有任何一筆壞掉就整份丟掉：只留一部分，時間資料就跟旋律音對不上了
  return ok.length > 0 && ok.length === x.length ? ok.map((n) => ({ midi: n.midi, startSec: n.startSec, durSec: n.durSec })) : undefined;
}

/** 驗證從儲存層讀出的資料；格式不符回傳 undefined，不會丟例外。 */
export function normalizeIdea(x: unknown): Idea | undefined {
  if (typeof x !== 'object' || x === null) return undefined;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return undefined;
  const sections = (Array.isArray(o.sections) ? o.sections : []).map(normalizeSection).filter((s): s is Section => !!s);
  const now = Date.now();
  return {
    schema: SCHEMA_VERSION,
    id: o.id,
    title: typeof o.title === 'string' && o.title.trim() ? o.title : '未命名歌曲',
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : now,
    sections: sections.length ? dropLonelyLinks(sections) : [createSection('verse')],
  };
}

/** v1（localStorage）只有一串和弦：轉成一個含單一主歌段落的靈感。 */
export function migrateLegacyV1(raw: unknown, now = Date.now()): Idea | undefined {
  const progression = normalizeProgression(raw);
  if (progression.length === 0) return undefined;
  const idea = createIdea('匯入的靈感', now);
  return { ...idea, sections: [{ ...createSection('verse'), progression }] };
}

/** 小節裡的一格：哪個和弦、在這小節的第幾拍開始、佔幾拍；continued = 從上一小節延續過來。 */
export interface BarCell {
  itemId: string;
  index: number;
  start: number;
  beats: number;
  continued: boolean;
}

/**
 * 把和弦進行切成小節（給譜面用）：一個和弦跨小節時拆成兩格，第二格標成延續；
 * 最後一小節不滿也照樣列出。
 */
export function layoutBars(progression: readonly ProgressionItem[], beatsPerBar = 4): BarCell[][] {
  const bars: BarCell[][] = [];
  let pos = 0;
  progression.forEach((it, index) => {
    let left = beatsOf(it);
    let continued = false;
    while (left > 1e-9) {
      const bar = Math.floor(pos / beatsPerBar + 1e-9);
      const start = pos - bar * beatsPerBar;
      const take = Math.min(left, beatsPerBar - start);
      (bars[bar] ??= []).push({ itemId: it.id, index, start, beats: take, continued });
      pos += take;
      left -= take;
      continued = true;
    }
  });
  return bars;
}
