import { useEffect, useMemo, useState } from 'react';
import {
  BEAT_CHOICES,
  analyzeVoicing,
  chordSymbol,
  chordToneSpeller,
  formatFingers,
  formatFrets,
  midiName,
  parseFretInput,
  suggestFingering,
  type Fret,
  type MelodyFit,
  type RankedShape,
  type Speller,
} from '../core';
import { ChordDiagram } from './ChordDiagram';
import { Fretboard } from './Fretboard';

const EMPTY: Fret[] = [null, null, null, null, null, null];
const MAX_BEATS = Math.max(...BEAT_CHOICES);

interface Common {
  frets: Fret[];
  onFrets: (f: Fret[]) => void;
  /** 依調性拼音；沒有調性時用預設拼法 */
  speller: Speller | undefined;
  onPlay: () => void;
}

interface EditProps extends Common {
  mode: 'edit';
  index: number;
  roman: string;
  tagText: string;
  tagClass: string;
  beats: number;
  onBeats: (n: number) => void;
  /** 同一個和弦的各種按法（已依跟前後和弦好不好接排序） */
  shapes: RankedShape[];
  onPickShape: (f: Fret[]) => void;
  /** 這個和弦撐的那幾拍唱了什麼、合不合，以及也合這段旋律的其他和弦 */
  melody?: {
    sung: string;
    fit: MelodyFit | undefined;
    clashText: string;
    ideas: { name: string; fit: MelodyFit; onUse: () => void; onHear: () => void }[];
  };
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  canMove: { left: boolean; right: boolean };
  onClose: () => void;
}

interface DraftProps extends Common {
  mode: 'draft';
  sectionName: string;
  onAdd: () => void;
}

/**
 * 選中的和弦：指法圖（含手指編號）、換按法、拍數、刪除，改的就是時間軸上那一格。
 * 沒有選和弦時是「自己按一個新和弦」的編輯區。
 */
export function ChordInspector(p: EditProps | DraftProps) {
  const [text, setText] = useState(() => (p.frets.some((f) => f !== null) ? formatFrets(p.frets) : ''));
  const [error, setError] = useState('');

  // 指法從外面改了（換按法、點指板），文字框跟著更新；正在打的字若已經代表同一個指法就不動
  useEffect(() => {
    const r = parseFretInput(text);
    const same = r.ok ? formatFrets(r.frets) === formatFrets(p.frets) : false;
    if (!same && !(text.trim() === '' && p.frets.every((f) => f === null))) {
      setText(p.frets.some((f) => f !== null) ? formatFrets(p.frets) : '');
      setError('');
    }
    // 只在指法改變時同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.frets]);

  const onText = (value: string) => {
    setText(value);
    if (!value.trim()) {
      setError('');
      p.onFrets(EMPTY);
      return;
    }
    const r = parseFretInput(value);
    if (r.ok) {
      setError('');
      p.onFrets(r.frets);
    } else setError(r.error);
  };

  const current = useMemo(() => analyzeVoicing(p.frets), [p.frets]);
  const fingering = useMemo(() => suggestFingering(p.frets), [p.frets]);
  const hasPressed = p.frets.some((f) => f !== null && f > 0);
  const name = current.best ? chordSymbol(current.best, p.speller) : undefined;

  // 指板與文字輸入：自己按新和弦時直接攤開；調整已選的和弦時收起來，需要再打開
  const boardEditor = (
    <>
      <Fretboard frets={p.frets} onChange={p.onFrets} fingers={fingering} />
      {hasPressed && (
        <p className="fingers-line">
          {fingering ? (
            <>手指 <span className="mono">{formatFingers(fingering)}</span>（1 食指、2 中指、3 無名指、4 小指、T 拇指）</>
          ) : (
            '這個按法需要超過四隻手指或跨太多品格，不容易按'
          )}
        </p>
      )}

      <label className="field" htmlFor="fret-text">六弦 → 一弦，x 代表悶音</label>
      <input
        id="fret-text"
        className="input mono"
        autoComplete="off"
        spellCheck={false}
        placeholder="8 10 10 9 8 8"
        value={text}
        onChange={(e) => onText(e.target.value)}
        aria-invalid={!!error}
        aria-describedby="fret-help"
      />
      <p id="fret-help" className={error ? 'help err' : 'help'} role={error ? 'alert' : undefined}>
        {error || '也可以直接打指法；兩位數品格請用空格分開，如 x 3 2 0 1 0'}
      </p>
    </>
  );

  return (
    <section className={p.mode === 'edit' ? 'panel inspector' : 'inspector inspector-bare'} aria-labelledby={p.mode === 'edit' ? 'h-inspector' : undefined}>
      {p.mode === 'edit' && (
        <div className="insp-head">
          <h2 id="h-inspector">第 {p.index + 1} 個和弦</h2>
          <button type="button" className="btn btn-sm btn-ghost insp-x" onClick={p.onClose} aria-label="取消選取，回到加和弦">✕</button>
        </div>
      )}

      <div className="now" aria-live="polite">
        {current.best ? (
          <>
            <div className="now-top">
              <span className="now-name">{name}</span>
              {p.mode === 'edit' && p.roman && <span className="chip-roman">{p.roman}</span>}
              {p.mode === 'edit' && p.tagText && <span className={`tag ${p.tagClass}`}>{p.tagText}</span>}
            </div>
            <div className="now-notes mono">
              {current.notes.map((n) => midiName(n.midi, chordToneSpeller(current.best!, p.speller))).join(' ')}
            </div>
            {current.candidates.length > 1 && (
              <div className="alts">
                也可以叫：
                {current.candidates.slice(1, 4).map((c) => (
                  <span className="alt" key={`${c.rootPc}-${c.qualityId}-${c.bassPc}`}>{chordSymbol(c, p.speller)}</span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="now-empty">{current.notes.length ? '只有單音，還不能判斷和弦' : '在下面的指板點出按法，這裡會顯示和弦名稱'}</div>
        )}
      </div>

      {p.mode === 'edit' && p.melody && (
        <div className={`mel-fit mel-${p.melody.fit ?? 'none'}`}>
          <h3 className="shapes-title">跟旋律合不合</h3>
          <p className="mel-sung">
            這裡唱了 <span className="mono">{p.melody.sung}</span>
          </p>
          <p className="mel-verdict">
            {p.melody.fit === 'clash'
              ? `${p.melody.clashText} 跟這個和弦差半音，聽起來會刺。可以換成下面合旋律的和弦，或改一下旋律。`
              : p.melody.fit === 'stable'
                ? '旋律大多落在和弦音上，很穩。'
                : '旋律有一些延伸音，不衝突，帶一點色彩。'}
          </p>
          {p.melody.ideas.length > 0 && (
            <>
              <p className="help mel-ideas-label">{p.melody.fit === 'clash' ? '換成這些就不會摩擦：' : '這段旋律也可以配：'}</p>
              <ul className="mel-ideas">
                {p.melody.ideas.map((i) => (
                  <li key={i.name} className="mel-idea">
                    <button type="button" className="btn btn-sm" onClick={i.onUse} aria-label={`換成 ${i.name}`}>
                      換成 <strong>{i.name}</strong>
                      <span className={`mel-tag mel-tag-${i.fit}`}>{i.fit === 'stable' ? '很穩' : '帶色彩'}</span>
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={i.onHear} aria-label={`試聽 ${i.name} 配旋律`}>▶</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {p.mode === 'edit' && p.shapes.length > 1 && (
        <div className="shapes">
          <h3 className="shapes-title">按法 <span className="help">點一下就換上，第一個最好接</span></h3>
          <ul className="shapes-list">
            {p.shapes.map((sh) => {
              const where = sh.position === 0 ? '空弦' : sh.open && sh.position <= 4 ? '開放和弦' : `第 ${sh.position} 品`;
              const desc = `${where} · ${sh.strings} 條弦${sh.barre ? ' · 封閉' : ''}`;
              return (
                <li key={formatFrets(sh.frets)}>
                  <button
                    type="button"
                    className={`shape ${sh.current ? 'is-on' : ''}`}
                    aria-pressed={sh.current}
                    aria-label={`${name ?? ''} ${desc}，指法 ${formatFrets(sh.frets)}${sh.best ? '，最好接' : ''}`}
                    onClick={() => p.onPickShape(sh.frets)}
                  >
                    <ChordDiagram frets={sh.frets} fingers={sh.fingers} width={88} />
                    <span className="shape-desc">{desc}</span>
                    {(sh.best || sh.current) && (
                      <span className="shape-badges">
                        {sh.best && <span className="shape-badge sb-best">最好接</span>}
                        {sh.current && <span className="shape-badge sb-now">目前</span>}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {p.mode === 'draft' && boardEditor}

      {p.mode === 'edit' ? (
        <>
          <div className="insp-controls">
            <button type="button" className="btn btn-sm" disabled={!current.notes.length} onClick={p.onPlay}>▶ 試聽</button>
            <div className="stepper" role="group" aria-label="拍數">
              <button type="button" className="btn btn-sm" disabled={p.beats <= 1} onClick={() => p.onBeats(p.beats - 1)} aria-label="少一拍">−</button>
              <output className="stepper-val" aria-live="polite">{p.beats} 拍</output>
              <button type="button" className="btn btn-sm" disabled={p.beats >= MAX_BEATS} onClick={() => p.onBeats(p.beats + 1)} aria-label="多一拍">＋</button>
            </div>
          </div>
          <div className="insp-controls">
            <button type="button" className="btn btn-sm btn-ghost" disabled={!p.canMove.left} onClick={() => p.onMove(-1)} aria-label="往前移一格">← 前移</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={!p.canMove.right} onClick={() => p.onMove(1)} aria-label="往後移一格">後移 →</button>
            <button type="button" className="btn btn-sm btn-ghost insp-del" onClick={p.onDelete} aria-label={`刪除 ${name ?? '這個和弦'}`}>刪除</button>
          </div>
          <details className="insp-more">
            <summary>自己用指板調整</summary>
            {boardEditor}
          </details>
        </>
      ) : (
        <div className="row wrap">
          <button type="button" className="btn" disabled={!current.notes.length} onClick={p.onPlay}>▶ 試聽</button>
          <button type="button" className="btn btn-primary" disabled={!current.best} onClick={p.onAdd}>
            ＋ 加入{p.sectionName}
          </button>
        </div>
      )}
    </section>
  );
}
