import { useRef, useState, type KeyboardEvent } from 'react';
import { SECTION_LABELS, type SectionLabel } from '../core';
import { ConfirmButton } from './ConfirmButton';

export interface StructureBlock {
  id: string;
  name: string;
  label: SectionLabel;
  bars: number;
  /** 前幾個和弦名稱，讓使用者不用點進去就認得出這段 */
  summary: string;
  /** 和這段連動的其他段落名稱 */
  linkedWith: string[];
}

interface Props {
  blocks: StructureBlock[];
  activeId: string;
  playingId: string | null;
  onSelect: (id: string) => void;
  onMoveTo: (id: string, index: number) => void;
  onAdd: (label: SectionLabel) => void;
  onRelabel: (label: SectionLabel) => void;
  onRepeat: (linked: boolean) => void;
  onUnlink: () => void;
  onDelete: () => void;
}

const fmtBars = (b: number) => (Number.isInteger(b) ? `${b}` : b.toFixed(1));

/**
 * 歌曲結構條：段落由左到右排成整首歌，寬度＝小節數，顏色＝段落類型。
 * 點一下切換到那一段，拖曳或用方向鍵＋Alt 調整順序；「重複這段」可以讓副歌 1、副歌 2 連動。
 */
export function SongStructure(p: Props) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const index = p.blocks.findIndex((b) => b.id === p.activeId);
  const active = p.blocks[index];

  const focus = (id: string) => requestAnimationFrame(() => refs.current.get(id)?.focus());

  const onKey = (e: KeyboardEvent) => {
    const n = p.blocks.length;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && active) {
      e.preventDefault();
      p.onMoveTo(active.id, index + (e.key === 'ArrowRight' ? 1 : -1));
      focus(active.id);
      return;
    }
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = (p.blocks[next] as StructureBlock).id;
    p.onSelect(id);
    focus(id);
  };

  return (
    <section className="panel structure" aria-labelledby="h-structure">
      <div className="st-head">
        <h2 id="h-structure">歌曲結構</h2>
        <span className="help st-hint">寬度＝小節數 · 拖曳可以調整順序</span>
      </div>

      <div className="st-strip" role="tablist" aria-label="歌曲段落" onKeyDown={onKey}>
        {p.blocks.map((b, i) => {
          const on = b.id === p.activeId;
          return (
            <button
              key={b.id}
              ref={(el) => {
                if (el) refs.current.set(b.id, el);
                else refs.current.delete(b.id);
              }}
              type="button"
              role="tab"
              id={`tab-${b.id}`}
              aria-selected={on}
              aria-controls="section-panel"
              tabIndex={on ? 0 : -1}
              aria-label={`${b.name}，${fmtBars(b.bars)} 小節${b.linkedWith.length ? `，和 ${b.linkedWith.join('、')} 連動` : ''}`}
              className={`st-block sec-${b.label} ${on ? 'is-on' : ''} ${p.playingId === b.id ? 'is-play' : ''} ${overIndex === i && dragId !== b.id ? 'is-over' : ''}`}
              style={{ flex: `${Math.max(1, b.bars)} 1 calc(${Math.max(1, b.bars)} * 40px)` }}
              draggable
              onDragStart={(e) => {
                setDragId(b.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', b.id);
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverIndex(i);
              }}
              onDragLeave={() => setOverIndex((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) p.onMoveTo(dragId, i);
                setDragId(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverIndex(null);
              }}
              onClick={() => p.onSelect(b.id)}
            >
              <span className="st-name">
                {b.name}
                {b.linkedWith.length > 0 && <span className="st-link" aria-hidden="true">連動</span>}
              </span>
              <span className="st-meta">{b.bars ? `${fmtBars(b.bars)} 小節` : '空的'}</span>
              {b.summary && <span className="st-sum mono">{b.summary}</span>}
            </button>
          );
        })}
        <details className="add-sec st-add">
          <summary>＋ 加段落</summary>
          <div className="add-menu" role="group" aria-label="新增段落類型">
            {SECTION_LABELS.map((l) => (
              <button
                key={l.id}
                type="button"
                className="btn btn-sm"
                onClick={(e) => {
                  p.onAdd(l.id);
                  (e.currentTarget.closest('details') as HTMLDetailsElement).open = false;
                }}
              >
                {l.name}
              </button>
            ))}
          </div>
        </details>
      </div>

      {active && (
        <div className="st-tools">
          <label className="sec-type">
            <span className="sr-only">段落類型</span>
            <select
              className="input input-sm"
              value={active.label}
              onChange={(e) => p.onRelabel(e.target.value as SectionLabel)}
              aria-label={`${active.name}的段落類型`}
            >
              {SECTION_LABELS.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-sm btn-ghost" disabled={index <= 0} onClick={() => p.onMoveTo(active.id, index - 1)} aria-label="段落往前移">
            ← 前移
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={index >= p.blocks.length - 1} onClick={() => p.onMoveTo(active.id, index + 1)} aria-label="段落往後移">
            後移 →
          </button>
          <button type="button" className="btn btn-sm" onClick={() => p.onRepeat(true)}>
            重複這段（連動）
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => p.onRepeat(false)}>
            複製成獨立段落
          </button>
          {active.linkedWith.length > 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={p.onUnlink}>
              取消連動
            </button>
          )}
          <ConfirmButton
            label="刪除段落"
            confirmLabel="確定刪除？"
            ariaLabel={`刪除${active.name}`}
            onConfirm={p.onDelete}
            className={`btn btn-sm btn-ghost ${p.blocks.length <= 1 ? 'hidden' : ''}`}
          />
        </div>
      )}
    </section>
  );
}
