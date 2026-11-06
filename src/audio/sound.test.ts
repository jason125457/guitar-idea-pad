import { describe, expect, it } from 'vitest';
import { SAMPLE_NOTES, SAMPLE_TIMBRES, TIMBRES, sampleOf, sampleUrl, strumVelocity } from './sound';
import { formatBytes } from './offline';
import { strumBeats } from './pluck';

describe('sampleUrl', () => {
  it('points at same-origin files under the given base so the service worker can cache them', () => {
    expect(sampleUrl('steel', '/')).toBe('/samples/FluidR3_GM/acoustic_guitar_steel-mp3.js');
    expect(sampleUrl('nylon', '/app/')).toBe('/app/samples/FluidR3_GM/acoustic_guitar_nylon-mp3.js');
    for (const t of SAMPLE_TIMBRES) expect(sampleUrl(t, '/')).not.toMatch(/^https?:/);
  });
});

describe('SAMPLE_NOTES', () => {
  it('covers the whole guitar range so every note is at most one semitone from a sample', () => {
    expect(SAMPLE_NOTES[0]).toBe(40);
    expect(SAMPLE_NOTES[SAMPLE_NOTES.length - 1]).toBe(88);
    for (let m = 40; m <= 88; m++) {
      const nearest = Math.min(...SAMPLE_NOTES.map((s) => Math.abs(s - m)));
      expect(nearest).toBeLessThanOrEqual(1);
    }
  });
  it('decodes far fewer buffers than the 88 in the file', () => {
    expect(SAMPLE_NOTES.length).toBeLessThanOrEqual(20);
  });
});

describe('timbre list', () => {
  it('offers the sampled guitars plus the synth fallback', () => {
    expect(TIMBRES.map((t) => t.id)).toEqual(['steel', 'nylon', 'electric', 'synth']);
    expect(SAMPLE_TIMBRES).toEqual(['steel', 'nylon', 'electric']);
  });
  it('maps each timbre to its sample file', () => {
    expect(sampleOf('electric')).toBe('electric');
    expect(sampleOf('synth')).toBeUndefined();
    expect(sampleUrl('electric', '/')).toBe('/samples/FluidR3_GM/electric_guitar_clean-mp3.js');
  });
});

describe('strumBeats', () => {
  it('strums every chord once per beat, accenting the first beat', () => {
    const t = strumBeats([{ midis: [48, 52, 55], beats: 4 }, { midis: [53, 57, 60], beats: 4 }], 0.5);
    expect(t).toHaveLength(8);
    expect(t.map((x) => x.startSec)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(t[4]!.midis).toEqual([53, 57, 60]);
    expect(t.every((x) => x.durSec === 0.5)).toBe(true);
    expect(t[0]!.level).toBeGreaterThan(t[1]!.level!);
  });
  it('follows each chord’s own beat count', () => {
    const t = strumBeats([{ midis: [48], beats: 2 }, { midis: [53], beats: 3 }], 1);
    expect(t.map((x) => [x.midis[0], x.startSec])).toEqual([[48, 0], [48, 1], [53, 2], [53, 3], [53, 4]]);
  });
});

describe('strumVelocity', () => {
  it('gets softer toward the high strings and scales with level', () => {
    const v = [0, 1, 2, 3, 4, 5].map((i) => strumVelocity(i));
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeLessThan(v[i - 1]!);
    expect(strumVelocity(0, 0.5)).toBeLessThan(strumVelocity(0, 1));
  });
  it('stays inside the MIDI range', () => {
    expect(strumVelocity(0, 5)).toBe(127);
    expect(strumVelocity(5, 0)).toBe(1);
  });
});

describe('formatBytes', () => {
  it('uses B, KB and MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1_984_000)).toBe('1.9 MB');
  });
});
