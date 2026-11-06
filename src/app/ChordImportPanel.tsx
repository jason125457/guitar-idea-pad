import { useEffect, useMemo, useState } from 'react';
import { playTimedChords, stopAll, strumBeats } from '../audio/pluck';
import {
  DEFAULT_BEATS,
  SECTION_LABELS,
  chordSymbol,
  formatFingers,
  formatFrets,
  suggestFingering,
  fretsToNotes,
  parseProgressionText,
  voiceProgression,
  voicingChoices,
  type ChordRef,
  type Fret,
  type SectionLabel,
  type VoicingStyle,
} from '../core';

const fingersOf = (frets: readonly Fret[]): string | undefined => {
  const f = suggestFingering(frets);
  return f ? formatFingers(f) : undefined;
};

const EXAMPLE = `主歌：Cadd9 → Fmaj7#11
導歌：Am7 → Em7 → Fmaj7 → G
副歌：C → G/B → Am7 → Fmaj7`;

export interface ImportRow {
  label: SectionLabel;
  frets: Fret[][];
}

interface Props {
  /** 指法風格（和弦盤那裡切換，兩邊共用） */
  style: VoicingStyle;
  sectionName: string;
  hasChords: boolean;
  /** 一拍幾秒（依目前段落的速度），試聽時每個和弦刷四拍 */
  beatSec: number;
  /** 把指法放到上方的編輯區（指板）看清楚 */
  onPreview: (frets: Fret[]) => void;
  onAddHere: (frets: Fret[][], mode: 'append' | 'replace') => void;
  onAddSections: (rows: ImportRow[]) => void;
}

export function ChordImportPanel({ style, sectionName, hasChords, beatSec, onPreview, onAddHere, onAddSections }: Props) {
  const [text, setText] = useState('');
  /** 使用者改過的勾選；沒改過的依 likely（這行主要是和弦）決定 */
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [labels, setLabels] = useState<Record<number, SectionLabel>>({});
  /** 使用者換過的指法：key 為「行-第幾個和弦」，值為候選中的第幾個 */
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [done, setDone] = useState('');

  const rows = useMemo(() => parseProgressionText(text), [text]);
  // 文字或風格改了，勾選、段落與換過的指法都重來
  useEffect(() => {
    setChecked({});
    setLabels({});
    setPicks({});
    setDone('');
  }, [text, style]);
  useEffect(() => () => stopAll(), []);

  const voiced = useMemo(
    () =>
      rows.map((r) => {
        const chords = r.tokens.map((t) => t.chord).filter((c): c is ChordRef => c !== undefined);
        const auto = voiceProgression(chords, style);
        return chords.map((c, i) => {
          const choices = voicingChoices(c, style, 6).map((v) => v.frets);
          // 自動挑的那個放第一個，其餘依成本排
          const autoFrets = auto[i] as Fret[];
          const rest = choices.filter((f) => formatFrets(f) !== formatFrets(autoFrets));
          return { chord: c, choices: [autoFrets, ...rest] };
        });
      }),
    [rows, style],
  );

  const fretsOf = (ri: number): Fret[][] =>
    (voiced[ri] ?? []).map((v, ci) => v.choices[(picks[`${ri}-${ci}`] ?? 0) % v.choices.length] as Fret[]);
  const chosen = rows.map((r, ri) => ((checked[ri] ?? r.likely) ? ri : -1)).filter((ri) => ri >= 0);
  const labelOf = (ri: number): SectionLabel => labels[ri] ?? rows[ri]?.label ?? 'verse';
  const unknownCount = rows.reduce((n, r, ri) => n + (chosen.includes(ri) ? r.tokens.filter((t) => !t.chord).length : 0), 0);

  const play = (ri: number) =>
    playTimedChords(strumBeats(fretsOf(ri).map((f) => ({ midis: fretsToNotes(f).map((n) => n.midi), beats: DEFAULT_BEATS })), beatSec));

  const addHere = (mode: 'append' | 'replace') => {
    const frets = chosen.flatMap((ri) => fretsOf(ri));
    onAddHere(frets, mode);
    setDone(`已把 ${frets.length} 個和弦${mode === 'replace' ? '取代進' : '加進'}${sectionName}`);
  };
  const addSections = () => {
    onAddSections(chosen.map((ri) => ({ label: labelOf(ri), frets: fretsOf(ri) })));
    setDone(`已新增 ${chosen.length} 個段落，切到第一個新段落`);
  };

  return (
    <details className="import" open={text.length > 0 || undefined}>
      <summary>貼上 AI 建議的和弦進行</summary>
      <p className="help">
        直接貼整段建議也可以：每一行裡用 → 或空格串起來的和弦會被挑出來，說明文字會略過。挑好指法後可以先試聽，再加進段落。
      </p>
      <label className="field" htmlFor="import-text">和弦進行</label>
      <textarea
        id="import-text"
        className="input mono import-text"
        rows={4}
        spellCheck={false}
        autoComplete="off"
        placeholder={EXAMPLE}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {!text && (
        <button type="button" className="btn btn-sm" onClick={() => setText(EXAMPLE)}>
          填入範例
        </button>
      )}

      {text.trim() && rows.length === 0 && (
        <p className="help err" role="alert">沒有找到和弦進行。每一行至少要有兩個和弦，例如 C → Fmaj7。</p>
      )}

      {rows.length > 0 && (
        <ol className="import-rows">
          {rows.map((r, ri) => {
            const on = chosen.includes(ri);
            const vs = voiced[ri] ?? [];
            let k = 0;
            return (
              <li key={ri} className={`import-row ${on ? '' : 'is-off'}`}>
                <div className="import-head">
                  <label className="import-check">
                    <input type="checkbox" checked={on} onChange={() => setChecked((c) => ({ ...c, [ri]: !on }))} />
                    <span className="import-line">{r.line}</span>
                  </label>
                  <label className="import-label">
                    <span className="sr-only">第 {ri + 1} 行的段落</span>
                    <select value={labelOf(ri)} onChange={(e) => setLabels((l) => ({ ...l, [ri]: e.target.value as SectionLabel }))}>
                      {SECTION_LABELS.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <ul className="import-chords">
                  {r.tokens.map((t, ti) => {
                    if (!t.chord) {
                      return (
                        <li key={ti} className="import-chord is-bad" title="看不懂或還不支援這個和弦，匯入時會跳過">
                          <span className="import-name">{t.text}</span>
                          <span className="import-frets">看不懂，會跳過</span>
                        </li>
                      );
                    }
                    const ci = k++;
                    const v = vs[ci];
                    if (!v) return null;
                    const idx = (picks[`${ri}-${ci}`] ?? 0) % v.choices.length;
                    const frets = v.choices[idx] as Fret[];
                    const sym = chordSymbol(v.chord);
                    return (
                      <li key={ti} className="import-chord">
                        <button type="button" className="import-main" onClick={() => onPreview(frets)} aria-label={`把 ${sym} 的指法放到指板上`}>
                          <span className="import-name">{sym}</span>
                          <span className="import-frets mono">{formatFrets(frets)}</span>
                          {fingersOf(frets) && <span className="import-frets mono">手指 {fingersOf(frets)}</span>}
                        </button>
                        {v.choices.length > 1 && (
                          <button
                            type="button"
                            className="import-next"
                            onClick={() => setPicks((p) => ({ ...p, [`${ri}-${ci}`]: idx + 1 }))}
                            aria-label={`${sym} 換一種指法（第 ${idx + 1}／${v.choices.length} 種）`}
                          >
                            換 {idx + 1}/{v.choices.length}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="row">
                  <button type="button" className="btn btn-sm" onClick={() => play(ri)}>▶ 試聽這行</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={stopAll}>■ 停止</button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {rows.length > 0 && (
        <>
          {unknownCount > 0 && <p className="help err">有 {unknownCount} 個和弦看不懂，匯入時會跳過。</p>}
          <div className="row wrap">
            <button type="button" className="btn btn-primary" disabled={!chosen.length} onClick={() => addHere('append')}>
              ＋ 加進{sectionName}
            </button>
            {hasChords && (
              <button type="button" className="btn" disabled={!chosen.length} onClick={() => addHere('replace')}>
                取代{sectionName}的和弦
              </button>
            )}
            <button type="button" className="btn" disabled={!chosen.length} onClick={addSections}>
              每行建成新段落（{chosen.length}）
            </button>
          </div>
        </>
      )}
      {done && <p className="notice" role="status">{done}</p>}
    </details>
  );
}
