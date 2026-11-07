import { describe, expect, it } from 'vitest';
import { patternEvents } from './rhythm';

const C = [48, 52, 55, 60, 64];
const at = (ev: { startSec: number }[]) => ev.map((e) => e.startSec);

describe('patternEvents', () => {
  it('keeps one strum per beat for the default pattern', () => {
    expect(at(patternEvents(C, 4, 0.5, 'beat'))).toEqual([0, 0.5, 1, 1.5]);
  });

  it('strums once per bar and lets it ring for the whole-bar pattern', () => {
    const ev = patternEvents(C, 8, 0.5, 'whole');
    expect(at(ev)).toEqual([0, 2]);
    expect(ev.map((e) => e.durSec)).toEqual([2, 2]);
    // 從小節中間開始的和弦：先響到小節線，再刷下一小節
    expect(patternEvents(C, 4, 0.5, 'whole', 2).map((e) => [e.startSec, e.durSec])).toEqual([[0, 1], [1, 1]]);
  });

  it('plays the folk pattern D DU UDU on the right eighths, with up-strokes lighter and on the top strings', () => {
    const ev = patternEvents(C, 4, 1, 'folk');
    expect(ev.map((e) => `${e.startSec}${e.dir === 'up' ? 'U' : 'D'}`)).toEqual(['0D', '1D', '1.5U', '2.5U', '3D', '3.5U']);
    const up = ev.find((e) => e.dir === 'up')!;
    expect(up.level).toBeLessThan(ev[0]!.level!);
    expect(up.midis).toEqual([52, 55, 60, 64]);
  });

  it('varies every second bar of the folk pattern: D DU DDU, then back to D DU UDU', () => {
    const ev = patternEvents(C, 12, 1, 'folk');
    const bar = (n: number) => ev.filter((e) => e.startSec >= n * 4 && e.startSec < n * 4 + 4).map((e) => `${e.startSec - n * 4}${e.dir === 'up' ? 'U' : 'D'}`);
    expect(bar(0)).toEqual(['0D', '1D', '1.5U', '2.5U', '3D', '3.5U']);
    expect(bar(1)).toEqual(['0D', '1D', '1.5U', '2.5D', '3D', '3.5U']);
    expect(bar(2)).toEqual(bar(0));
    // 從第二小節中間才開始的和弦也要接上同一個循環
    expect(patternEvents(C, 4, 1, 'folk', 4).map((e) => `${e.startSec}${e.dir === 'up' ? 'U' : 'D'}`)).toEqual(bar(1));
  });

  it('palm-mutes every eighth on the low strings with a short ring', () => {
    const ev = patternEvents(C, 2, 1, 'palm');
    expect(at(ev)).toEqual([0, 0.5, 1, 1.5]);
    expect(ev.every((e) => e.midis.length === 3 && (e.ring ?? 1) < 0.1)).toBe(true);
  });

  it('arpeggiates: bass first, then up and down the top strings, one note at a time', () => {
    const ev = patternEvents(C, 4, 1, 'arpeggio');
    expect(ev.map((e) => e.midis[0])).toEqual([48, 52, 55, 60, 64, 60, 55, 52]);
    expect(ev.every((e) => e.midis.length === 1)).toBe(true);
  });
});
