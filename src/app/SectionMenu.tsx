import { useEffect, useRef } from 'react';
import { SECTION_LABELS, type SectionLabel } from '../core';
import { ConfirmButton } from './ConfirmButton';

interface Props {
  name: string;
  label: SectionLabel;
  linked: boolean;
  canMove: { left: boolean; right: boolean };
  canDelete: boolean;
  hasChords: boolean;
  onRelabel: (l: SectionLabel) => void;
  onMove: (dir: -1 | 1) => void;
  onRepeat: (linked: boolean) => void;
  onUnlink: () => void;
  onClear: () => void;
  onDelete: () => void;
}

/** 段落的「⋯」選單：不常用的段落操作都收在這裡，平常畫面只留和弦。 */
export function SectionMenu(p: Props) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  // 點選單外面或按 Esc 就關掉
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current?.open) close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  const act = (fn: () => void) => () => {
    fn();
    close();
  };

  return (
    <details className="menu" ref={ref}>
      <summary className="btn btn-sm btn-ghost menu-btn" aria-label={`${p.name}的更多操作`}>⋯</summary>
      <div className="menu-pop" role="group" aria-label={`${p.name}的操作`}>
        <label className="menu-row">
          <span>段落類型</span>
          <select className="input input-sm" value={p.label} onChange={(e) => p.onRelabel(e.target.value as SectionLabel)}>
            {SECTION_LABELS.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        <div className="menu-row">
          <button type="button" className="btn btn-sm btn-ghost" disabled={!p.canMove.left} onClick={() => p.onMove(-1)}>← 往前移</button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={!p.canMove.right} onClick={() => p.onMove(1)}>往後移 →</button>
        </div>
        <hr />
        <button type="button" className="menu-item" onClick={act(() => p.onRepeat(true))}>
          重複這段（連動）<small>改一個，另一個跟著變，適合副歌</small>
        </button>
        <button type="button" className="menu-item" onClick={act(() => p.onRepeat(false))}>
          複製成獨立段落<small>之後各改各的</small>
        </button>
        {p.linked && (
          <button type="button" className="menu-item" onClick={act(p.onUnlink)}>
            取消連動<small>保留現在的內容，之後各改各的</small>
          </button>
        )}
        <hr />
        {p.hasChords && (
          <button type="button" className="menu-item" onClick={act(p.onClear)}>清空這段的和弦</button>
        )}
        {p.canDelete && (
          <ConfirmButton label="刪除這個段落" confirmLabel="確定刪除？" ariaLabel={`刪除${p.name}`} onConfirm={p.onDelete} className="menu-item menu-danger" />
        )}
      </div>
    </details>
  );
}
