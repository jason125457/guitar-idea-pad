import { useEffect, useState } from 'react';
import type { ChordTag } from '../core';
import type { PlayPos } from './usePlayback';

export interface TimelineChord {
  id: string;
  name: string;
  roman: string;
  tag: ChordTag | undefined;
  beats: number;
}

interface Props {
  chords: TimelineChord[];
  selectedId: string | null;
  pos: PlayPos | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  addActive: boolean;
}

/** 一列放幾拍：桌機四小節（16 拍），手機兩小節（8 拍）。 */
function useColumns(): number {
  const query = '(min-width: 720px)';
  const get = () => (typeof window.matchMedia === 'function' && window.matchMedia(query).matches ? 16 : 8);
  const [cols, setCols] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setCols(mq.matches ? 16 : 8);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return cols;
}

/**
 * 小節時間軸：每個和弦方塊的寬度等於它佔的拍數，四拍一小節。
 * 播放時目前的和弦會亮起來，拍點一格一格跟著走（參考 Chordify、Riffstation 的做法）。
 */
export function Timeline({ chords, selectedId, pos, onSelect, onAdd, addActive }: Props) {
  const cols = useColumns();
  let beat = 0;
  return (
    <ol className="tl" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} aria-label="和弦時間軸（方塊寬度＝拍數）">
      {chords.map((c, i) => {
        const startBeat = beat;
        beat += c.beats;
        const playing = pos?.itemId === c.id;
        const selected = selectedId === c.id;
        const span = Math.min(c.beats, cols);
        return (
          <li
            key={c.id}
            className={`tl-block tl-tag-${c.tag ?? 'none'} ${selected ? 'is-sel' : ''} ${playing ? 'is-play' : ''} ${startBeat % 4 === 0 ? 'on-bar' : ''}`}
            style={{ gridColumn: `span ${span}` }}
          >
            <button
              type="button"
              className="tl-main"
              aria-pressed={selected}
              aria-label={`第 ${i + 1} 個和弦 ${c.name}，${c.beats} 拍${playing ? '，播放中' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              {startBeat % 4 === 0 && <span className="tl-bar" aria-hidden="true">{startBeat / 4 + 1}</span>}
              <span className="chip-name">{c.name}</span>
              <span className="chip-roman">{c.roman}</span>
              <span className="tl-beats" aria-hidden="true">
                {Array.from({ length: c.beats }, (_, b) => (
                  <span key={b} className={`tl-beat ${playing && pos?.beat === b ? 'on' : ''} ${playing && (pos?.beat ?? -1) > b ? 'past' : ''}`} />
                ))}
              </span>
            </button>
          </li>
        );
      })}
      <li className={`tl-block tl-add ${addActive ? 'is-sel' : ''}`} style={{ gridColumn: `span ${Math.min(4, cols)}` }}>
        <button type="button" className="tl-main" aria-pressed={addActive} onClick={onAdd}>
          <span className="tl-plus" aria-hidden="true">＋</span>
          <span>加和弦</span>
        </button>
      </li>
    </ol>
  );
}
