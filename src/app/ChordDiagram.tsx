import { formatFrets, type Finger, type Fret } from '../core';

interface Props {
  frets: readonly Fret[];
  fingers?: readonly Finger[] | undefined;
  /** 畫面寬度（px） */
  width?: number;
  /** 給螢幕閱讀器的名稱，例如「Fmaj7」 */
  name?: string;
}

const SX = 12; // 弦距
const SY = 15; // 品距
const OX = 16; // 左邊留給起始品格數字
const OY = 18; // 上面留給 × ○

/**
 * 直式和弦圖（跟吉他譜上的一樣）：六條弦由左到右＝六弦到一弦，點上標手指編號，
 * 頂端 × 是不彈、○ 是空弦；不在第一品時左上角標起始品格。
 */
export function ChordDiagram({ frets, fingers, width = 76, name }: Props) {
  const pressed = frets.filter((f): f is number => f !== null && f > 0);
  const hi = pressed.length ? Math.max(...pressed) : 0;
  const lo = pressed.length ? Math.min(...pressed) : 1;
  const base = hi <= 4 ? 1 : lo;
  const rows = Math.max(4, hi - base + 1);
  const w = OX + SX * 5 + 10;
  const h = OY + SY * rows + 4;
  const x = (s: number) => OX + s * SX;

  return (
    <svg className="cd" viewBox={`0 0 ${w} ${h}`} width={width} role="img" aria-label={`${name ? `${name} ` : ''}指法 ${formatFrets(frets)}`}>
      <line x1={OX} y1={OY} x2={x(5)} y2={OY} className="cd-nut" strokeWidth={base === 1 ? 3.5 : 1} />
      {Array.from({ length: rows }, (_, r) => (
        <line key={`f${r}`} x1={OX} y1={OY + (r + 1) * SY} x2={x(5)} y2={OY + (r + 1) * SY} className="cd-fret" />
      ))}
      {Array.from({ length: 6 }, (_, s) => (
        <line key={`s${s}`} x1={x(s)} y1={OY} x2={x(s)} y2={OY + rows * SY} className="cd-string" />
      ))}
      {base > 1 && (
        <text x={2} y={OY + SY * 0.72} className="cd-base">{base}</text>
      )}
      {frets.map((f, s) => {
        if (f === null) return <text key={s} x={x(s)} y={OY - 6} className="cd-mute" textAnchor="middle">×</text>;
        if (f === 0) return <circle key={s} cx={x(s)} cy={OY - 8} r={3} className="cd-open" />;
        const cy = OY + (f - base + 0.5) * SY;
        const fg = fingers?.[s];
        return (
          <g key={s}>
            <circle cx={x(s)} cy={cy} r={5.4} className="cd-dot" />
            {fg ? <text x={x(s)} y={cy + 3.2} className="cd-finger" textAnchor="middle">{fg}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}
