import { STRUM_CELL_COUNTS, type StrumCell } from '../core';

interface Props {
  cells: StrumCell[];
  onChange: (cells: StrumCell[]) => void;
}

const NEXT: Record<StrumCell, StrumCell> = { '-': 'D', D: 'U', U: '-' };
const SYMBOL: Record<StrumCell, string> = { D: '↓', U: '↑', '-': '·' };
const NAME: Record<StrumCell, string> = { D: '下刷', U: '上刷', '-': '不刷' };
const COUNT = ['1', '&', '2', '&', '3', '&', '4', '&'];

/**
 * 自訂刷法：一小節八個八分音符，每格點一下輪流變成 下刷 → 上刷 → 不刷。
 * 可以選兩小節一輪（像民謠刷法第二小節略有變化的那種）。
 */
export function StrumEditor({ cells, onChange }: Props) {
  const bars = cells.length / 8;
  const setCount = (n: number) => {
    if (n === cells.length) return;
    onChange(n > cells.length ? [...cells, ...cells] : cells.slice(0, n));
  };
  const cycle = (i: number) => {
    const next = cells.map((c, j) => (j === i ? NEXT[c] : c));
    // 至少要刷一下，不然整個和弦沒聲音
    if (!next.includes('D') && !next.includes('U')) return;
    onChange(next);
  };
  return (
    <div className="strum-ed panel" role="group" aria-label="自訂刷法">
      <div className="strum-head">
        <h3 className="shapes-title">自訂刷法 <span className="help">點格子輪流換：下刷 → 上刷 → 不刷</span></h3>
        <div className="seg seg-sm" role="group" aria-label="一輪幾小節">
          {STRUM_CELL_COUNTS.map((n) => (
            <button key={n} type="button" className={`seg-btn ${cells.length === n ? 'is-on' : ''}`} aria-pressed={cells.length === n} onClick={() => setCount(n)}>
              {n / 8} 小節
            </button>
          ))}
        </div>
      </div>
      {Array.from({ length: bars }, (_, b) => (
        <div className="strum-bar" key={b}>
          {bars > 1 && <span className="strum-barno">第 {b + 1} 小節</span>}
          <div className="strum-cells">
            {COUNT.map((label, k) => {
              const i = b * 8 + k;
              const c = cells[i] as StrumCell;
              return (
                <button
                  key={i}
                  type="button"
                  className={`strum-cell strum-${c === 'D' ? 'down' : c === 'U' ? 'up' : 'rest'} ${k % 2 === 0 ? 'is-beat' : ''}`}
                  aria-label={`第 ${b + 1} 小節 ${label === '&' ? `第 ${Math.ceil(k / 2)} 拍後半` : `第 ${label} 拍`}：${NAME[c]}`}
                  onClick={() => cycle(i)}
                >
                  <span className="strum-sym" aria-hidden="true">{SYMBOL[c]}</span>
                  <span className="strum-count" aria-hidden="true">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
