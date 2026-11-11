import { useEffect, useState } from 'react';
import { midiName, type BeatNote, type ChordTag, type MelodyFit } from '../core';
import type { PlayPos } from './usePlayback';

export interface TimelineChord {
  id: string;
  name: string;
  roman: string;
  tag: ChordTag | undefined;
  beats: number;
  /** 跟這幾拍的旋律合不合（有錄旋律時才有） */
  fit?: MelodyFit | undefined;
  /** 有摩擦的旋律音名，例如「F4、B4」 */
  clashText?: string;
  /** 這幾拍的旋律還有別的和弦可以配（顯示「換一個」） */
  canSwap?: boolean;
}

interface Props {
  chords: TimelineChord[];
  selectedId: string | null;
  pos: PlayPos | null;
  onSelect: (id: string) => void;
  /** 拖曳排序：把 id 這個和弦移到第 toIndex 個位置 */
  /** 選中的和弦上方的快捷鍵：直接改成 2 拍或 4 拍 */
  onBeats?: (id: string, beats: number) => void;
  onReorder?: (id: string, toIndex: number) => void;
  /** 換成下一個也合這幾拍旋律的和弦（輪流） */
  onSwap?: (id: string) => void;
  onAdd: () => void;
  addActive: boolean;
  /** 跟著這段唱錄下的旋律（拍點對齊段落開頭） */
  melody?: readonly BeatNote[];
  /** 和弦後面還有幾小節只唱了旋律、還沒配和弦 */
  ghostBars?: number;
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
export function Timeline({ chords, selectedId, pos, onSelect, onBeats, onReorder, onSwap, onAdd, addActive, melody = [], ghostBars = 0 }: Props) {
  const cols = useColumns();
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null);
  const dragFrom = drag ? chords.findIndex((c) => c.id === drag.id) : -1;
  // 旋律的高低範圍：至少涵蓋一個八度（置中），只錄了幾個相近的音時，音高差才不會被放大成大跳
  const minMidi = melody.length ? Math.min(...melody.map((n) => n.midi)) : 0;
  const maxMidi = melody.length ? Math.max(...melody.map((n) => n.midi)) : 0;
  const span = Math.max(12, maxMidi - minMidi + 2);
  const lo = (minMidi + maxMidi) / 2 - span / 2;
  /** 畫出 [start, start + len) 拍之間的旋律 */
  const lane = (start: number, len: number) => (
    <span className="tl-mel" aria-hidden="true">
      {melody
        .filter((n) => n.beat < start + len && n.beat + n.beats > start)
        .map((n) => {
          const a = Math.max(n.beat, start);
          const b = Math.min(n.beat + n.beats, start + len);
          return (
            <span
              key={`${n.beat}-${n.midi}`}
              className="tl-note"
              title={midiName(n.midi)}
              style={{ left: `${((a - start) / len) * 100}%`, width: `${((b - a) / len) * 100}%`, bottom: `calc((100% - 14px) * ${(n.midi - lo) / span})` }}
            >
              {midiName(n.midi)}
            </span>
          );
        })}
    </span>
  );
  let beat = 0;
  const chordBeats = chords.reduce((n, c) => n + c.beats, 0);
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
            className={`tl-block tl-tag-${c.tag ?? 'none'} ${selected ? 'is-sel' : ''} ${playing ? 'is-play' : ''} ${startBeat % 4 === 0 ? 'on-bar' : ''} ${drag?.id === c.id ? 'is-dragging' : ''} ${drag && drag.over === i && dragFrom !== i ? (dragFrom > i ? 'drop-before' : 'drop-after') : ''}`}
            style={{ gridColumn: `span ${span}` }}
          >
            <button
              type="button"
              className="tl-main"
              aria-pressed={selected}
              aria-label={`第 ${i + 1} 個和弦 ${c.name}，${c.beats} 拍${c.fit === 'clash' ? `，跟旋律的 ${c.clashText ?? ''} 有摩擦` : ''}${playing ? '，播放中' : ''}`}
              onClick={() => onSelect(c.id)}
              {...(onReorder
                ? {
                    draggable: true,
                    onDragStart: (e: React.DragEvent) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', c.id);
                      setDrag({ id: c.id, over: null });
                    },
                    onDragOver: (e: React.DragEvent) => {
                      if (!drag) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (drag.over !== i) setDrag({ id: drag.id, over: i });
                    },
                    onDrop: (e: React.DragEvent) => {
                      e.preventDefault();
                      if (drag && dragFrom !== i) onReorder(drag.id, i);
                      setDrag(null);
                    },
                    onDragEnd: () => setDrag(null),
                  }
                : {})}
            >
              {startBeat % 4 === 0 && <span className="tl-bar" aria-hidden="true">{startBeat / 4 + 1}</span>}
              {melody.length > 0 && lane(startBeat, c.beats)}
              <span className="chip-name">{c.name}</span>
              <span className="chip-roman">{c.roman}</span>
              {c.fit === 'clash' && <span className="tl-clash" title={`跟旋律的 ${c.clashText ?? ''} 有半音摩擦`}>摩擦</span>}
              <span className="tl-beats" aria-hidden="true">
                {Array.from({ length: c.beats }, (_, b) => (
                  <span key={b} className={`tl-beat ${playing && pos?.beat === b ? 'on' : ''} ${playing && (pos?.beat ?? -1) > b ? 'past' : ''}`} />
                ))}
              </span>
            </button>
            {selected && onBeats && (
              <span className="tl-float-bar" role="group" aria-label={`第 ${i + 1} 個和弦的拍數`}>
                {[2, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`tl-float-btn ${c.beats === n ? 'is-active' : ''}`}
                    aria-pressed={c.beats === n}
                    aria-label={`設為 ${n} 拍`}
                    onClick={() => onBeats(c.id, n)}
                  >
                    {n}拍
                  </button>
                ))}
                {c.canSwap && onSwap && (
                  <button type="button" className="tl-float-btn tl-swap" aria-label={`第 ${i + 1} 個和弦換一個也合旋律的和弦`} onClick={() => onSwap(c.id)}>
                    換一個
                  </button>
                )}
              </span>
            )}
          </li>
        );
      })}
      {Array.from({ length: ghostBars }, (_, g) => (
        <li key={`ghost-${g}`} className="tl-block tl-ghost" style={{ gridColumn: `span ${Math.min(4, cols)}` }}>
          <div className="tl-main">
            {(chordBeats + g * 4) % 4 === 0 && <span className="tl-bar" aria-hidden="true">{(chordBeats + g * 4) / 4 + 1}</span>}
            {lane(chordBeats + g * 4, 4)}
            <span className="tl-ghost-text">還沒配和弦</span>
          </div>
        </li>
      ))}
      <li className={`tl-block tl-add ${addActive ? 'is-sel' : ''}`} style={{ gridColumn: `span ${Math.min(4, cols)}` }}>
        <button type="button" className="tl-main" aria-pressed={addActive} onClick={onAdd}>
          <span className="tl-plus" aria-hidden="true">＋</span>
          <span>加和弦</span>
        </button>
      </li>
    </ol>
  );
}
