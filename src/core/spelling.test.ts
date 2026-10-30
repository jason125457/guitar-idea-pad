import { describe, expect, it } from 'vitest';
import {
  analyzeVoicing,
  chordSymbol,
  chordToneSpeller,
  midiName,
  parseFretInput,
  parseNoteName,
  spellerForKey,
  type Fret,
} from './index';

const frets = (s: string) => (parseFretInput(s) as { ok: true; frets: Fret[] }).frets;
const best = (s: string) => analyzeVoicing(frets(s)).best!;

describe('slash chord bass is spelled from the chord root', () => {
  it('A/C# and E/G# with no key, and in C major / A minor', () => {
    const c = spellerForKey(0, 'major');
    const am = spellerForKey(9, 'minor');
    expect(chordSymbol(best('x4222x'))).toBe('A/C#');
    expect(chordSymbol(best('4x2100'))).toBe('E/G#');
    expect(chordSymbol(best('4x2100'), am)).toBe('E/G#');
    expect(chordSymbol(best('4x2100'), c)).toBe('E/G#');
    expect(chordSymbol(best('200232'))).toBe('D/F#');
    expect(chordSymbol(best('x20003'))).toBe('G/B');
  });

  it('lists chord tones by degree (E major chord in C major shows G#, not Ab)', () => {
    const sp = chordToneSpeller(best('022100'), spellerForKey(0, 'major'));
    expect(analyzeVoicing(frets('022100')).notes.map((n) => midiName(n.midi, sp))).toEqual(['E2', 'B2', 'E3', 'G#3', 'B3', 'E4']);
  });
});

describe('key spellers use scale degrees', () => {
  it('A minor: leading tone G#, raised 6th F#, flat 2 Bb', () => {
    const am = spellerForKey(9, 'minor');
    expect(midiName(68, am)).toBe('G#4');
    expect(am(6)).toBe('F#');
    expect(am(10)).toBe('Bb');
  });
  it('C major: #4 is F#, b7 Bb, b3 Eb, b6 Ab, b2 Db', () => {
    const c = spellerForKey(0, 'major');
    expect([6, 10, 3, 8, 1].map(c)).toEqual(['F#', 'Bb', 'Eb', 'Ab', 'Db']);
  });
  it('flat keys use flats, sharp keys use sharps', () => {
    expect(spellerForKey(5, 'major')(10)).toBe('Bb');
    expect(spellerForKey(3, 'major')(8)).toBe('Ab');
    expect(spellerForKey(4, 'major')(3)).toBe('D#');
    expect(spellerForKey(11, 'major')(10)).toBe('A#');
    expect(spellerForKey(2, 'minor')(10)).toBe('Bb');
  });
  it('C# minor writes its leading tone as B#, with the right octave number', () => {
    const cs = spellerForKey(1, 'minor');
    expect(cs(0)).toBe('B#');
    expect(midiName(60, cs)).toBe('B#3');
    expect(parseNoteName('B#3')).toBe(60);
  });
  it('falls back to a plain name instead of a double sharp', () => {
    expect(spellerForKey(8, 'minor')(7)).toBe('G'); // G# 小調的導音是 F𝄪，退回 G
  });
});

describe('parseNoteName', () => {
  it('accepts full-width characters typed with a Chinese IME', () => {
    expect(parseNoteName('Ａ３')).toBe(57);
    expect(parseNoteName('Ｆ＃４')).toBe(66);
  });
  it('round-trips with midiName for edge spellings', () => {
    expect(parseNoteName('Cb4')).toBe(59);
    expect(midiName(59, () => 'Cb')).toBe('Cb4');
  });
});
