import { useState, type ReactNode, type RefObject } from 'react';
import {
  chordSymbol,
  diatonicChords,
  parseChordSymbol,
  romanNumeral,
  spellerForKey,
  type ChordRef,
  type KeyGuess,
  type KeyLock,
  type Mode,
  type Speller,
  type Suggestion,
  type VoicingStyle,
} from '../core';

const MOOD_LABEL: Record<Suggestion['mood'], string> = {
  'warm-resolve': '溫暖落地',
  bittersweet: '微酸收尾',
  'neo-soul': 'Neo-Soul',
};
const STYLES: { id: VoicingStyle; name: string }[] = [
  { id: 'electric', name: '電吉他高把位' },
  { id: 'open', name: '一般指法' },
];
const TONICS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const modeName = (m: Mode) => (m === 'major' ? '大調' : '小調');

interface Props {
  /** 目前用來排和弦盤的調（偵測到的或使用者鎖定的）；還沒有和弦時是 undefined */
  keyInfo: Pick<KeyGuess, 'tonic' | 'mode'> | undefined;
  /** 偵測到的前幾名調性，給使用者快速切換 */
  keyGuesses: KeyGuess[];
  keyLock: KeyLock | null;
  onLockKey: (k: KeyLock | null) => void;
  speller: Speller;
  style: VoicingStyle;
  onStyle: (s: VoicingStyle) => void;
  suggestions: Suggestion[];
  /** 插入位置的說明，例如「加在 Am7 後面」 */
  insertHint: string;
  onAddChord: (ch: ChordRef) => void;
  onPlaySuggestion: (s: Suggestion) => void;
  onAddSuggestion: (s: Suggestion) => void;
  onDraft: () => void;
  searchRef: RefObject<HTMLInputElement>;
  children?: ReactNode;
}

/**
 * 和弦盤（參考 Hookpad）：這個調常用的和弦、下一步建議、直接打和弦名稱，點了就加進時間軸。
 */
export function ChordPalette(p: Props) {
  const [sevenths, setSevenths] = useState(false);
  const [query, setQuery] = useState('');
  const key = p.keyInfo ?? { tonic: 0, mode: 'major' as Mode };
  const keySpeller = p.keyInfo ? p.speller : spellerForKey(0, 'major');
  const parsed = query.trim() ? parseChordSymbol(query.trim()) : undefined;

  const submit = () => {
    if (!parsed) return;
    p.onAddChord(parsed);
    setQuery('');
  };

  return (
    <section className="panel palette" aria-labelledby="h-palette">
      <div className="pal-head">
        <h2 id="h-palette">加和弦</h2>
        <span className="help pal-where">{p.insertHint}</span>
      </div>

      <div className="pal-group">
        <div className="pal-row">
          <h3 className="pal-title">
            <span className="key-name">{keySpeller(key.tonic)} {modeName(key.mode)}</span>的常用和弦
          </h3>
          <div className="seg" role="group" aria-label="三和弦或七和弦">
            <button type="button" className={`seg-btn ${!sevenths ? 'is-on' : ''}`} aria-pressed={!sevenths} onClick={() => setSevenths(false)}>
              三和弦
            </button>
            <button type="button" className={`seg-btn ${sevenths ? 'is-on' : ''}`} aria-pressed={sevenths} onClick={() => setSevenths(true)}>
              七和弦
            </button>
          </div>
        </div>
        <ul className="pal-chords">
          {diatonicChords(key, sevenths).map((c) => {
            const name = chordSymbol(c, keySpeller);
            return (
              <li key={`${c.rootPc}-${c.qualityId}`}>
                <button type="button" className="pal-chord" onClick={() => p.onAddChord(c)} aria-label={`加入 ${name}`}>
                  <span className="pal-name">{name}</span>
                  <span className="chip-roman">{romanNumeral(c, key.tonic, key.mode)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="pal-keys" role="group" aria-label="選擇調性">
          {p.keyGuesses.slice(0, 3).map((k) => {
            const active = k.tonic === key.tonic && k.mode === key.mode;
            return (
              <button
                key={`${k.tonic}-${k.mode}`}
                type="button"
                className={`btn btn-sm ${active ? 'is-active' : ''}`}
                aria-pressed={active}
                onClick={() => p.onLockKey({ tonic: k.tonic, mode: k.mode })}
              >
                {spellerForKey(k.tonic, k.mode)(k.tonic)} {modeName(k.mode)}
              </button>
            );
          })}
          <label className="pal-keypick">
            <span className="sr-only">指定調性</span>
            <select
              className="input input-sm"
              value={p.keyLock ? `${p.keyLock.tonic}-${p.keyLock.mode}` : ''}
              onChange={(e) => {
                const [t, m] = e.target.value.split('-');
                p.onLockKey(e.target.value ? { tonic: Number(t), mode: m as Mode } : null);
              }}
            >
              <option value="">{p.keyLock ? '改回自動判斷' : '自動判斷調性'}</option>
              {(['major', 'minor'] as Mode[]).flatMap((m) =>
                TONICS.map((n, t) => (
                  <option key={`${t}-${m}`} value={`${t}-${m}`}>{n} {modeName(m)}</option>
                )),
              )}
            </select>
          </label>
        </div>
      </div>

      {p.suggestions.length > 0 && (
        <div className="pal-group">
          <h3 className="pal-title">下一步建議</h3>
          <ul className="pal-sugs">
            {p.suggestions.map((s) => (
              <li key={s.mood} className={`pal-sug mood-${s.mood}`}>
                <div className="pal-sug-head">
                  <span className="pal-name">{s.symbol}</span>
                  <span className="chip-roman">{s.roman}</span>
                  <span className="mood">{MOOD_LABEL[s.mood]}</span>
                </div>
                <p className="pal-reason">{s.reason}</p>
                <div className="row">
                  <button type="button" className="btn btn-sm" onClick={() => p.onPlaySuggestion(s)}>▶ 接著聽</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => p.onAddSuggestion(s)}>＋ 加入</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pal-group">
        <label className="pal-title field" htmlFor="chord-search">直接輸入和弦名稱</label>
        <form
          className="pal-search"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            id="chord-search"
            ref={p.searchRef}
            className={`input mono ${query.trim() && !parsed ? 'bad' : ''}`}
            placeholder="例如 Fmaj7#11、G/B、Am7"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-describedby="chord-search-help"
          />
          <button type="submit" className="btn btn-primary" disabled={!parsed}>
            ＋ {parsed ? chordSymbol(parsed) : '加入'}
          </button>
        </form>
        <p id="chord-search-help" className={query.trim() && !parsed ? 'help err' : 'help'}>
          {query.trim() && !parsed ? '看不懂這個和弦名稱，試試 Cmaj7、F#m7b5、Bb/D 這種寫法' : '按 Enter 加入，會自動挑一個好按的指法'}
        </p>
      </div>

      <div className="pal-group pal-foot">
        <fieldset className="seg" aria-label="指法風格">
          {STYLES.map((s) => (
            <label key={s.id} className={`seg-btn ${p.style === s.id ? 'is-on' : ''}`}>
              <input className="sr-only" type="radio" name="voicing-style" value={s.id} checked={p.style === s.id} onChange={() => p.onStyle(s.id)} />
              {s.name}
            </label>
          ))}
        </fieldset>
        <button type="button" className="btn btn-sm btn-ghost" onClick={p.onDraft}>
          在指板上自己按
        </button>
      </div>

      {p.children}
    </section>
  );
}
