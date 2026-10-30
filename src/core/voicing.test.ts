import { describe, expect, it } from 'vitest';
import { generateVoicings, quality, suggestNext, analyzeVoicing, type Fret } from './index';

describe('generateVoicings cache', () => {
  it('returns equal results on repeated calls, as independent copies', () => {
    const prev: Fret[] = [8, 8, 10, 9, 10, 8];
    const a = generateVoicings(0, quality('maj7'), { prev, limit: 3 });
    const b = generateVoicings(0, quality('maj7'), { prev, limit: 3 });
    expect(b).toEqual(a);
    a[0]!.frets[0] = 99;
    expect(generateVoicings(0, quality('maj7'), { prev, limit: 3 })[0]!.frets[0]).not.toBe(99);
  });

  it('distinguishes options (bass, prev, limit) in the cache key', () => {
    const noBass = generateVoicings(0, quality('maj'), { limit: 5 });
    const eBass = generateVoicings(0, quality('maj'), { bassPc: 4, limit: 5 });
    expect(eBass.every((v) => analyzeVoicing(v.frets).bassPc === 4)).toBe(true);
    expect(eBass).not.toEqual(noBass);
    expect(generateVoicings(0, quality('maj'), { limit: 1 })).toHaveLength(1);
  });

  it('makes repeated suggestion requests much cheaper', () => {
    const chords = [[8, 8, 10, 9, 10, 8], [7, 7, 9, 7, 8, 7]].map((f) => analyzeVoicing(f as Fret[]));
    const key = { tonic: 0, mode: 'major' as const };
    const t0 = performance.now();
    suggestNext(chords, key, 64);
    const first = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 10; i++) suggestNext(chords, key, 64);
    const repeat = (performance.now() - t1) / 10;
    expect(repeat).toBeLessThan(Math.max(2, first / 3));
  });
});
