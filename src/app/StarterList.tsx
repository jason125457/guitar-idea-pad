import { STARTERS, STARTER_TONICS, chordSymbol, spellerForKey, starterChords, type ChordRef, type Starter } from '../core';

interface Props {
  /** 用哪個大調（主音的音級 0–11） */
  tonic: number;
  onTonic: (tonic: number) => void;
  onHear: (chords: ChordRef[]) => void;
  onUse: (chords: ChordRef[], starter: Starter, tonic: number) => void;
  /** 「用這組」按鈕上的字（空白段落是套用，已有和弦時是接在後面） */
  useLabel: string;
  /** compact：放在右邊的和弦盤裡，窄一點 */
  compact?: boolean;
}

/**
 * 起手式：幾組常見的和弦進行，先聽、喜歡就整組放進段落，之後再一個一個改。
 * 給還不知道要用哪些和弦的人一個起點。
 */
export function StarterList({ tonic, onTonic, onHear, onUse, useLabel, compact = false }: Props) {
  const speller = spellerForKey(tonic, 'major');
  return (
    <div className={`starters ${compact ? 'is-compact' : ''}`}>
      <div className="starters-head">
        <h3 className="pal-title">不知道從哪開始？先套一組常見的進行</h3>
        <div className="starters-key">
          <span className="starters-key-label" id="starter-key-label">調</span>
          <div className="seg seg-sm" role="group" aria-labelledby="starter-key-label">
            {STARTER_TONICS.map((t) => (
              <button
                key={t}
                type="button"
                className={`seg-btn ${t === tonic ? 'is-on' : ''}`}
                aria-pressed={t === tonic}
                aria-label={`${spellerForKey(t, 'major')(t)} 大調`}
                onClick={() => onTonic(t)}
              >
                {spellerForKey(t, 'major')(t)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="help starters-help">唱起來太高或太低，換一個調再聽；和弦的感覺不會變。</p>
      <ul className="starter-list">
        {STARTERS.map((s) => {
          const chords = starterChords(s, tonic);
          const text = chords.map((c) => chordSymbol(c, speller)).join(' – ');
          return (
            <li key={s.id} className="starter">
              <div className="starter-text">
                <span className="starter-name">{s.name}</span>
                <span className="starter-chords mono">{text}</span>
                <span className="starter-feel">{s.feel}</span>
              </div>
              <div className="starter-actions">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => onHear(chords)} aria-label={`試聽${s.name}：${text}`}>
                  ▶ 試聽
                </button>
                <button type="button" className="btn btn-sm" onClick={() => onUse(chords, s, tonic)} aria-label={`${useLabel}${s.name}：${text}`}>
                  {useLabel}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
