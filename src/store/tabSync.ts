/**
 * 同一個瀏覽器開好幾個分頁時，彼此通知「我剛存了／刪了哪個靈感」，
 * 避免一個分頁拿著舊內容存檔、把另一個分頁剛改好的內容蓋掉。
 * 規則：較新的（updatedAt 較大）勝出；本分頁比較新的不會被覆蓋。
 */
import type { Idea } from '../core';

export type SyncMessage = { type: 'saved'; idea: Idea } | { type: 'deleted'; id: string };

/** 把另一個分頁的變更套進本分頁的清單；沒有變化時回傳原陣列（方便判斷要不要重畫）。 */
export function applyRemote(ideas: Idea[], msg: SyncMessage): Idea[] {
  if (msg.type === 'deleted') {
    return ideas.some((i) => i.id === msg.id) ? ideas.filter((i) => i.id !== msg.id) : ideas;
  }
  const local = ideas.find((i) => i.id === msg.idea.id);
  if (!local) return [msg.idea, ...ideas];
  if (local.updatedAt >= msg.idea.updatedAt) return ideas;
  return ideas.map((i) => (i.id === msg.idea.id ? msg.idea : i));
}

const CHANNEL = 'guitar-idea-pad';

/** 開一個廣播頻道；瀏覽器不支援時回傳空操作。 */
export function openSync(onMessage: (msg: SyncMessage) => void): { post: (msg: SyncMessage) => void; close: () => void } {
  if (typeof BroadcastChannel === 'undefined') return { post: () => {}, close: () => {} };
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent<SyncMessage>) => onMessage(e.data);
  return {
    post: (msg) => {
      try {
        ch.postMessage(msg);
      } catch {
        /* 頻道已關閉 */
      }
    },
    close: () => ch.close(),
  };
}
