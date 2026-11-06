import { useMemo, useState } from 'react';
import {
  analyzeSection,
  bpmOf,
  chordSymbol,
  formatFrets,
  layoutBars,
  linkedSections,
  spellerForKey,
  suggestFingering,
  type Fret,
  type Idea,
} from '../core';
import { ChordDiagram } from './ChordDiagram';

const modeName = (m: 'major' | 'minor') => (m === 'major' ? '大調' : '小調');
/** 每行幾小節 */
const BARS_PER_LINE = 4;

interface Props {
  idea: Idea;
  names: Record<string, string>;
  /** 點譜上的和弦：回到編曲頁並選取它 */
  onEdit: (sectionId: string, itemId: string) => void;
}

interface UsedShape {
  key: string;
  name: string;
  /** 同名和弦有好幾種按法時的編號（從 1 起）；只有一種時是 0 */
  variant: number;
  frets: Fret[];
}

/**
 * 歌曲譜：最上面是這首歌實際用到的指法（就是你選的那些按法），
 * 下面照段落排成小節格，可以列印或存成 PDF。
 */
export function SongSheet({ idea, names, onEdit }: Props) {
  const [collapseLinked, setCollapseLinked] = useState(true);

  const data = useMemo(() => {
    const shapes = new Map<string, UsedShape>();
    const byName = new Map<string, number>();
    const sections = idea.sections.map((s) => {
      const a = analyzeSection({ ...s, melody: '' });
      const speller = a.key ? spellerForKey(a.key.tonic, a.key.mode) : undefined;
      const labels = s.progression.map((it, i) => {
        const best = a.analyzed[i]?.best;
        const name = best ? chordSymbol(best, speller) : formatFrets(it.frets);
        const key = `${name}|${formatFrets(it.frets)}`;
        if (!shapes.has(key)) {
          const n = (byName.get(name) ?? 0) + 1;
          byName.set(name, n);
          shapes.set(key, { key, name, variant: n, frets: it.frets });
        }
        return key;
      });
      return { section: s, key: a.key, labels };
    });
    // 只有一種按法的和弦不用編號
    for (const sh of shapes.values()) if ((byName.get(sh.name) ?? 0) === 1) sh.variant = 0;
    return { shapes, sections };
  }, [idea.sections]);

  // 整首歌的調：使用者鎖定過的優先，否則用和弦最多的那段推出來的
  const songKey =
    idea.sections.find((x) => x.keyLock)?.keyLock ??
    [...data.sections].sort((x, y) => y.section.progression.length - x.section.progression.length).find((x) => x.key)?.key;
  const firstBpm = idea.sections[0] ? bpmOf(idea.sections[0]) : undefined;
  const label = (key: string) => {
    const sh = data.shapes.get(key);
    return sh ? (
      <>
        {sh.name}
        {sh.variant > 0 && <sup className="sheet-var">{sh.variant}</sup>}
      </>
    ) : null;
  };
  const shown = new Set<string>();

  return (
    <article className="sheet" aria-labelledby="sheet-title">
      <div className="sheet-tools no-print">
        <label className="check sheet-opt">
          <input type="checkbox" checked={collapseLinked} onChange={(e) => setCollapseLinked(e.target.checked)} />
          連動的段落寫成「同 ○○」，不重複寫出和弦
        </label>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          列印／存成 PDF
        </button>
      </div>

      <header className="sheet-head">
        <h2 id="sheet-title" className="sheet-title">{idea.title}</h2>
        <p className="sheet-meta">
          {songKey && `${spellerForKey(songKey.tonic, songKey.mode)(songKey.tonic)} ${modeName(songKey.mode)} · `}
          {firstBpm} BPM · 4/4
        </p>
      </header>

      {data.shapes.size > 0 ? (
        <section className="sheet-shapes" aria-label="這首歌用到的指法">
          {[...data.shapes.values()].map((sh) => (
            <figure key={sh.key} className="sheet-shape">
              <figcaption>{label(sh.key)}</figcaption>
              <ChordDiagram frets={sh.frets} fingers={suggestFingering(sh.frets)} width={68} name={sh.name} />
              <span className="sheet-frets mono">{formatFrets(sh.frets)}</span>
            </figure>
          ))}
        </section>
      ) : (
        <p className="help">這首歌還沒有和弦。回到「編曲」加上和弦，這裡就會排出譜。</p>
      )}

      {data.sections.map(({ section: s, key, labels }) => {
        const name = names[s.id] ?? '';
        const firstLinked = s.link ? linkedSections(idea, s.id)[0] : undefined;
        const repeatOf = collapseLinked && firstLinked && firstLinked.id !== s.id && shown.has(firstLinked.id) ? firstLinked : undefined;
        shown.add(s.id);
        const bars = layoutBars(s.progression);
        // 只有使用者鎖定、而且跟整首歌不同的調才標出來；兩三個和弦的段落自動猜的調不可靠
        const keyNote = s.keyLock && key && songKey && (key.tonic !== songKey.tonic || key.mode !== songKey.mode)
          ? ` · ${spellerForKey(key.tonic, key.mode)(key.tonic)} ${modeName(key.mode)}`
          : '';
        const bpmNote = firstBpm !== undefined && bpmOf(s) !== firstBpm ? ` · ${bpmOf(s)} BPM` : '';
        return (
          <section key={s.id} className={`sheet-sec sec-${s.label}`}>
            <h3 className="sheet-sec-title">
              {name}
              <span className="sheet-sec-meta">{bars.length} 小節{keyNote}{bpmNote}</span>
            </h3>
            {repeatOf ? (
              <p className="sheet-repeat">同{names[repeatOf.id]}</p>
            ) : bars.length === 0 ? (
              <p className="sheet-repeat">（還沒有和弦）</p>
            ) : (
              <div className="sheet-lines">
                {Array.from({ length: Math.ceil(bars.length / BARS_PER_LINE) }, (_, li) => (
                  <div key={li} className="sheet-line">
                    {bars.slice(li * BARS_PER_LINE, (li + 1) * BARS_PER_LINE).map((cells, bi) => (
                      <div key={bi} className="sheet-bar">
                        {cells.map((c) => (
                          <button
                            key={`${c.itemId}-${c.start}`}
                            type="button"
                            className={`sheet-chord ${c.continued ? 'is-cont' : ''}`}
                            style={{ flexGrow: c.beats }}
                            onClick={() => onEdit(s.id, c.itemId)}
                            aria-label={c.continued ? '（延續上一小節的和弦）' : undefined}
                            title="回到編曲頁調整這個和弦"
                          >
                            {c.continued ? '—' : label(labels[c.index] as string)}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </article>
  );
}
