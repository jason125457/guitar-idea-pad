import { useCallback, useEffect, useRef, useState } from 'react';
import { createIdea, duplicateIdea as cloneIdea, type Idea } from '../core';
import { deleteIdea, listIdeas, putIdea } from './db';
import { clearLegacy, readLegacyIdea } from './legacy';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const ACTIVE_KEY = 'guitar-idea-pad.active';
const SAVE_DELAY_MS = 400;

interface Loaded {
  ideas: Idea[];
  error: string;
}

/** 啟動時只載入一次（StrictMode 開發模式會執行兩次 effect，避免各建一個預設靈感）。 */
let initial: Promise<Loaded> | undefined;

async function loadInitial(): Promise<Loaded> {
  try {
    const list = await listIdeas();
    if (list.length > 0) return { ideas: list, error: '' };
    const legacy = readLegacyIdea();
    const first = legacy ?? createIdea();
    await putIdea(first);
    if (legacy) clearLegacy(); // 確定寫入成功後才清掉舊資料
    return { ideas: [first], error: '' };
  } catch (e) {
    return { ideas: [createIdea()], error: e instanceof Error ? e.message : '無法使用本機儲存' };
  }
}

function readActiveId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeActiveId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* 忽略 */
  }
}

export function useIdeaStore() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [activeId, setActiveIdState] = useState('');
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // 事件處理與計時器要讀到最新值，所以另存一份 ref（避免閉包過期）
  const ideasRef = useRef<Idea[]>([]);
  const activeRef = useRef('');
  const pending = useRef(new Map<string, Idea>());
  const timer = useRef<number | undefined>(undefined);
  const persistent = useRef(true);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const batch = [...pending.current.values()];
    pending.current.clear();
    if (batch.length === 0 || !persistent.current) return;
    setSaveState('saving');
    try {
      for (const idea of batch) await putIdea(idea);
      if (pending.current.size === 0) setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, []);

  const schedule = useCallback(
    (idea: Idea) => {
      pending.current.set(idea.id, idea);
      if (!persistent.current) {
        setSaveState('error');
        return;
      }
      setSaveState('saving');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const setActive = useCallback((id: string) => {
    activeRef.current = id;
    setActiveIdState(id);
    writeActiveId(id);
  }, []);

  const commit = useCallback((next: Idea[]) => {
    ideasRef.current = next;
    setIdeas(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    initial ??= loadInitial();
    void initial.then(({ ideas: list, error }) => {
      if (cancelled) return;
      persistent.current = !error;
      setLoadError(error);
      commit(list);
      const wanted = readActiveId();
      setActive(list.some((i) => i.id === wanted) ? wanted : (list[0] as Idea).id);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [commit, setActive]);

  // 離開頁面前把尚未寫入的內容送出
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      void flush();
    };
  }, [flush]);

  const updateActive = useCallback(
    (fn: (idea: Idea) => Idea) => {
      const cur = ideasRef.current.find((i) => i.id === activeRef.current);
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      commit(ideasRef.current.map((i) => (i.id === cur.id ? next : i)));
      schedule(next);
    },
    [commit, schedule],
  );

  const newIdea = useCallback(() => {
    const idea = createIdea();
    commit([idea, ...ideasRef.current]);
    schedule(idea);
    setActive(idea.id);
  }, [commit, schedule, setActive]);

  const duplicateIdea = useCallback(
    (id: string) => {
      const src = ideasRef.current.find((i) => i.id === id);
      if (!src) return;
      const copy = cloneIdea(src);
      commit([copy, ...ideasRef.current]);
      schedule(copy);
      setActive(copy.id);
    },
    [commit, schedule, setActive],
  );

  /** 把匯入的靈感加進清單並排入儲存；既有靈感與目前選中的靈感都不動。 */
  const importIdeas = useCallback(
    (list: Idea[]) => {
      if (list.length === 0) return;
      commit([...list, ...ideasRef.current]);
      for (const idea of list) schedule(idea);
    },
    [commit, schedule],
  );

  const removeIdea = useCallback(
    async (id: string) => {
      pending.current.delete(id);
      if (persistent.current) {
        try {
          await deleteIdea(id);
        } catch {
          setSaveState('error');
          return; // 沒刪成功就不要從畫面移除，避免畫面與儲存不一致
        }
      }
      let rest = ideasRef.current.filter((i) => i.id !== id);
      if (rest.length === 0) {
        const fresh = createIdea();
        rest = [fresh];
        schedule(fresh);
      }
      commit(rest);
      if (activeRef.current === id) {
        const next = [...rest].sort((a, b) => b.updatedAt - a.updatedAt)[0] as Idea;
        setActive(next.id);
      }
    },
    [commit, schedule, setActive],
  );

  const active = ideas.find((i) => i.id === activeId);
  const sorted = [...ideas].sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    ready,
    loadError,
    saveState,
    ideas: sorted,
    active,
    selectIdea: setActive,
    updateActive,
    newIdea,
    duplicateIdea,
    importIdeas,
    removeIdea,
  };
}
