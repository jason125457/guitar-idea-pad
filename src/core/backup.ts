/**
 * 備份檔：把靈感存成一份 JSON，之後可匯入回來。
 * 匯入絕不覆蓋既有資料——id 相同但內容不同時，另存成一份「（匯入）」複本。
 */
import { duplicateIdea, normalizeIdea, type Idea } from './song';

export const BACKUP_FORMAT = 'guitar-idea-pad-backup';
export const BACKUP_VERSION = 1;
/** 超過這個大小的檔案直接拒絕（一個靈感通常不到幾 KB）。 */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  ideas: Idea[];
}

export function createBackup(ideas: readonly Idea[], now = Date.now()): BackupFile {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, ideas: ideas.map((i) => structuredClone(i)) };
}

export const serializeBackup = (b: BackupFile): string => JSON.stringify(b, null, 2);

export type ParseBackupResult =
  | { ok: true; ideas: Idea[]; skipped: number; exportedAt: number | undefined }
  | { ok: false; error: string };

/** 解析並驗證備份檔文字；不會丟例外。無法使用的靈感會被略過並計數。 */
export function parseBackup(text: string): ParseBackupResult {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: '檔案太大，不像是靈感備份檔' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: '這個檔案不是有效的 JSON，無法匯入' };
  }
  if (typeof data !== 'object' || data === null || (data as { format?: unknown }).format !== BACKUP_FORMAT) {
    return { ok: false, error: '這不是「指板靈感本」的備份檔' };
  }
  const o = data as { version?: unknown; ideas?: unknown; exportedAt?: unknown };
  if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1) {
    return { ok: false, error: '備份檔缺少版本資訊' };
  }
  if (o.version > BACKUP_VERSION) {
    return { ok: false, error: '這份備份來自較新版本的指板靈感本，請先更新後再匯入' };
  }
  if (!Array.isArray(o.ideas)) return { ok: false, error: '備份檔裡沒有靈感資料' };
  const ideas = o.ideas.map(normalizeIdea).filter((i): i is Idea => !!i);
  return {
    ok: true,
    ideas,
    skipped: o.ideas.length - ideas.length,
    exportedAt: typeof o.exportedAt === 'number' ? o.exportedAt : undefined,
  };
}

/** 鍵順序固定的序列化，用來比較兩份靈感內容是否完全一樣。 */
function canon(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canon).join(',')}]`;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(x) ?? 'null';
}

export interface ImportPlan {
  /** 要新增的靈感（含改名另存的複本） */
  add: Idea[];
  /** 本機已有完全相同內容，略過的數量 */
  identical: number;
  /** id 相同但內容不同、另存成複本的數量 */
  copied: number;
}

export function planImport(existing: readonly Idea[], incoming: readonly Idea[], now = Date.now()): ImportPlan {
  const byId = new Map(existing.map((i) => [i.id, i]));
  const plan: ImportPlan = { add: [], identical: 0, copied: 0 };
  for (const idea of incoming) {
    const clash = byId.get(idea.id);
    if (!clash) {
      plan.add.push(idea);
      byId.set(idea.id, idea);
    } else if (canon(clash) === canon(idea)) {
      plan.identical++;
    } else {
      const copy = duplicateIdea(idea, now);
      plan.add.push({ ...copy, title: `${idea.title}（匯入）` });
      byId.set(copy.id, copy);
      plan.copied++;
    }
  }
  return plan;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 例如 指板靈感本-備份-2026-10-19.json；單一靈感則帶上標題。 */
export function backupFileName(date: Date, title?: string): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (title === undefined) return `指板靈感本-備份-${day}.json`;
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 40) || '未命名靈感';
  return `指板靈感本-${safe}-${day}.json`;
}
