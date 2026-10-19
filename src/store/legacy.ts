import { migrateLegacyV1, type Idea } from '../core';

export const LEGACY_KEY = 'guitar-idea-pad.v1';

/** 讀取第一版存在 localStorage 的和弦串並轉成 Idea；沒有或壞掉回傳 undefined。 */
export function readLegacyIdea(): Idea | undefined {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? migrateLegacyV1(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

/** 只在新資料確定寫入 IndexedDB 之後呼叫。 */
export function clearLegacy(): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* 忽略 */
  }
}
