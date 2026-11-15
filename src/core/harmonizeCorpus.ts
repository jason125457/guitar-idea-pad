/**
 * 配和弦的驗證語料（測試用 fixture，不給 App 用）：公有領域／傳統旋律＋常見的歌本和弦，每小節一個和弦。
 *
 * 注意：
 *  - 旋律是憑記憶寫的，音高與節奏都是「大致對」，不是照樂譜抄的；弱起音一律拿掉。
 *  - 參考和弦取常見的吉他歌本／教科書配法；一小節裡有兩個和弦時，第一個（第一拍上的）才是參考答案，
 *    第二個只記下來給「小節內任一和弦」那欄用。一小節一個和弦本來就很主觀，數字只能當趨勢看。
 *  - 3/4 的曲子換成 4/4：第一拍拉長成兩拍（0–1 → 0–2），第二、三拍落在第 3、4 拍，一小節還是一個窗。
 *  - split 是先分好的（調參數之前就決定）：train 用來調權重，test 只拿來確認沒有變差。
 */
import { chordPcs, type ChordRef } from './chord';
import type { KeyGuess } from './key';
import { checkChordAgainstMelody, harmonizeBars, harmonizeBarsFlow, melodyIn, type BeatNote } from './melodyFit';
import { mod12, parseNoteName } from './pitch';
import { quality } from './qualities';
import { parseChordSymbol } from './symbol';

export interface CorpusPiece {
  name: string;
  split: 'train' | 'test';
  key: Pick<KeyGuess, 'tonic' | 'mode'>;
  notes: BeatNote[];
  /** 每小節的參考和弦；[0] 是第一拍上的那個，其餘是同小節後面出現的 */
  refs: ChordRef[][];
}

interface RawPiece {
  name: string;
  split: 'train' | 'test';
  /** 以「寫的調」記：tonic 是寫譜時的主音 */
  key: Pick<KeyGuess, 'tonic' | 'mode'>;
  /** 整首移調幾個半音（旋律、和弦、調一起移） */
  shift: number;
  meter: 3 | 4;
  /** 每小節一個字串：「音名:拍數」，r 是休止 */
  bars: string[];
  /** 每小節的參考和弦，空白隔開表示同小節的第二個和弦 */
  refs: string[];
}

const RAW: RawPiece[] = [
  {
    name: 'Ode to Joy',
    split: 'train',
    key: { tonic: 0, mode: 'major' },
    shift: 2, // D 大調
    meter: 4,
    bars: [
      'E4:1 E4:1 F4:1 G4:1', 'G4:1 F4:1 E4:1 D4:1', 'C4:1 C4:1 D4:1 E4:1', 'E4:1.5 D4:0.5 D4:2',
      'E4:1 E4:1 F4:1 G4:1', 'G4:1 F4:1 E4:1 D4:1', 'C4:1 C4:1 D4:1 E4:1', 'D4:1.5 C4:0.5 C4:2',
    ],
    refs: ['C', 'G', 'C', 'G', 'C', 'G', 'C', 'G C'],
  },
  {
    name: 'Twinkle Twinkle',
    split: 'train',
    key: { tonic: 0, mode: 'major' },
    shift: 7, // G 大調
    meter: 4,
    bars: [
      'C4:1 C4:1 G4:1 G4:1', 'A4:1 A4:1 G4:2', 'F4:1 F4:1 E4:1 E4:1', 'D4:1 D4:1 C4:2',
      'G4:1 G4:1 F4:1 F4:1', 'E4:1 E4:1 D4:2', 'G4:1 G4:1 F4:1 F4:1', 'E4:1 E4:1 D4:2',
      'C4:1 C4:1 G4:1 G4:1', 'A4:1 A4:1 G4:2', 'F4:1 F4:1 E4:1 E4:1', 'D4:1 D4:1 C4:2',
    ],
    refs: ['C', 'F C', 'F C', 'G C', 'C F', 'C G', 'C F', 'C G', 'C', 'F C', 'F C', 'G C'],
  },
  {
    name: 'When the Saints',
    split: 'train',
    key: { tonic: 0, mode: 'major' },
    shift: 5, // F 大調
    meter: 4,
    bars: [
      'G4:4', 'r:1 C4:1 E4:1 F4:1', 'G4:4', 'r:1 C4:1 E4:1 F4:1',
      'G4:2 E4:2', 'C4:2 E4:2', 'D4:4', 'r:1 E4:1 E4:1 D4:1',
      'C4:3 C4:1', 'E4:2 G4:1 G4:1', 'F4:4', 'r:2 E4:1 F4:1',
      'G4:2 E4:2', 'E4:2 D4:2', 'C4:4',
    ],
    refs: ['C', 'C', 'C', 'C', 'C', 'C', 'G', 'G', 'C', 'C7', 'F', 'F', 'C', 'G', 'C'],
  },
  {
    name: 'Auld Lang Syne',
    split: 'test',
    key: { tonic: 0, mode: 'major' },
    shift: 5, // F 大調
    meter: 4,
    bars: [
      'C4:1.5 C4:0.5 C4:1 E4:1', 'D4:1.5 C4:0.5 D4:1 E4:1', 'C4:1.5 C4:0.5 E4:1 G4:1', 'A4:3 G4:1',
      'G4:1.5 E4:0.5 E4:1 C4:1', 'D4:1.5 C4:0.5 D4:1 E4:0.5 D4:0.5', 'C4:1.5 A3:0.5 A3:1 G3:1', 'C4:4',
    ],
    refs: ['C', 'G7', 'C', 'F', 'C', 'G7', 'F G', 'C'],
  },
  {
    name: 'Amazing Grace (3/4)',
    split: 'train',
    key: { tonic: 7, mode: 'major' },
    shift: 0, // G 大調
    meter: 3,
    bars: [
      'G4:2 B4:0.5 G4:0.5', 'B4:2 A4:1', 'G4:2 E4:1', 'D4:2 D4:1',
      'G4:2 B4:0.5 G4:0.5', 'B4:2 A4:1', 'D5:3', 'D5:2 B4:1',
      'D5:2 B4:0.5 G4:0.5', 'B4:2 A4:1', 'G4:2 E4:1', 'D4:2 D4:1',
      'G4:2 B4:0.5 G4:0.5', 'B4:2 A4:1', 'G4:3',
    ],
    refs: ['G', 'G G7', 'C', 'G', 'G', 'G', 'D', 'D', 'G', 'G G7', 'C', 'G', 'G Em', 'D', 'G'],
  },
  {
    name: 'Silent Night (3/4)',
    split: 'test',
    key: { tonic: 0, mode: 'major' },
    shift: 0, // C 大調
    meter: 3,
    bars: [
      'G4:1.5 A4:0.5 G4:1', 'E4:3', 'G4:1.5 A4:0.5 G4:1', 'E4:3',
      'D5:2 D5:1', 'B4:3', 'C5:2 C5:1', 'G4:3',
      'A4:2 A4:1', 'C5:1.5 B4:0.5 A4:1', 'G4:1.5 A4:0.5 G4:1', 'E4:3',
      'A4:2 A4:1', 'C5:1.5 B4:0.5 A4:1', 'G4:1.5 A4:0.5 G4:1', 'E4:3',
      'D5:2 D5:1', 'F5:1.5 D5:0.5 B4:1', 'C5:3', 'E5:3',
      'C5:1.5 G4:0.5 E4:1', 'G4:1.5 F4:0.5 D4:1', 'C4:3',
    ],
    refs: ['C', 'C', 'C', 'C', 'G', 'G', 'C', 'C', 'F', 'F', 'C', 'C', 'F', 'F', 'C', 'C', 'G', 'G7', 'C', 'C', 'C', 'G7', 'C'],
  },
  {
    name: 'Jingle Bells (chorus)',
    split: 'train',
    key: { tonic: 7, mode: 'major' },
    shift: 0, // G 大調
    meter: 4,
    bars: [
      'B4:1 B4:1 B4:2', 'B4:1 B4:1 B4:2', 'B4:1 D5:1 G4:1.5 A4:0.5', 'B4:4',
      'C5:1 C5:1 C5:1.5 C5:0.5', 'C5:1 B4:1 B4:1 B4:0.5 B4:0.5', 'B4:1 A4:1 A4:1 B4:1', 'A4:2 D5:2',
      'B4:1 B4:1 B4:2', 'B4:1 B4:1 B4:2', 'B4:1 D5:1 G4:1.5 A4:0.5', 'B4:4',
      'C5:1 C5:1 C5:1.5 C5:0.5', 'C5:1 B4:1 B4:1 B4:0.5 B4:0.5', 'D5:1 D5:1 C5:1 A4:1', 'G4:4',
    ],
    refs: ['G', 'G', 'G', 'G', 'C', 'G', 'A7', 'D7', 'G', 'G', 'G', 'G', 'C', 'G', 'D7', 'G'],
  },
  {
    name: 'Drunken Sailor',
    split: 'train',
    key: { tonic: 2, mode: 'minor' },
    shift: 0, // D 小調（旋律其實是多利安，有 B 還原）
    meter: 4,
    bars: [
      'A4:1 A4:0.5 A4:0.5 A4:1 A4:0.5 A4:0.5', 'A4:1 D4:1 F4:1 A4:1',
      'G4:1 G4:0.5 G4:0.5 G4:1 G4:0.5 G4:0.5', 'G4:1 C4:1 E4:1 G4:1',
      'A4:1 A4:0.5 A4:0.5 A4:1 A4:0.5 A4:0.5', 'A4:1 B4:1 C5:1 D5:1',
      'C5:1 A4:1 G4:1 E4:1', 'D4:2 D4:2',
    ],
    refs: ['Dm', 'Dm', 'C', 'C', 'Dm', 'Dm', 'C', 'Dm'],
  },
  {
    name: 'Greensleeves (3/4)',
    split: 'train',
    key: { tonic: 9, mode: 'minor' },
    shift: 0, // A 小調
    meter: 3,
    bars: [
      'C5:2 D5:1', 'E5:1.5 F5:0.5 E5:1', 'D5:2 B4:1', 'G4:1.5 A4:0.5 B4:1',
      'C5:2 A4:1', 'A4:1.5 G#4:0.5 A4:1', 'B4:2 G#4:1', 'E4:2 A4:1',
      'C5:2 D5:1', 'E5:1.5 F5:0.5 E5:1', 'D5:2 B4:1', 'G4:1.5 A4:0.5 B4:1',
      'C5:1.5 B4:0.5 A4:1', 'G#4:1.5 F#4:0.5 G#4:1', 'A4:3',
    ],
    refs: ['Am', 'C', 'G', 'Em', 'Am', 'F', 'E', 'E', 'Am', 'C', 'G', 'Em', 'Am E', 'E', 'Am'],
  },
  {
    name: 'Korobeiniki',
    split: 'test',
    key: { tonic: 9, mode: 'minor' },
    shift: 0, // A 小調
    meter: 4,
    bars: [
      'E5:1 B4:0.5 C5:0.5 D5:1 C5:0.5 B4:0.5', 'A4:1 A4:0.5 C5:0.5 E5:1 D5:0.5 C5:0.5',
      'B4:1.5 C5:0.5 D5:1 E5:1', 'C5:1 A4:1 A4:2',
      'D5:1.5 F5:0.5 A5:1 G5:0.5 F5:0.5', 'E5:1.5 C5:0.5 E5:1 D5:0.5 C5:0.5',
      'B4:1 B4:0.5 C5:0.5 D5:1 E5:1', 'C5:1 A4:1 A4:2',
    ],
    refs: ['E', 'Am', 'E', 'Am', 'Dm', 'C', 'E', 'Am'],
  },
];

/** 3/4 → 4/4：第一拍拉成兩拍，後兩拍各一拍 */
const from34 = (t: number) => (t <= 1 ? 2 * t : t + 1);

function buildPiece(p: RawPiece): CorpusPiece {
  if (p.bars.length !== p.refs.length) throw new Error(`${p.name}: ${p.bars.length} bars but ${p.refs.length} refs`);
  const notes: BeatNote[] = [];
  p.bars.forEach((bar, b) => {
    let t = 0;
    for (const tok of bar.split(/\s+/)) {
      const [name, len] = tok.split(':') as [string, string];
      const beats = Number(len);
      if (name !== 'r') {
        const midi = parseNoteName(name);
        if (midi === undefined) throw new Error(`${p.name}: bad note ${tok}`);
        const [a, e] = p.meter === 3 ? [from34(t), from34(t + beats)] : [t, t + beats];
        notes.push({ midi: midi + p.shift, beat: b * 4 + a, beats: e - a });
      }
      t += beats;
    }
    if (Math.abs(t - p.meter) > 1e-9) throw new Error(`${p.name}: bar ${b + 1} has ${t} beats`);
  });
  const refs = p.refs.map((r) =>
    r.split(/\s+/).map((sym) => {
      const ch = parseChordSymbol(sym);
      if (!ch) throw new Error(`${p.name}: bad chord ${sym}`);
      return { rootPc: mod12(ch.rootPc + p.shift), qualityId: ch.qualityId, bassPc: mod12(ch.bassPc + p.shift) };
    }),
  );
  return { name: p.name, split: p.split, key: { tonic: mod12(p.key.tonic + p.shift), mode: p.key.mode }, notes, refs };
}

export const CORPUS: CorpusPiece[] = RAW.map(buildPiece);

// ── 評分 ──

const familyOf = (ch: ChordRef) => quality(ch.qualityId).family;
const majorish = (ch: ChordRef) => chordPcs(ch.rootPc, quality(ch.qualityId)).includes(mod12(ch.rootPc + 4));
const minorish = (ch: ChordRef) => !majorish(ch) && chordPcs(ch.rootPc, quality(ch.qualityId)).includes(mod12(ch.rootPc + 3));

/** 根音相同且家族（大／小／屬）相同：C 與 Cmaj7 算對，C 與 C7、C 與 Am 都不算 */
export const familyMatch = (p: ChordRef, r: ChordRef) => p.rootPc === r.rootPc && familyOf(p) === familyOf(r);
/** 根音相同且三度相同：把 G 與 G7 當成同一個（簡單模式本來就不出七和弦） */
export const triadMatch = (p: ChordRef, r: ChordRef) => p.rootPc === r.rootPc && majorish(p) === majorish(r) && minorish(p) === minorish(r);
/** 功能相近：根音相同，或是關係大小調那一對（I/vi、IV/ii、V/iii；小調的 i/III、iv/VI…） */
export function functionMatch(p: ChordRef, r: ChordRef): boolean {
  if (p.rootPc === r.rootPc) return true;
  const pair = (maj: ChordRef, min: ChordRef) => majorish(maj) && minorish(min) && min.rootPc === mod12(maj.rootPc + 9);
  return pair(p, r) || pair(r, p);
}

export type Method = 'greedy' | 'flowSimple' | 'flowColor';
export const METHODS: Method[] = ['greedy', 'flowSimple', 'flowColor'];

export function predict(piece: CorpusPiece, method: Method): ChordRef[] {
  const bars = piece.refs.length;
  if (method === 'greedy') return harmonizeBars(piece.notes, 0, bars, piece.key);
  return harmonizeBarsFlow(piece.notes, 0, bars, piece.key, undefined, 4, method === 'flowSimple' ? 'simple' : 'color');
}

export interface Score {
  bars: number;
  family: number;
  triad: number;
  func: number;
  /** 預測等於同小節任一個參考和弦（以三度比） */
  anyInBar: number;
  clashFree: number;
}

export interface BarResult {
  bar: number;
  ref: ChordRef[];
  pred: ChordRef;
  family: boolean;
  triad: boolean;
  func: boolean;
  clash: boolean;
}

export function scorePiece(piece: CorpusPiece, method: Method): { score: Score; bars: BarResult[] } {
  const pred = predict(piece, method);
  const bars: BarResult[] = piece.refs.map((ref, b) => {
    const p = pred[b] as ChordRef;
    const r = ref[0] as ChordRef;
    const clash = checkChordAgainstMelody(p, melodyIn(piece.notes, b * 4, b * 4 + 4)).fit === 'clash';
    return { bar: b, ref, pred: p, family: familyMatch(p, r), triad: triadMatch(p, r), func: functionMatch(p, r), clash };
  });
  const count = (f: (x: BarResult) => boolean) => bars.filter(f).length;
  return {
    bars,
    score: {
      bars: bars.length,
      family: count((x) => x.family),
      triad: count((x) => x.triad),
      func: count((x) => x.func),
      anyInBar: count((x) => x.ref.some((r) => triadMatch(x.pred, r))),
      clashFree: count((x) => !x.clash),
    },
  };
}

export function sumScores(scores: Score[]): Score {
  const z: Score = { bars: 0, family: 0, triad: 0, func: 0, anyInBar: 0, clashFree: 0 };
  for (const s of scores) for (const k of Object.keys(z) as (keyof Score)[]) z[k] += s[k];
  return z;
}

export function scoreSet(pieces: readonly CorpusPiece[], method: Method): Score {
  return sumScores(pieces.map((p) => scorePiece(p, method).score));
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '-').padStart(5);

/** 可讀的表格：每首曲子 × 每個方法 */
export function corpusReport(pieces: readonly CorpusPiece[] = CORPUS): string {
  const lines: string[] = [];
  const head = `${'piece'.padEnd(24)}${'split'.padEnd(6)}${'method'.padEnd(11)}  fam  triad  func  any  noclash`;
  lines.push(head, '-'.repeat(head.length));
  const row = (label: string, split: string, m: string, s: Score) =>
    `${label.padEnd(24)}${split.padEnd(6)}${m.padEnd(11)}${pct(s.family, s.bars)}${pct(s.triad, s.bars)} ${pct(s.func, s.bars)}${pct(s.anyInBar, s.bars)}   ${pct(s.clashFree, s.bars)}`;
  for (const p of pieces) for (const m of METHODS) lines.push(row(p.name, p.split, m, scorePiece(p, m).score));
  lines.push('-'.repeat(head.length));
  // 參考和弦自己有多少小節「不摩擦」：clash 檢查把正拍上的經過音也算進去，所以歌本答案也不是 100%
  let refOk = 0;
  let refBars = 0;
  for (const p of pieces) {
    p.refs.forEach((ref, b) => {
      refBars++;
      if (checkChordAgainstMelody(ref[0] as ChordRef, melodyIn(p.notes, b * 4, b * 4 + 4)).fit !== 'clash') refOk++;
    });
  }
  lines.push(`reference chords themselves: no clash in ${pct(refOk, refBars).trim()} of ${refBars} bars`);
  for (const split of ['train', 'test', 'all'] as const) {
    const set = pieces.filter((p) => split === 'all' || p.split === split);
    for (const m of METHODS) {
      const s = scoreSet(set, m);
      lines.push(row(`TOTAL ${split} (${s.bars} bars)`, '', m, s));
    }
  }
  return lines.join('\n');
}
