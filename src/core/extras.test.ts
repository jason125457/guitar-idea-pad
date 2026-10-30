import { describe, expect, it } from 'vitest';
import { analyzeVoicing, chordSymbol, generateVoicings, parseFretInput, quality, suggestNext, type Fret } from './index';

describe('shell and skip-string voicings', () => {
  it('can offer three-string shells for seventh chords, and they still name correctly', () => {
    const all = generateVoicings(9, quality('m7'), { limit: 400 });
    const shells = all.filter((v) => v.frets.filter((f) => f !== null).length === 3);
    expect(shells.length).toBeGreaterThan(0);
    for (const v of shells) expect(chordSymbol(analyzeVoicing(v.frets).best!).startsWith('Am7')).toBe(true);
  });
  it('never offers three-string triads or more than one muted inner string', () => {
    for (const v of generateVoicings(0, quality('maj'), { limit: 400 })) {
      const idx = v.frets.map((f, i) => (f === null ? -1 : i)).filter((i) => i >= 0);
      expect(idx.length).toBeGreaterThanOrEqual(4);
      expect(idx[idx.length - 1]! - idx[0]! + 1 - idx.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('Neo-Soul shift', () => {
  it('does not "slide" an open-string shape (it would become a different fingering)', () => {
    const c = analyzeVoicing([null, 3, 2, 0, 1, 0]);
    const s = suggestNext([c], { tonic: 0, mode: 'major' }).find((x) => x.mood === 'neo-soul');
    expect(s?.title).not.toBe('Neo-Soul 半音平移');
  });
  it('still slides a closed (movable) shape', () => {
    const fm7: Fret[] = [8, 8, 10, 8, 9, 8];
    const s = suggestNext([analyzeVoicing(fm7)], { tonic: 0, mode: 'major' }).find((x) => x.mood === 'neo-soul');
    expect(s?.title).toBe('Neo-Soul 半音平移');
  });
});

describe('full-width fret input', () => {
  it('accepts full-width digits, x and spaces', () => {
    expect(parseFretInput('８　８　１０　９　１０　８')).toEqual({ ok: true, frets: [8, 8, 10, 9, 10, 8] });
    expect(parseFretInput('ｘ３２０１０')).toEqual({ ok: true, frets: [null, 3, 2, 0, 1, 0] });
  });
});
