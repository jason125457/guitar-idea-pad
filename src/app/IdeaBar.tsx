import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SECTION_LABELS, labelName, sectionNames, type Idea, type SectionLabel } from '../core';
import type { SaveState } from '../store/useIdeaStore';

/** 破壞性操作要點兩次：第一次變成「確定？」，4 秒內沒按就還原。 */
function ConfirmButton({ label, confirmLabel, onConfirm, ariaLabel, className = 'btn btn-sm btn-ghost' }: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  ariaLabel: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className} ${armed ? 'is-danger' : ''}`}
      aria-label={armed ? `${confirmLabel}：${ariaLabel}` : ariaLabel}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

function saveText(state: SaveState, persistent: boolean): string {
  if (!persistent) return '無法儲存到本機，內容只暫存在這個分頁';
  switch (state) {
    case 'saving':
      return '儲存中…';
    case 'saved':
      return '已儲存在這台裝置';
    case 'error':
      return '儲存失敗，請稍後再試';
    default:
      return '';
  }
}

const when = (t: number) =>
  new Date(t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

interface Props {
  ideas: Idea[];
  idea: Idea;
  activeSectionId: string;
  saveState: SaveState;
  persistent: boolean;
  onSelectIdea: (id: string) => void;
  onNewIdea: () => void;
  onDuplicateIdea: (id: string) => void;
  onDeleteIdea: (id: string) => void;
  onRenameIdea: (title: string) => void;
  onSelectSection: (id: string) => void;
  onAddSection: (label: SectionLabel) => void;
  onRelabel: (label: SectionLabel) => void;
  onMove: (dir: -1 | 1) => void;
  onDeleteSection: () => void;
}

export function IdeaBar(p: Props) {
  const [listOpen, setListOpen] = useState(false);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const names = sectionNames(p.idea);
  const index = p.idea.sections.findIndex((s) => s.id === p.activeSectionId);
  const active = p.idea.sections[index];

  const onTabKey = (e: KeyboardEvent) => {
    const n = p.idea.sections.length;
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = (p.idea.sections[next] as { id: string }).id;
    p.onSelectSection(id);
    tabRefs.current.get(id)?.focus();
  };

  const chordTotal = (i: Idea) => i.sections.reduce((n, s) => n + s.progression.length, 0);

  return (
    <section className="ideabar panel" aria-label="靈感與段落">
      <div className="idea-top">
        <div className="idea-title">
          <label className="field" htmlFor="idea-title">靈感名稱</label>
          <input
            id="idea-title"
            className="input"
            value={p.idea.title}
            maxLength={60}
            onChange={(e) => p.onRenameIdea(e.target.value)}
            onBlur={(e) => {
              if (!e.target.value.trim()) p.onRenameIdea('未命名靈感');
            }}
            autoComplete="off"
          />
        </div>
        <div className="idea-actions">
          <button
            type="button"
            className="btn"
            aria-expanded={listOpen}
            aria-controls="idea-list"
            onClick={() => setListOpen((o) => !o)}
          >
            靈感清單（{p.ideas.length}）
          </button>
          <button type="button" className="btn btn-primary" onClick={() => { p.onNewIdea(); setListOpen(false); }}>
            ＋ 新靈感
          </button>
        </div>
      </div>
      <p className="save" role="status">{saveText(p.saveState, p.persistent)}</p>

      {listOpen && (
        <ul id="idea-list" className="idea-list">
          {p.ideas.map((i) => (
            <li key={i.id} className={`idea-row ${i.id === p.idea.id ? 'is-current' : ''}`}>
              <button
                type="button"
                className="idea-pick"
                aria-current={i.id === p.idea.id ? 'true' : undefined}
                onClick={() => { p.onSelectIdea(i.id); setListOpen(false); }}
              >
                <span className="idea-name">{i.title}</span>
                <span className="idea-meta">
                  {i.sections.length} 個段落 · {chordTotal(i)} 個和弦 · {when(i.updatedAt)}
                </span>
              </button>
              <button type="button" className="btn btn-sm btn-ghost" aria-label={`複製「${i.title}」`} onClick={() => p.onDuplicateIdea(i.id)}>
                複製
              </button>
              <ConfirmButton
                label="刪除"
                confirmLabel="確定刪除？"
                ariaLabel={`刪除「${i.title}」`}
                onConfirm={() => p.onDeleteIdea(i.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="tabs" role="tablist" aria-label="歌曲段落" onKeyDown={onTabKey}>
        {p.idea.sections.map((s) => {
          const on = s.id === p.activeSectionId;
          return (
            <button
              key={s.id}
              ref={(el) => {
                if (el) tabRefs.current.set(s.id, el);
                else tabRefs.current.delete(s.id);
              }}
              type="button"
              role="tab"
              id={`tab-${s.id}`}
              aria-selected={on}
              aria-controls="section-panel"
              tabIndex={on ? 0 : -1}
              className={`tab-btn tab-${s.label} ${on ? 'is-on' : ''}`}
              onClick={() => p.onSelectSection(s.id)}
            >
              {names[s.id]}
              <span className="tab-count" aria-hidden="true">{s.progression.length || ''}</span>
            </button>
          );
        })}
        <details className="add-sec">
          <summary>＋ 段落</summary>
          <div className="add-menu" role="group" aria-label="新增段落類型">
            {SECTION_LABELS.map((l) => (
              <button
                key={l.id}
                type="button"
                className="btn btn-sm"
                onClick={(e) => {
                  p.onAddSection(l.id);
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
        <div className="sec-tools">
          <label className="sec-type">
            <span className="field">這段是</span>
            <select
              className="input input-sm"
              value={active.label}
              onChange={(e) => p.onRelabel(e.target.value as SectionLabel)}
              aria-label={`段落類型，目前是${labelName(active.label)}`}
            >
              {SECTION_LABELS.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-sm btn-ghost" disabled={index <= 0} onClick={() => p.onMove(-1)} aria-label="段落往前移">
            ← 前移
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={index >= p.idea.sections.length - 1} onClick={() => p.onMove(1)} aria-label="段落往後移">
            後移 →
          </button>
          <ConfirmButton
            label="刪除段落"
            confirmLabel="確定刪除？"
            ariaLabel={`刪除${names[active.id] ?? '段落'}`}
            onConfirm={p.onDeleteSection}
            className={`btn btn-sm btn-ghost ${p.idea.sections.length <= 1 ? 'hidden' : ''}`}
          />
        </div>
      )}
    </section>
  );
}
