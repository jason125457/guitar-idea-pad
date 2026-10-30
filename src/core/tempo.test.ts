import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BPM,
  beatsOf,
  bpmOf,
  createIdea,
  duplicateIdea,
  normalizeIdea,
  parseBackup,
  progressionTimeline,
  serializeBackup,
  createBackup,
  toProgressionItems,
  updateSection,
  type Fret,
} from './index';

const C: Fret[] = [null, 3, 2, 0, 1, 0];
const G: Fret[] = [3, 2, 0, 0, 0, 3];

describe('tempo and chord lengths', () => {
  it('defaults to 90 BPM and 4 beats per chord', () => {
    expect(bpmOf({})).toBe(DEFAULT_BPM);
    expect(beatsOf({})).toBe(4);
  });

  it('computes when each chord starts and how long it rings', () => {
    expect(progressionTimeline([{ beats: 4 }, { beats: 2 }, {}], 120)).toEqual([
      { startSec: 0, durSec: 2 },
      { startSec: 2, durSec: 1 },
      { startSec: 3, durSec: 2 },
    ]);
  });

  it('keeps valid beats and BPM through save/load and drops invalid values', () => {
    let idea = createIdea();
    const id = idea.sections[0]!.id;
    idea = updateSection(idea, id, { bpm: 72, progression: [{ id: 'a', frets: C, beats: 2 }, { id: 'b', frets: G }] });
    const back = normalizeIdea(JSON.parse(JSON.stringify(idea)))!;
    expect(back.sections[0]!.bpm).toBe(72);
    expect(back.sections[0]!.progression.map((p) => p.beats)).toEqual([2, undefined]);

    const broken = JSON.parse(JSON.stringify(idea));
    broken.sections[0].bpm = 9999;
    broken.sections[0].progression[0].beats = -3;
    const fixed = normalizeIdea(broken)!;
    expect(fixed.sections[0]!.bpm).toBeUndefined();
    expect(fixed.sections[0]!.progression[0]!.beats).toBeUndefined();
  });

  it('survives duplication and backup round trips', () => {
    let idea = createIdea();
    idea = updateSection(idea, idea.sections[0]!.id, { bpm: 100, progression: [{ id: 'a', frets: C, beats: 8 }] });
    expect(duplicateIdea(idea).sections[0]!.progression[0]!.beats).toBe(8);
    const r = parseBackup(serializeBackup(createBackup([idea])));
    expect(r.ok && r.ideas[0]!.sections[0]!.progression[0]!.beats).toBe(8);
    expect(r.ok && r.ideas[0]!.sections[0]!.bpm).toBe(100);
  });
});

describe('toProgressionItems', () => {
  it('merges neighbouring windows with the same voicing and adds up their beats', () => {
    expect(toProgressionItems([C, C, G, C], 4)).toEqual([
      { frets: C, beats: 8 },
      { frets: G, beats: 4 },
      { frets: C, beats: 4 },
    ]);
    expect(toProgressionItems([], 4)).toEqual([]);
  });
});
