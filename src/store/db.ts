/** IndexedDB 儲存層：一個 object store（ideas），整個 Idea 存成一筆。 */
import { normalizeIdea, type Idea } from '../core';

export const DB_NAME = 'guitar-idea-pad';
const DB_VERSION = 1;
const STORE = 'ideas';

let dbPromise: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('此瀏覽器不支援 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = undefined;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 開啟失敗'));
    req.onblocked = () => reject(new Error('IndexedDB 被其他分頁佔用'));
  }).catch((e: unknown) => {
    dbPromise = undefined; // 失敗後允許重試
    throw e;
  });
  dbPromise = p;
  return p;
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 交易失敗'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 交易中止（可能空間不足）'));
      }),
  );
}

/** 依更新時間由新到舊；格式損壞的資料會被略過而不是讓整個清單失敗。 */
export async function listIdeas(): Promise<Idea[]> {
  const rows = await request<unknown[]>('readonly', (s) => s.getAll());
  return rows
    .map(normalizeIdea)
    .filter((i): i is Idea => !!i)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putIdea(idea: Idea): Promise<void> {
  await request('readwrite', (s) => s.put(idea));
}

export async function deleteIdea(id: string): Promise<void> {
  await request('readwrite', (s) => s.delete(id));
}
