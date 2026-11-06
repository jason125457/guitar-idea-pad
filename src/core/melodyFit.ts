/**
 * 跟著段落唱的旋律（對齊拍點）與和弦之間的關係：
 * 錄音結果吸附到八分音符格、找出跟和弦有半音摩擦的地方、依旋律推薦合的和弦。
 * 純函式，可以直接測試。
 */
import { chordPcs, type ChordRef } from './chord';
import { diatonicChords, scalePcsForKey, type KeyGuess } from './key';
import { mod12, parseNoteName } from './pitch';
import { quality } from './qualities';

/** 對齊在段落拍點上的旋律音：beat 是從段落開頭算的第幾拍。 */
export interface BeatNote {
  midi: number;
  beat: number;
  beats: number;
}

const GRID = 0.5; // 八分音符
const snap = (x: number) => Math.round(x / GRID) * GRID;

/**
 * 把錄到的音（以段落開頭為 0 秒）吸附到八分音符格上；
 * 段落外與太短的音丟掉，吸附後重疊的音讓前一個縮短。
 */
export function quantizeMelody(
  notes: readonly { midi: number; startSec: number; durSec: number }[],
  beatSec: number,
  totalBeats: number,
): BeatNote[] {
  const out: BeatNote[] = [];
  for (const n of [...notes].sort((a, b) => a.startSec - b.startSec)) {
    if (n.durSec < beatSec * GRID * 0.5) continue; // 不到半個八分音符：多半是偵測雜訊，不要吸附成一整格
    const beat = snap(n.startSec / beatSec);
    const end = Math.min(totalBeats, snap((n.startSec + n.durSec) / beatSec));
    if (beat < 0 || beat >= totalBeats || end - beat < GRID - 1e-9) continue;
    const prev = out[out.length - 1];
    if (prev && prev.beat + prev.beats > beat) {
      if (beat - prev.beat < GRID - 1e-9) {
        // 吸到同一格：留比較長的那個
        if (end - beat > prev.beats) out[out.length - 1] = { midi: n.midi, beat, beats: end - beat };
        continue;
      }
      prev.beats = beat - prev.beat;
    }
    out.push({ midi: n.midi, beat, beats: end - beat });
  }
  return out;
}

/** 落在 [start, end) 拍之間的旋律音（裁切到範圍內），strong = 從正拍開始或至少唱滿一拍。 */
export function melodyIn(notes: readonly BeatNote[], start: number, end: number): (BeatNote & { strong: boolean })[] {
  const out: (BeatNote & { strong: boolean })[] = [];
  for (const n of notes) {
    const a = Math.max(start, n.beat);
    const b = Math.min(end, n.beat + n.beats);
    if (b - a <= 1e-9) continue;
    const onBeat = Math.abs(a - Math.round(a)) < 1e-9 && a === n.beat;
    out.push({ midi: n.midi, beat: a, beats: b - a, strong: onBeat || b - a >= 1 });
  }
  return out;
}

export type MelodyFit = 'stable' | 'color' | 'clash';

/** 一個旋律音對和弦：和弦音很穩；9、6（或小和弦的 11）是延伸音，帶色彩；跟和弦音差半音就是摩擦。 */
export function noteAgainstChord(midi: number, ch: Pick<ChordRef, 'rootPc' | 'qualityId'>): MelodyFit {
  const q = quality(ch.qualityId);
  const rel = mod12(midi - ch.rootPc);
  if (q.intervals.includes(rel)) return 'stable';
  const rubs = q.intervals.some((t) => mod12(rel - t) === 1 || mod12(t - rel) === 1);
  const minorish = q.intervals.includes(3);
  const extension = rel === 2 || rel === 9 || (minorish && rel === 5);
  if (extension && !q.intervals.some((t) => mod12(rel - t) === 1)) return 'color';
  return rubs ? 'clash' : 'color';
}

export interface ChordMelodyCheck {
  fit: MelodyFit | undefined;
  /** 有摩擦的旋律音（不重複） */
  clashes: number[];
  /** 0–1，旋律有多少比例落在和弦音上（依長度加權） */
  stableShare: number;
}

/**
 * 這個和弦撐的那幾拍裡，旋律跟它合不合。
 * 只有「在正拍上或唱滿一拍」的摩擦才算數；一閃而過的經過音不算。
 */
export function checkChordAgainstMelody(ch: Pick<ChordRef, 'rootPc' | 'qualityId'>, notes: readonly (BeatNote & { strong: boolean })[]): ChordMelodyCheck {
  if (!notes.length) return { fit: undefined, clashes: [], stableShare: 0 };
  let total = 0;
  let stable = 0;
  const clashes = new Set<number>();
  for (const n of notes) {
    const f = noteAgainstChord(n.midi, ch);
    total += n.beats;
    if (f === 'stable') stable += n.beats;
    if (f === 'clash' && n.strong) clashes.add(n.midi);
  }
  const stableShare = stable / total;
  const fit: MelodyFit = clashes.size ? 'clash' : stableShare >= 0.6 ? 'stable' : 'color';
  return { fit, clashes: [...clashes], stableShare };
}

export interface MelodyChordIdea {
  chord: ChordRef;
  fit: MelodyFit;
  /** 越高越合 */
  score: number;
}

/**
 * 依這幾拍的旋律推薦和弦：調內三和弦與七和弦、加九和弦，再加上目前的和弦本身。
 * 分數看旋律落在和弦音上的比例、有沒有摩擦，同分時偏向跟目前和弦共用較多音的（保留原本的感覺）。
 */
export function chordsForMelody(
  notes: readonly (BeatNote & { strong: boolean })[],
  key: Pick<KeyGuess, 'tonic' | 'mode'>,
  current?: ChordRef,
  limit = 3,
): MelodyChordIdea[] {
  if (!notes.length) return [];
  const pool: ChordRef[] = [...diatonicChords(key), ...diatonicChords(key, true)];
  const scale = scalePcsForKey(key);
  for (const pc of [scale[0], scale[3]]) if (pc !== undefined) pool.push({ rootPc: pc, qualityId: 'add9', bassPc: pc });
  if (current) pool.push(current);

  const near = (c: ChordRef) => {
    if (!current) return 0;
    const a = new Set(chordPcs(c.rootPc, quality(c.qualityId)));
    const shared = chordPcs(current.rootPc, quality(current.qualityId)).filter((p) => a.has(p)).length;
    return shared * 0.04;
  };
  const seen = new Set<string>();
  const ideas: MelodyChordIdea[] = [];
  for (const c of pool) {
    const k = `${c.rootPc}-${c.qualityId}-${c.bassPc}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const check = checkChordAgainstMelody(c, notes);
    if (!check.fit) continue;
    // 七和弦多一個音、比較容易「碰巧」包到旋律，稍微扣一點，讓簡單的和弦有機會排前面
    const extra = quality(c.qualityId).intervals.length > 3 ? 0.05 : 0;
    const score = check.stableShare - check.clashes.length * 0.6 - extra + near(c);
    ideas.push({ chord: c, fit: check.fit, score });
  }
  return ideas.filter((i) => i.fit !== 'clash').sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * 依旋律每小節配一個和弦（給「先唱、還沒有和弦」的小節用）：
 * 每小節取最合的；沒唱的小節沿用前一個；第一小節沒唱時用主和弦。
 */
export function harmonizeBars(
  notes: readonly BeatNote[],
  fromBeat: number,
  bars: number,
  key: Pick<KeyGuess, 'tonic' | 'mode'>,
  prev?: ChordRef,
  beatsPerBar = 4,
): ChordRef[] {
  const tonic: ChordRef = diatonicChords(key)[0] as ChordRef;
  const out: ChordRef[] = [];
  let last = prev;
  for (let b = 0; b < bars; b++) {
    const start = fromBeat + b * beatsPerBar;
    const inBar = melodyIn(notes, start, start + beatsPerBar);
    // 不偏向前一個和弦：一整串都貼著同一個和弦會很悶。差不多合的話，優先換一個
    const ideas = chordsForMelody(inBar, key, undefined, 4);
    const same = (c: ChordRef) => !!last && c.rootPc === last.rootPc && c.qualityId === last.qualityId;
    const top = ideas[0];
    const moving = top && same(top.chord) ? ideas.find((i) => !same(i.chord) && top.score - i.score <= 0.1) : undefined;
    const pick = (moving ?? top)?.chord ?? last ?? tonic;
    out.push(pick);
    last = pick;
  }
  return out;
}

const NOTE_TOKEN = /^[A-Ga-g][#b♯♭]?-?\d$/;

/**
 * 看起來是一串旋律音（音名＋八度，例如「Eb3 B2 E3 F#3」）就轉成旋律，每個音 beatsEach 拍；
 * 不是的話回傳 undefined。B2、C4 這種寫法同時也能讀成和弦（Bsus2），所以至少要兩個音、而且大多數都帶八度數字。
 */
export function melodyFromNoteText(text: string, beatsEach = 1): BeatNote[] | undefined {
  const tokens = text
    .split(/[\s,，、|→>\-–—]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length < 2) return undefined;
  const notes = tokens.filter((t) => NOTE_TOKEN.test(t.normalize('NFKC')));
  if (notes.length < Math.max(2, Math.ceil(tokens.length * 0.6))) return undefined;
  const out: BeatNote[] = [];
  for (const t of notes) {
    const midi = parseNoteName(t);
    if (midi === undefined || midi < 0 || midi > 127) continue;
    out.push({ midi, beat: out.length * beatsEach, beats: beatsEach });
  }
  return out.length >= 2 ? out : undefined;
}

/** 錄到的音為什麼可疑（給使用者確認時看） */
export type SuspectReason = 'out-of-key' | 'blip' | 'octave' | 'range';

/**
 * 找出可能抓錯的音：調外音、跟前一個音只差半音而且很短（多半是滑音或抖動）、
 * 跟前後兩個音都差一個八度以上（八度誤判）、低到或高到不像在唱歌。
 */
export function suspiciousNotes(notes: readonly BeatNote[], key?: Pick<KeyGuess, 'tonic' | 'mode'>): Map<number, SuspectReason> {
  const out = new Map<number, SuspectReason>();
  const scale = key ? new Set(scalePcsForKey(key)) : undefined;
  notes.forEach((n, i) => {
    const prev = notes[i - 1];
    const next = notes[i + 1];
    if (n.midi < 40 || n.midi > 84) out.set(i, 'range');
    else if (prev && next && Math.abs(n.midi - prev.midi) >= 12 && Math.abs(n.midi - next.midi) >= 12) out.set(i, 'octave');
    else if (n.beats <= 0.5 && ((prev && Math.abs(n.midi - prev.midi) === 1) || (next && Math.abs(n.midi - next.midi) === 1))) out.set(i, 'blip');
    else if (scale && !scale.has(mod12(n.midi))) out.set(i, 'out-of-key');
  });
  return out;
}
