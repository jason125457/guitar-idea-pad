import { describe, expect, it } from 'vitest';
import {
  hzToMidiFloat,
  notesToMelodyText,
  segmentNotes,
  snapToScale,
  type PitchFrame,
} from './index';

const HOP = 0.0116;
const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

type Seg = { midi: number; dur: number; vibrato?: number; offsetCents?: number } | { silence: number };

/** 依序產生合成幀。midi 可帶小數；vibrato 是以半音為單位的 6Hz 擺幅。 */
function synth(segs: Seg[], { clarity = 0.97, rms = 0.1 } = {}): PitchFrame[] {
  const out: PitchFrame[] = [];
  let t = 0.05;
  for (const s of segs) {
    const n = Math.round(('silence' in s ? s.silence : s.dur) / HOP);
    for (let i = 0; i < n; i++, t += HOP) {
      if ('silence' in s) {
        out.push({ t, hz: 0, clarity: 0, rms: 0.001 });
      } else {
        const vib = s.vibrato ? s.vibrato * Math.sin(2 * Math.PI * 6 * (i * HOP)) : 0;
        const m = s.midi + vib + (s.offsetCents ?? 0) / 100;
        out.push({ t, hz: midiToHz(m), clarity, rms });
      }
    }
  }
  return out;
}

describe('segmentNotes', () => {
  it('finds three steady notes with timing', () => {
    const notes = segmentNotes(synth([{ midi: 57, dur: 0.5 }, { midi: 59, dur: 0.5 }, { midi: 62, dur: 0.5 }]));
    expect(notes.map((n) => n.midi)).toEqual([57, 59, 62]);
    expect(notes[0]!.startSec).toBeCloseTo(0.05, 1);
    expect(notes[0]!.durSec).toBeGreaterThan(0.45);
    expect(notes[1]!.startSec).toBeGreaterThan(notes[0]!.startSec + notes[0]!.durSec - 0.05);
    expect(notes.every((n) => Math.abs(n.cents) <= 2)).toBe(true);
  });

  it('keeps vibrato as one note at its center pitch', () => {
    const notes = segmentNotes(synth([{ midi: 60, dur: 1.2, vibrato: 0.4 }]));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.midi).toBe(60);
    expect(Math.abs(notes[0]!.cents)).toBeLessThanOrEqual(8);
  });

  it('reports how flat or sharp the singer is, without changing the note', () => {
    const [n] = segmentNotes(synth([{ midi: 64, dur: 0.6, offsetCents: 30 }]));
    expect(n!.midi).toBe(64);
    expect(n!.cents).toBeGreaterThanOrEqual(28);
    expect(n!.cents).toBeLessThanOrEqual(32);
  });

  it('ignores a single-frame octave glitch inside a note', () => {
    const frames = synth([{ midi: 60, dur: 0.6 }]);
    frames[20] = { ...(frames[20] as PitchFrame), hz: (frames[20] as PitchFrame).hz * 2 };
    frames[35] = { ...(frames[35] as PitchFrame), hz: (frames[35] as PitchFrame).hz / 2 };
    const notes = segmentNotes(frames);
    expect(notes.map((n) => n.midi)).toEqual([60]);
  });

  it('bridges a short dropout but splits on a long silence', () => {
    const shortGap = segmentNotes(synth([{ midi: 62, dur: 0.4 }, { silence: 0.05 }, { midi: 62, dur: 0.4 }]));
    expect(shortGap).toHaveLength(1);
    const longGap = segmentNotes(synth([{ midi: 62, dur: 0.4 }, { silence: 0.4 }, { midi: 62, dur: 0.4 }]));
    expect(longGap.map((n) => n.midi)).toEqual([62, 62]);
  });

  it('drops low-clarity frames, quiet frames and out-of-range pitches', () => {
    expect(segmentNotes(synth([{ midi: 60, dur: 0.5 }], { clarity: 0.5 }))).toEqual([]);
    expect(segmentNotes(synth([{ midi: 60, dur: 0.5 }], { rms: 0.002 }))).toEqual([]);
    expect(segmentNotes(synth([{ midi: 100, dur: 0.5 }]))).toEqual([]); // ~2.6 kHz
    expect(segmentNotes(synth([{ midi: 30, dur: 0.5 }]))).toEqual([]); // ~46 Hz
  });

  it('drops blips shorter than the minimum note length', () => {
    const notes = segmentNotes(synth([{ midi: 60, dur: 0.5 }, { silence: 0.3 }, { midi: 65, dur: 0.05 }, { silence: 0.3 }, { midi: 67, dur: 0.5 }]));
    expect(notes.map((n) => n.midi)).toEqual([60, 67]);
  });

  it('follows a quick stepwise run', () => {
    const notes = segmentNotes(synth([60, 62, 64, 65, 67].map((midi) => ({ midi, dur: 0.18 }))));
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64, 65, 67]);
  });

  it('resolves a slow glide into the notes it passes through, ending on the target', () => {
    const frames: PitchFrame[] = [];
    let t = 0.05;
    for (let i = 0; i < 40; i++, t += HOP) frames.push({ t, hz: midiToHz(60), clarity: 0.97, rms: 0.1 });
    for (let i = 0; i < 20; i++, t += HOP) frames.push({ t, hz: midiToHz(60 + (2 * (i + 1)) / 20), clarity: 0.95, rms: 0.1 });
    for (let i = 0; i < 40; i++, t += HOP) frames.push({ t, hz: midiToHz(62), clarity: 0.97, rms: 0.1 });
    const notes = segmentNotes(frames);
    expect(notes[0]!.midi).toBe(60);
    expect(notes[notes.length - 1]!.midi).toBe(62);
    expect(notes.length).toBeLessThanOrEqual(3);
  });

  it('returns nothing for empty input', () => {
    expect(segmentNotes([])).toEqual([]);
  });

  it('can snap to the key, and leaves chromatic notes alone otherwise', () => {
    const cMajor = [0, 2, 4, 5, 7, 9, 11];
    const frames = synth([{ midi: 61.15, dur: 0.5 }]); // 比 C# 高一點，離 D 較近
    expect(segmentNotes(frames)[0]!.midi).toBe(61);
    expect(segmentNotes(frames, { scalePcs: cMajor })[0]!.midi).toBe(62);
  });
});

describe('helpers', () => {
  it('hzToMidiFloat is exact at A4 and octaves', () => {
    expect(hzToMidiFloat(440)).toBeCloseTo(69, 6);
    expect(hzToMidiFloat(220)).toBeCloseTo(57, 6);
  });
  it('snapToScale picks the nearest in-scale neighbour within a semitone', () => {
    const cMajor = [0, 2, 4, 5, 7, 9, 11];
    expect(snapToScale(61.4, cMajor)).toBe(62);
    expect(snapToScale(60.9, cMajor)).toBe(60); // 離 C(60) 0.9、離 D(62) 1.1
    expect(snapToScale(60.1, cMajor)).toBe(60);
    expect(snapToScale(61, [0, 1])).toBe(61); // C# 本身在調內
  });
  it('formats notes as melody text with key spelling', () => {
    expect(notesToMelodyText([{ midi: 57 }, { midi: 58 }, { midi: 66 }])).toBe('A3 Bb3 F#4');
  });
});
