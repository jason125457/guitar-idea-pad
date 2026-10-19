import { analyzeVoicing, chordSymbol, formatTab, type AnalyzedChord, type ChordRef, type Fret } from './chord';
import { classifyChord, type ChordTag, type KeyGuess } from './key';
import { mod12, spellerForKey } from './pitch';
import { quality } from './qualities';
import { generateVoicings } from './voicing';

export type Mood = 'warm-resolve' | 'bittersweet' | 'neo-soul';

export interface Suggestion {
  mood: Mood;
  title: string;
  reason: string;
  chord: ChordRef;
  symbol: string;
  roman: string;
  tag: ChordTag;
  frets: Fret[];
  tab: string;
  /** 與前一個和弦的聲部移動成本（越小越順） */
  cost: number;
  /** 旋律落音與此和弦的關係；沒提供旋律則為 undefined */
  melodyFit?: 'chord-tone' | 'extension' | 'clash';
}

/** 旋律落音對和弦的契合度：和弦音加分、半音摩擦扣分。 */
function melodyFit(rootPc: number, qualityId: string, melodyMidi: number): { penalty: number; fit: Suggestion['melodyFit'] } {
  const q = quality(qualityId);
  const rel = mod12(melodyMidi - rootPc);
  if (q.intervals.includes(rel)) return { penalty: -1, fit: 'chord-tone' };
  const rubs = q.intervals.some((t) => mod12(rel - t) === 1 || mod12(t - rel) === 1);
  if (rubs && ![2, 9].includes(rel)) return { penalty: 1.5, fit: 'clash' };
  return { penalty: 0.3, fit: 'extension' };
}

interface VoicingPick {
  qualityId: string;
  frets: Fret[];
  cost: number;
  fit: Suggestion['melodyFit'];
}

function bestVoicing(
  rootPc: number,
  qualityIds: string[],
  prev: readonly Fret[],
  melodyMidi: number | undefined,
  avoidQuality?: string,
): VoicingPick | undefined {
  let best: (VoicingPick & { total: number }) | undefined;
  qualityIds.forEach((qid, order) => {
    if (qid === avoidQuality) return;
    const q = quality(qid);
    const vs = generateVoicings(rootPc, q, { prev, bassPc: rootPc, limit: 1 });
    const v = vs[0] ?? generateVoicings(rootPc, q, { prev, limit: 1 })[0];
    if (!v) return;
    const mf = melodyMidi === undefined ? undefined : melodyFit(rootPc, qid, melodyMidi);
    const total = v.cost + order * 0.5 + (mf?.penalty ?? 0);
    if (!best || total < best.total) best = { qualityId: qid, frets: v.frets, cost: v.cost, fit: mf?.fit, total };
  });
  return best;
}

const TAG_RANK: Record<ChordTag, number> = {
  diatonic: 3, borrowed: 2, 'secondary-dominant': 2, 'tritone-sub': 2, chromatic: 0,
};

/**
 * 依目前停駐的和弦與調性，給出最多 3 種情緒不同的銜接建議。
 * 規則式產生，每個候選都附吉他指法（以與前一和弦的聲部移動最小為準）。
 */
export function suggestNext(chords: AnalyzedChord[], key: Pick<KeyGuess, 'tonic' | 'mode'>, melodyMidi?: number): Suggestion[] {
  const last = chords[chords.length - 1];
  if (!last?.best) return [];
  const { tonic, mode } = key;
  const speller = spellerForKey(tonic, mode);
  const prev = last.frets;
  const lastRef: ChordRef = last.best;
  const out: Suggestion[] = [];
  const seen = new Set<string>([chordSymbol(lastRef, speller)]);

  const push = (
    mood: Mood,
    title: string,
    reason: (roman: string) => string,
    rootPc: number,
    qualityId: string,
    frets: Fret[],
    cost: number,
    fit: Suggestion['melodyFit'],
  ): boolean => {
    const analyzed = analyzeVoicing(frets);
    const bassPc = analyzed.bassPc;
    const chord: ChordRef = { rootPc, qualityId, bassPc };
    const symbol = chordSymbol(chord, speller);
    if (seen.has(symbol)) return false;
    seen.add(symbol);
    const info = classifyChord(chord, tonic, mode);
    out.push({ mood, title, reason: reason(info.roman), chord, symbol, roman: info.roman, tag: info.tag, frets, tab: formatTab(frets), cost, melodyFit: fit });
    return true;
  };

  const isTonicNow = lastRef.rootPc === tonic;

  // 1. 溫暖落地
  const tonicQs = mode === 'major' ? ['maj7', 'add9', '6', 'maj9'] : ['m7', 'm9', 'madd9'];
  const warm = bestVoicing(tonic, tonicQs, prev, melodyMidi, isTonicNow ? lastRef.qualityId : undefined);
  if (warm) {
    push(
      'warm-resolve',
      isTonicNow ? '主和弦換色' : '溫暖落地',
      (r) => (isTonicNow ? `停在主和弦 ${r} 上換個色彩，不離開家` : `回到主和弦 ${r}，最穩定的終止感`),
      tonic, warm.qualityId, warm.frets, warm.cost, warm.fit,
    );
  }

  // 2. 微酸
  const sadRoot = mode === 'major' ? mod12(tonic + 9) : mod12(tonic + 8);
  const sadQs = mode === 'major' ? ['m7', 'm9', 'madd9'] : ['maj7', 'maj9', 'add9'];
  let sad = bestVoicing(sadRoot, sadQs, prev, melodyMidi);
  let sadRootUsed = sadRoot;
  if (sad && sadRoot === lastRef.rootPc) {
    sadRootUsed = mod12(tonic + (mode === 'major' ? 4 : 3));
    sad = bestVoicing(sadRootUsed, mode === 'major' ? ['m7', 'm9'] : ['maj7', 'add9'], prev, melodyMidi);
  }
  if (sad) {
    push(
      'bittersweet',
      mode === 'major' ? '微酸收尾' : '帶光的憂鬱',
      (r) => (mode === 'major' ? `${r} 小和弦收尾，溫柔但帶一點惆悵` : `${r} 大和弦，在小調裡透出一點光`),
      sadRootUsed, sad.qualityId, sad.frets, sad.cost, sad.fit,
    );
  }

  // 3. Neo-Soul：整把指型半音平移，挑出在調中最合理的位置
  // 半音（±1）優先；調外的經過和弦也接受，那正是這種手法的味道。已出現過的和弦不重複。
  const used = new Set(chords.map((c) => (c.best ? chordSymbol(c.best, speller) : '')));
  let bestShift: { d: number; frets: Fret[]; chord: ChordRef; rank: number; tag: ChordTag } | undefined;
  for (const ds of [[-1, 1], [-2, 2]]) {
    for (const d of ds) {
      if (prev.some((f) => f !== null && (f + d < 0 || f + d > 17))) continue;
      const shifted = prev.map((f) => (f === null ? null : f + d));
      const a = analyzeVoicing(shifted);
      if (!a.best || a.best.score < 0.65) continue;
      if (used.has(chordSymbol(a.best, speller))) continue;
      const tag = classifyChord(a.best, tonic, mode).tag;
      const rank = TAG_RANK[tag] * 10 - (d < 0 ? 0 : 1);
      if (!bestShift || rank > bestShift.rank) bestShift = { d, frets: shifted, chord: a.best, rank, tag };
    }
    if (bestShift) break;
  }
  if (bestShift) {
    const dir = bestShift.d < 0 ? '下' : '上';
    const n = Math.abs(bestShift.d);
    const passing = bestShift.tag === 'chromatic';
    const mf = melodyMidi === undefined ? undefined : melodyFit(bestShift.chord.rootPc, bestShift.chord.qualityId, melodyMidi).fit;
    push(
      'neo-soul',
      n === 1 ? 'Neo-Soul 半音平移' : '指型平行移動',
      (r) =>
        `整把指型往${dir}平移 ${n} 品，每條弦同步走${n === 1 ? '半音' : '全音'}（${r}）` +
        (passing ? '；這是調外的經過和弦，可以再平移一次回到調內' : ''),
      bestShift.chord.rootPc, bestShift.chord.qualityId, bestShift.frets,
      voiceLeadingOfShift(prev, bestShift.frets), mf,
    );
  } else {
    const root = mod12(tonic + 1);
    const sub = bestVoicing(root, ['9', '7'], prev, melodyMidi);
    if (sub) {
      push('neo-soul', '三全音替代', (r) => `${r} 取代 V7，用半音下行解決到主和弦`, root, sub.qualityId, sub.frets, sub.cost, sub.fit);
    }
  }
  return out;
}

function voiceLeadingOfShift(a: readonly Fret[], b: readonly Fret[]): number {
  return a.reduce<number>((sum, x, i) => {
    const y = b[i];
    return x === null || y === null || y === undefined ? sum : sum + Math.abs(x - y);
  }, 0);
}

