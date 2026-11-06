import { useEffect, type ReactNode } from 'react';
import { songLength, type Idea } from '../core';
import { ConfirmButton } from './ConfirmButton';

const when = (t: number) =>
  new Date(t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export const formatDuration = (sec: number): string => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

interface Props {
  ideas: Idea[];
  currentId: string;
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** 側邊欄底部的設定（音色、備份） */
  children?: ReactNode;
}

/**
 * 左側的「我的歌」：每首歌是一個獨立的專案。手機上收成抽屜，從頂端的按鈕打開。
 */
export function SongSidebar({ ideas, currentId, open, onClose, onSelect, onNew, onDuplicate, onDelete, children }: Props) {
  const sorted = [...ideas].sort((a, b) => b.updatedAt - a.updatedAt);
  // 手機抽屜打開時按 Esc 關掉
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <>
      <div className={`sb-scrim ${open ? 'is-open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="我的歌">
        <div className="sb-top">
          <span className="brand">指板靈感本</span>
          <button type="button" className="btn btn-sm btn-ghost sb-close" onClick={onClose} aria-label="關閉歌曲清單">✕</button>
        </div>

        <div className="sb-head">
          <h2 className="sb-title">我的歌</h2>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => { onNew(); onClose(); }}>＋ 新歌</button>
        </div>

        <ul className="sb-songs">
          {sorted.map((i) => {
            const on = i.id === currentId;
            const len = songLength(i);
            return (
              <li key={i.id} className={`sb-song ${on ? 'is-current' : ''}`}>
                <button
                  type="button"
                  className="sb-pick"
                  aria-current={on ? 'true' : undefined}
                  onClick={() => { onSelect(i.id); onClose(); }}
                >
                  <span className="sb-name">{i.title}</span>
                  <span className="sb-meta">
                    {i.sections.length} 段{len.beats ? ` · ${formatDuration(len.seconds)}` : ''} · {when(i.updatedAt)}
                  </span>
                </button>
                {on && (
                  <div className="sb-actions">
                    <button type="button" className="btn btn-sm btn-ghost" aria-label={`複製「${i.title}」`} onClick={() => onDuplicate(i.id)}>
                      複製
                    </button>
                    <ConfirmButton label="刪除" confirmLabel="確定刪除？" ariaLabel={`刪除「${i.title}」`} onConfirm={() => onDelete(i.id)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="sb-foot">{children}</div>
      </aside>
    </>
  );
}
