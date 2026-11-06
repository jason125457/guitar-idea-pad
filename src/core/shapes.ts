/**
 * 常用和弦按法庫：吉他手實際會按的形狀（開放和弦、E／A 型封閉和弦、三和弦轉位、殼和弦、常見色彩和弦），
 * 每個都附上手指編號。可移動的形狀（沒有空弦）會平移到每個把位。
 *
 * 和弦名稱→指法時先從這裡挑，挑不到才用 voicing.ts 的枚舉，並用 computeFingering 濾掉按不出來的。
 */
import { analyzeVoicing, type ChordRef, type Fret } from './chord';
import { parseChordSymbol } from './symbol';

/** 1 食指、2 中指、3 無名指、4 小指、T 拇指；0 空弦、null 悶音 */
export type Finger = 1 | 2 | 3 | 4 | 'T' | 0 | null;

interface ShapeDef {
  name: string;
  frets: string;
  fingers: string;
  /** 2：要多練一下的形狀，排序時稍微往後 */
  tier?: 2;
}

const s = (name: string, frets: string, fingers: string, tier?: 2): ShapeDef => ({ name, frets, fingers, ...(tier ? { tier } : {}) });

const SHAPE_DEFS: ShapeDef[] = [
  // ── 大三和弦 ──
  s('F', '1 3 3 2 1 1', '1 3 4 2 1 1'), // E 型封閉
  s('C', 'x 3 5 5 5 3', 'x 1 3 3 3 1'), // A 型封閉
  s('C', 'x 3 5 5 5 x', 'x 1 3 3 3 x'),
  s('F', 'x x 3 2 1 1', 'x x 3 2 1 1'), // 小 F（四弦根音）
  s('C', 'x x 10 9 8 x', 'x x 3 2 1 x'), // 四三二弦三和弦
  s('C', 'x x x 5 5 3', 'x x x 3 4 1'), // 三二一弦三和弦
  s('C/E', 'x x x 9 8 8', 'x x x 2 1 1'),
  s('C/G', 'x x x 12 13 12', 'x x x 1 2 1'),
  s('C/E', 'x x 14 12 13 x', 'x x 3 1 2 x'),
  s('C/G', 'x x 5 5 5 x', 'x x 1 1 1 x'),
  s('C/E', 'x 7 5 5 5 x', 'x 3 1 1 1 x'),
  s('C/G', '3 x 5 5 5 x', '1 x 3 3 3 x'),
  s('C/G', 'x 10 10 9 8 x', 'x 3 4 2 1 x'),
  s('C/E', '12 x 10 12 13 x', '2 x 1 3 4 x', 2),
  s('A', 'x 0 2 2 2 0', 'x 0 1 2 3 0'),
  s('G', '3 2 0 0 0 3', '2 1 0 0 0 3'),
  s('G', '3 2 0 0 3 3', '2 1 0 0 3 4'),
  s('E', '0 2 2 1 0 0', '0 2 3 1 0 0'),
  s('D', 'x x 0 2 3 2', 'x x 0 1 3 2'),
  s('C', 'x 3 2 0 1 0', 'x 3 2 0 1 0'),
  s('C/E', '0 3 2 0 1 0', '0 3 2 0 1 0'),
  s('G/B', 'x 2 0 0 3 3', 'x 1 0 0 3 4'),
  s('D/F#', '2 x 0 2 3 2', 'T x 0 1 3 2'),
  s('C/G', '3 3 2 0 1 0', '3 4 2 0 1 0'),
  s('F/C', 'x 3 3 2 1 1', 'x 3 4 2 1 1'),
  s('F/A', 'x 0 3 2 1 1', 'x 0 3 2 1 1'),
  s('G/D', 'x x 0 0 0 3', 'x x 0 0 0 3'),

  // ── 小三和弦 ──
  s('Fm', '1 3 3 1 1 1', '1 3 4 1 1 1'),
  s('Cm', 'x 3 5 5 4 3', 'x 1 3 4 2 1'),
  s('Cm', 'x 3 5 5 4 x', 'x 1 3 4 2 x'),
  s('Fm', 'x x 3 1 1 1', 'x x 3 1 1 1'),
  s('Cm', 'x x 10 8 8 x', 'x x 3 1 1 x'),
  s('Cm', 'x x x 5 4 3', 'x x x 3 2 1'),
  s('Am/E', 'x 7 7 5 5 x', 'x 3 4 1 1 x'),
  s('Am/E', 'x x 2 2 1 x', 'x x 2 3 1 x'),
  s('Am/E', 'x x x 9 10 8', 'x x x 2 3 1'),
  s('Am', 'x 0 2 2 1 0', 'x 0 2 3 1 0'),
  s('Em', '0 2 2 0 0 0', '0 2 3 0 0 0'),
  s('Dm', 'x x 0 2 3 1', 'x x 0 2 3 1'),
  s('Am7/G', '3 0 2 2 1 0', '4 0 2 3 1 0'),

  // ── 屬七 ──
  s('F7', '1 3 1 2 1 1', '1 3 1 2 1 1'),
  s('C7', 'x 3 5 3 5 3', 'x 1 3 1 4 1'),
  s('G7', '3 x 3 4 x x', '1 x 2 3 x x'),
  s('C7', 'x 3 2 3 x x', 'x 2 1 3 x x'),
  s('A7', 'x 0 2 0 2 0', 'x 0 2 0 3 0'),
  s('E7', '0 2 0 1 0 0', '0 2 0 1 0 0'),
  s('D7', 'x x 0 2 1 2', 'x x 0 2 1 3'),
  s('G7', '3 2 0 0 0 1', '3 2 0 0 0 1'),
  s('C7', 'x 3 2 3 1 0', 'x 3 2 4 1 0'),
  s('B7', 'x 2 1 2 0 2', 'x 2 1 3 0 4'),

  // ── 小七 ──
  s('Fm7', '1 3 1 1 1 1', '1 3 1 1 1 1'),
  s('Cm7', 'x 3 5 3 4 3', 'x 1 3 1 2 1'),
  s('Gm7', '3 x 3 3 x x', '1 x 2 3 x x'),
  s('Cm7', 'x 3 x 3 4 x', 'x 1 x 2 3 x'),
  s('Am7', 'x 0 2 0 1 0', 'x 0 2 0 1 0'),
  s('Em7', '0 2 0 0 0 0', '0 2 0 0 0 0'),
  s('Em7', '0 2 2 0 3 0', '0 1 2 0 3 0'),
  s('Dm7', 'x x 0 2 1 1', 'x x 0 2 1 1'),
  s('Bm7', 'x 2 0 2 0 2', 'x 1 0 2 0 3'),

  // ── 大七 ──
  s('Fmaj7', '1 x 2 2 1 x', '1 x 3 4 2 x'),
  s('Gmaj7', '3 x 4 4 3 x', '1 x 3 4 2 x'),
  s('Cmaj7', 'x 3 x 4 5 x', 'x 1 x 2 3 x'),
  s('Fmaj7', 'x x 3 5 5 5', 'x x 1 3 3 3'),
  s('Cmaj7', 'x 3 5 4 5 3', 'x 1 3 2 4 1', 2),
  s('Cmaj7', 'x 3 5 4 5 x', 'x 1 3 2 4 x', 2),
  s('Cmaj7', 'x 3 2 0 0 0', 'x 3 2 0 0 0'),
  s('Fmaj7', 'x x 3 2 1 0', 'x x 3 2 1 0'),
  s('Amaj7', 'x 0 2 1 2 0', 'x 0 2 1 3 0'),
  s('Dmaj7', 'x x 0 2 2 2', 'x x 0 1 1 1'),
  s('Gmaj7', '3 x 0 0 0 2', '3 x 0 0 0 2'),
  s('Emaj7', '0 2 1 1 0 0', '0 3 1 2 0 0'),

  // ── 掛留 ──
  s('Csus4', 'x 3 5 5 6 3', 'x 1 2 3 4 1'),
  s('Fsus4', '1 3 3 3 1 1', '1 2 3 4 1 1'),
  s('Csus4', 'x x 10 10 8 x', 'x x 3 4 1 x'),
  s('Dsus4', 'x x 0 2 3 3', 'x x 0 1 3 4'),
  s('Asus4', 'x 0 2 2 3 0', 'x 0 1 2 3 0'),
  s('Esus4', '0 2 2 2 0 0', '0 2 3 4 0 0'),
  s('Gsus4', '3 x 0 0 1 3', '3 x 0 0 1 4'),
  s('Csus2', 'x 3 5 5 3 3', 'x 1 3 4 1 1'),
  s('Csus2', 'x 3 5 5 3 x', 'x 1 3 4 1 x'),
  s('Asus2', 'x 0 2 2 0 0', 'x 0 1 2 0 0'),
  s('Dsus2', 'x x 0 2 3 0', 'x x 0 1 3 0'),
  s('F7sus4', '1 3 1 3 1 1', '1 3 1 4 1 1'),
  s('C7sus4', 'x 3 5 3 6 3', 'x 1 3 1 4 1'),
  s('A7sus4', 'x 0 2 0 3 0', 'x 0 2 0 3 0'),
  s('C9sus4', 'x 3 3 3 3 3', 'x 1 1 1 1 1'),

  // ── 色彩和弦 ──
  s('Cadd9', 'x x 10 9 8 10', 'x x 3 2 1 4'),
  s('Fadd9', 'x x 3 2 1 3', 'x x 3 2 1 4'),
  s('Cadd9', 'x 3 2 0 3 3', 'x 2 1 0 3 4'),
  s('Cadd9', 'x 3 2 0 3 0', 'x 2 1 0 3 0'),
  s('Cmadd9', 'x x 10 8 8 10', 'x x 3 1 1 4'),
  s('Fmadd9', 'x x 3 1 1 3', 'x x 3 1 1 4'),
  s('Cmaj9', 'x 3 2 4 3 x', 'x 2 1 4 3 x'),
  s('C9', 'x 3 2 3 3 3', 'x 2 1 3 3 3'),
  s('Cm9', 'x 3 1 3 3 x', 'x 2 1 3 4 x'),
  s('C6', 'x 3 5 5 5 5', 'x 1 3 3 3 3'),
  s('G6', '3 x 2 4 3 x', '2 x 1 4 3 x'),
  s('Cm6', 'x 3 1 2 1 x', 'x 3 1 2 1 x'),
  s('C6/9', 'x 3 2 2 3 3', 'x 2 1 1 3 4'),
  s('F6/9', 'x x 3 2 3 3', 'x x 2 1 3 4'),
  s('Cmaj7#11', 'x 3 4 4 5 x', 'x 1 2 3 4 x'),
  s('Cmaj7#11', '8 x 9 9 7 x', '2 x 3 4 1 x'),
  s('Fmaj7#11', 'x x 3 2 0 0', 'x x 3 2 0 0'),
  s('Fmaj7#11', '1 x 2 2 0 0', '1 x 2 3 0 0'),
  s('Cm11', '8 x 8 8 6 x', '2 x 3 4 1 x'),
  s('G13', '3 x 3 4 5 x', '1 x 2 3 4 x'),
  s('C7b9', 'x 3 2 3 2 x', 'x 3 1 4 2 x'),
  s('C7#9', 'x 3 2 3 4 x', 'x 2 1 3 4 x'),
  s('C7#5', 'x 3 x 3 5 4', 'x 1 x 2 4 3'),
  s('Cm(maj7)', 'x 3 5 4 4 3', 'x 1 4 2 3 1'),

  // ── 減、增、半減、強力和弦 ──
  s('Bm7b5', 'x 2 3 2 3 x', 'x 1 3 2 4 x'),
  s('Bm7b5', '7 x 7 7 6 x', '2 x 3 4 1 x'),
  s('D#dim7', 'x x 1 2 1 2', 'x x 1 3 2 4'),
  s('Cdim7', 'x 3 4 2 4 x', 'x 2 3 1 4 x', 2),
  s('Cdim', 'x 3 4 5 4 x', 'x 1 2 4 3 x'),
  s('Caug', 'x 3 2 1 1 x', 'x 3 2 1 1 x'),
  s('C5', 'x 3 5 5 x x', 'x 1 3 4 x x'),
  s('G5', '3 5 5 x x x', '1 3 4 x x x'),
];

export interface Shape {
  chord: ChordRef;
  frets: Fret[];
  fingers: Finger[];
  tier: 1 | 2;
  /** 沒有空弦，可以平移到別的把位 */
  movable: boolean;
}

const parseFrets = (t: string): Fret[] => t.split(' ').map((x) => (x === 'x' ? null : Number(x)));
const parseFingers = (t: string): Finger[] =>
  t.split(' ').map((x) => (x === 'x' ? null : x === 'T' ? 'T' : (Number(x) as Finger)));

let shapes: Shape[] | undefined;
/** 按法庫（第一次用到才解析） */
export function shapeLibrary(): Shape[] {
  if (!shapes) {
    shapes = SHAPE_DEFS.map((d) => {
      const chord = parseChordSymbol(d.name);
      if (!chord) throw new Error(`shape name not understood: ${d.name}`);
      const frets = parseFrets(d.frets);
      return { chord, frets, fingers: parseFingers(d.fingers), tier: d.tier ?? 1, movable: !frets.includes(0) };
    });
  }
  return shapes;
}

export interface ShapeVoicing {
  frets: Fret[];
  fingers: Finger[];
  tier: 1 | 2;
  movable: boolean;
}

const sameChord = (a: ChordRef, b: ChordRef) => a.rootPc === b.rootPc && a.qualityId === b.qualityId && a.bassPc === b.bassPc;

/** 這個和弦在按法庫裡的所有按法（可移動的形狀平移到第 1～maxFret 品之間）。 */
export function shapesFor(ch: ChordRef, maxFret = 15): ShapeVoicing[] {
  const out: ShapeVoicing[] = [];
  for (const sh of shapeLibrary()) {
    if (sh.chord.qualityId !== ch.qualityId) continue;
    const rel = (pc: number) => (((pc - sh.chord.rootPc) % 12) + 12) % 12;
    if (rel(sh.chord.bassPc) !== (((ch.bassPc - ch.rootPc) % 12) + 12) % 12) continue;
    const shift = (((ch.rootPc - sh.chord.rootPc) % 12) + 12) % 12;
    if (!sh.movable) {
      if (shift === 0) out.push({ frets: [...sh.frets], fingers: [...sh.fingers], tier: sh.tier, movable: false });
      continue;
    }
    const pressed = sh.frets.filter((f): f is number => f !== null);
    for (const d of [shift - 24, shift - 12, shift, shift + 12]) {
      const lo = Math.min(...pressed) + d;
      const hi = Math.max(...pressed) + d;
      if (lo < 1 || hi > maxFret) continue;
      const frets = sh.frets.map((f) => (f === null ? null : f + d));
      // 平移後仍要辨識成同一個和弦（減七這類對稱和弦的名稱會跟著低音走）
      const best = analyzeVoicing(frets).best;
      if (!best || !sameChord(best, ch)) continue;
      out.push({ frets, fingers: [...sh.fingers], tier: sh.tier, movable: true });
    }
  }
  return out;
}

/**
 * 依常見的按法推算手指：最低品格有兩個以上的音就用食指封閉（中間不能有悶音或空弦），
 * 其餘音由低品到高品、同一品由低音弦到高音弦依序分給中指、無名指、小指；
 * 最高品格的相鄰幾條弦可以用同一指壓（像 A 型封閉的無名指）。
 * 需要超過四隻手指、跨超過四個品格就回傳 undefined（按不出來）。
 */
export function computeFingering(frets: readonly Fret[]): Finger[] | undefined {
  const fingers: Finger[] = frets.map((f) => (f === null ? null : f === 0 ? 0 : null));
  const pressed = frets.map((f, i) => ({ f, i })).filter((x): x is { f: number; i: number } => x.f !== null && x.f > 0);
  if (pressed.length === 0) return fingers;
  const lo = Math.min(...pressed.map((p) => p.f));
  const hi = Math.max(...pressed.map((p) => p.f));
  if (hi - lo > 3) return undefined;

  const atLo = pressed.filter((p) => p.f === lo);
  const a = Math.min(...atLo.map((p) => p.i));
  const b = Math.max(...atLo.map((p) => p.i));
  let barre = atLo.length >= 2;
  for (let i = a; i <= b && barre; i++) if (frets[i] === null || frets[i] === 0) barre = false;

  const rest = barre ? pressed.filter((p) => p.f !== lo) : pressed.slice().sort((x, y) => x.f - y.f || x.i - y.i).slice(1);
  if (barre) atLo.forEach((p) => (fingers[p.i] = 1));
  else fingers[(pressed.slice().sort((x, y) => x.f - y.f || x.i - y.i)[0] as { i: number }).i] = 1;

  rest.sort((x, y) => x.f - y.f || x.i - y.i);
  // 最高品格、連續且延伸到最高音那條按住的弦 → 可用一指小封閉
  const top = rest.filter((p) => p.f === hi);
  const topIdx = top.map((p) => p.i);
  // 小封閉的上方不能再有要另外按的音（被食指封閉的音沒關係）
  const maxString = Math.max(...rest.map((p) => p.i));
  const smallBarre =
    top.length >= 3 &&
    hi > lo &&
    topIdx[topIdx.length - 1] === maxString &&
    topIdx.every((v, k) => k === 0 || v === (topIdx[k - 1] as number) + 1);

  let next = 2;
  for (const p of rest) {
    if (smallBarre && p.f === hi && p.i !== topIdx[0]) {
      fingers[p.i] = fingers[topIdx[0] as number] ?? null;
      continue;
    }
    // 小封閉習慣用無名指（像 A 型封閉），前面沒用到中指也一樣
    if (smallBarre && p.i === topIdx[0]) next = Math.max(next, 3);
    if (next > 4) return undefined;
    fingers[p.i] = next as Finger;
    next++;
  }
  return fingers;
}

const key = (frets: readonly Fret[]) => frets.map((f) => (f === null ? 'x' : f)).join(' ');
let byShape: Map<string, Finger[]> | undefined;

/** 建議手指：按法庫裡有一樣的形狀（含平移）就用庫裡的，否則用 computeFingering 推算。 */
export function suggestFingering(frets: readonly Fret[]): Finger[] | undefined {
  if (!byShape) {
    byShape = new Map();
    for (const sh of shapeLibrary()) {
      if (!sh.movable) byShape.set(key(sh.frets), sh.fingers);
      else {
        const pressed = sh.frets.filter((f): f is number => f !== null);
        const base = Math.min(...pressed);
        for (let d = 1 - base; d + Math.max(...pressed) <= 24; d++) {
          byShape.set(key(sh.frets.map((f) => (f === null ? null : f + d))), sh.fingers);
        }
      }
    }
  }
  return byShape.get(key(frets)) ?? computeFingering(frets);
}

export const formatFingers = (f: readonly Finger[]): string => f.map((x) => (x === null ? 'x' : String(x))).join(' ');
