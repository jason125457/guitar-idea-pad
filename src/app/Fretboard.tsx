import { useEffect, useState } from 'react';
import type { Fret } from '../core';

const ROWS = 5;
const STRING_LABELS = ['六弦', '五弦', '四弦', '三弦', '二弦', '一弦'];
const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

interface Props {
  frets: Fret[];
  onChange: (next: Fret[]) => void;
}

/** 直式和弦圖：六條弦由左到右＝六弦到一弦（與文字輸入順序一致）。 */
export function Fretboard({ frets, onChange }: Props) {
  const [start, setStart] = useState(1);

  // 指法改變時，讓視窗涵蓋所有按住的品位
  useEffect(() => {
    const pressed = frets.filter((f): f is number => f !== null && f > 0);
    if (pressed.length === 0) return;
    const lo = Math.min(...pressed);
    const hi = Math.max(...pressed);
    setStart((s) => (lo < s || hi >= s + ROWS ? Math.max(1, Math.min(lo, 20 - ROWS + 1)) : s));
  }, [frets]);

  const set = (s: number, value: Fret) => {
    const next = [...frets];
    next[s] = value;
    onChange(next);
  };

  const rows = Array.from({ length: ROWS }, (_, i) => start + i);

  return (
    <div className="fb" role="group" aria-label="虛擬指板">
      <div className="fb-head">
        {frets.map((f, s) => {
          const outOfView = f !== null && f > 0 && (f < start || f >= start + ROWS);
          const label = f === null ? '悶音' : f === 0 ? '空弦' : outOfView ? `${f} 品` : '未按';
          return (
            <button
              key={s}
              type="button"
              className={`fb-top ${f === null ? 'is-mute' : f === 0 ? 'is-open' : ''}`}
              aria-label={`${STRING_LABELS[s]}（${STRING_NAMES[s]}）目前：${label}，點擊切換空弦或悶音`}
              onClick={() => set(s, f === 0 ? null : 0)}
            >
              <span aria-hidden="true">{f === null ? '×' : f === 0 ? '○' : outOfView ? f : STRING_NAMES[s]}</span>
            </button>
          );
        })}
      </div>

      <div className="fb-grid">
        {rows.map((fret) => (
          <div className="fb-row" key={fret}>
            <span className="fb-fretno" aria-hidden="true">{fret}</span>
            {frets.map((cur, s) => {
              const on = cur === fret;
              return (
                <button
                  key={s}
                  type="button"
                  className="fb-cell"
                  aria-pressed={on}
                  aria-label={`${STRING_LABELS[s]} 第 ${fret} 品`}
                  onClick={() => set(s, on ? null : fret)}
                >
                  <span className={`fb-dot ${on ? 'on' : ''}`} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="fb-nav">
        <button type="button" className="btn btn-ghost" onClick={() => setStart((s) => Math.max(1, s - 1))} disabled={start <= 1} aria-label="指板往低把位移動">
          ‹ 低把位
        </button>
        <span className="fb-range">第 {start}–{start + ROWS - 1} 品</span>
        <button type="button" className="btn btn-ghost" onClick={() => setStart((s) => Math.min(20, s + 1))} disabled={start >= 20} aria-label="指板往高把位移動">
          高把位 ›
        </button>
      </div>
    </div>
  );
}
