/**
 * 起手式：不會樂理也能直接套用的常見和弦進行，以及把級數／功能換成白話的標籤。
 * 純資料與純函式。
 */
import type { ChordRef } from './chord';
import type { ChordFunctionInfo } from './key';
import { mod12 } from './pitch';

export interface Starter {
  id: string;
  /** 白話名稱 */
  name: string;
  /** 聽起來的感覺、常在哪裡聽到 */
  feel: string;
  /** 每個和弦：根音相對主音的半音數、和弦性質；每個和弦四拍 */
  steps: readonly (readonly [rel: number, qualityId: 'maj' | 'min'])[];
}

const M = 'maj';
const m = 'min';

export const STARTERS: readonly Starter[] = [
  { id: 'pop', name: '流行萬用', feel: '明亮、好唱，最多流行歌用這組', steps: [[0, M], [7, M], [9, m], [5, M]] },
  { id: 'ballad', name: '抒情', feel: '從小和弦開始，帶點感傷、有故事感', steps: [[9, m], [5, M], [0, M], [7, M]] },
  { id: 'oldies', name: '懷舊', feel: '輕快、甜甜的老歌味道', steps: [[0, M], [9, m], [5, M], [7, M]] },
  { id: 'folk', name: '三個和弦', feel: '最簡單的民謠、搖滾，三個和弦彈到底', steps: [[0, M], [5, M], [7, M], [5, M]] },
  {
    id: 'mando',
    name: '華語抒情',
    feel: '華語情歌最常見的走法，一路往下鋪到副歌',
    steps: [[5, M], [7, M], [4, m], [9, m], [2, m], [7, M], [0, M], [0, M]],
  },
  {
    id: 'canon',
    name: '卡農',
    feel: '溫暖、慢慢堆疊，適合八小節的主歌',
    steps: [[0, M], [7, M], [9, m], [4, m], [5, M], [0, M], [5, M], [7, M]],
  },
];

/** 吉他上好按的幾個大調：C、G、D、A、E */
export const STARTER_TONICS: readonly number[] = [0, 7, 2, 9, 4];

/** 把起手式放到某個大調上 */
export function starterChords(s: Starter, tonic: number): ChordRef[] {
  return s.steps.map(([rel, qualityId]) => {
    const pc = mod12(tonic + rel);
    return { rootPc: pc, qualityId, bassPc: pc };
  });
}

/**
 * 和弦在這個調裡扮演的角色，用白話講（取代 I、V7、副屬和弦這類術語）：
 * 家＝主和弦；穩＝跟主和弦同一掛；展開＝往外走；想回家＝聽了會想接回主和弦。
 */
export function plainRole(info: Pick<ChordFunctionInfo, 'roman' | 'function' | 'tag'> | undefined): string {
  if (!info) return '';
  switch (info.tag) {
    case 'borrowed':
      return '借來的色彩';
    case 'secondary-dominant':
      return '推一把';
    case 'tritone-sub':
      return '滑進去';
    case 'chromatic':
      return '調外';
    default:
      break;
  }
  if (/^[Ii](?![IiVv])/.test(info.roman)) return '家';
  if (info.function === 'T') return '穩';
  if (info.function === 'S') return '展開';
  if (info.function === 'D') return '想回家';
  return '調外';
}
