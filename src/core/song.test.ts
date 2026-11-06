import { describe, expect, it } from 'vitest';
import {
  addSection,
  analyzeSection,
  contrastCheck,
  contrastReference,
  createIdea,
  duplicateIdea,
  duplicateSection,
  layoutBars,
  patternOf,
  linkedSections,
  moveSectionTo,
  songLength,
  unlinkSection,
  melodyRange,
  migrateLegacyV1,
  moveSection,
  normalizeIdea,
  parseMelodyText,
  removeSection,
  sectionNames,
  updateSection,
  verseGuidance,
  type Fret,
} from './index';

const FMAJ7: Fret[] = [8, 8, 10, 9, 10, 8];
const FM7: Fret[] = [8, 8, 10, 8, 9, 8];
const EM7: Fret[] = [7, 7, 9, 7, 8, 7];
const item = (frets: Fret[], id = frets.join('-')) => ({ id, frets });

describe('idea & section helpers', () => {
  it('starts with one verse section and never mutates its input', () => {
    const idea = createIdea('A', 1000);
    expect(idea.sections.map((s) => s.label)).toEqual(['verse']);
    const { idea: next, section } = addSection(idea, 'chorus');
    expect(idea.sections).toHaveLength(1);
    expect(next.sections.map((s) => s.label)).toEqual(['verse', 'chorus']);
    expect(next.updatedAt).toBeGreaterThanOrEqual(idea.updatedAt);
    expect(section.label).toBe('chorus');
  });

  it('keeps at least one section', () => {
    const idea = createIdea();
    expect(removeSection(idea, idea.sections[0]!.id)).toBe(idea);
    const { idea: two, section } = addSection(idea, 'chorus');
    expect(removeSection(two, section.id).sections).toHaveLength(1);
  });

  it('moves sections within bounds only', () => {
    const { idea } = addSection(createIdea(), 'chorus');
    const [a, b] = idea.sections;
    expect(moveSection(idea, a!.id, -1)).toBe(idea);
    expect(moveSection(idea, a!.id, 1).sections.map((s) => s.id)).toEqual([b!.id, a!.id]);
  });

  it('numbers repeated labels only', () => {
    let idea = createIdea();
    idea = addSection(idea, 'chorus').idea;
    idea = addSection(idea, 'verse').idea;
    const names = sectionNames(idea);
    expect(idea.sections.map((s) => names[s.id])).toEqual(['主歌 1', '副歌', '主歌 2']);
  });

  it('duplicates with fresh ids but equal content', () => {
    let idea = createIdea('x');
    idea = updateSection(idea, idea.sections[0]!.id, { progression: [item(FMAJ7)], melody: 'A3 B3' });
    const copy = duplicateIdea(idea);
    expect(copy.id).not.toBe(idea.id);
    expect(copy.sections[0]!.id).not.toBe(idea.sections[0]!.id);
    expect(copy.sections[0]!.progression[0]!.frets).toEqual(FMAJ7);
    expect(copy.sections[0]!.progression[0]!.frets).not.toBe(idea.sections[0]!.progression[0]!.frets);
    expect(copy.title).toContain('複本');
  });
});

describe('normalizeIdea / migration', () => {
  it('rejects garbage and repairs partial data', () => {
    expect(normalizeIdea(null)).toBeUndefined();
    expect(normalizeIdea({})).toBeUndefined();
    const fixed = normalizeIdea({
      id: 'i1',
      title: '  ',
      sections: [
        { label: 'nope', progression: [{ frets: [1, 2, 3] }, { frets: [0, 0, 0, 0, 0, 99] }, { frets: [null, 3, 2, 0, 1, 0] }], keyLock: { tonic: 14, mode: 'major' } },
        'bad',
      ],
    })!;
    expect(fixed.title).toBe('未命名歌曲');
    expect(fixed.sections).toHaveLength(1);
    expect(fixed.sections[0]!.label).toBe('verse');
    expect(fixed.sections[0]!.progression.map((p) => p.frets)).toEqual([[null, 3, 2, 0, 1, 0]]);
    expect(fixed.sections[0]!.keyLock).toEqual({ tonic: 2, mode: 'major' });
  });

  it('supplies a default section when none survive', () => {
    expect(normalizeIdea({ id: 'i2', sections: [] })!.sections).toHaveLength(1);
  });

  it('migrates the v1 chord list into one verse section', () => {
    const idea = migrateLegacyV1([{ id: 'a', frets: FMAJ7 }, { id: 'b', frets: [1] }], 5)!;
    expect(idea.sections).toHaveLength(1);
    expect(idea.sections[0]!.progression.map((p) => p.id)).toEqual(['a']);
    expect(migrateLegacyV1([])).toBeUndefined();
    expect(migrateLegacyV1('oops')).toBeUndefined();
  });
});

describe('section analysis & contrast', () => {
  it('analyzes a section and honors a key lock', () => {
    let idea = createIdea();
    const id = idea.sections[0]!.id;
    idea = updateSection(idea, id, { progression: [item(FMAJ7), item(FM7), item(EM7)], melody: 'A3 Bb3' });
    const a = analyzeSection(idea.sections[0]!);
    expect(a.chords).toHaveLength(3);
    expect(a.key).toMatchObject({ tonic: 0, mode: 'major' });
    expect(a.melodyMidis).toEqual([57, 58]);
    idea = updateSection(idea, id, { keyLock: { tonic: 9, mode: 'minor' } });
    expect(analyzeSection(idea.sections[0]!).key).toEqual({ tonic: 9, mode: 'minor' });
  });

  it('only verse/prechorus look at a filled chorus', () => {
    let idea = createIdea();
    const verse = idea.sections[0]!;
    const added = addSection(idea, 'chorus');
    idea = added.idea;
    expect(contrastReference(idea, verse)).toBeUndefined(); // 副歌還是空的
    idea = updateSection(idea, added.section.id, { melody: 'A4 C5' });
    expect(contrastReference(idea, verse)?.id).toBe(added.section.id);
    expect(contrastReference(idea, idea.sections.find((s) => s.id === added.section.id)!)).toBeUndefined();
  });

  it('parses melody text and reports bad tokens', () => {
    expect(parseMelodyText('A3, Bb3  F#4 zz 9')).toEqual({ midis: [57, 58, 66], invalid: ['zz', '9'] });
  });

  it('flags a verse that crowds the chorus and passes one that leaves room', () => {
    const chorus = melodyRange(parseMelodyText('A3 B3 D4 E4 G4 A4 C5').midis)!;
    const crowded = melodyRange(parseMelodyText('A3 C4 E4 A4 C5').midis)!;
    const roomy = melodyRange(parseMelodyText('G3 A3 B3 C4 D4').midis)!;
    expect(contrastCheck(chorus, crowded).filter((i) => !i.ok).length).toBeGreaterThan(0);
    expect(contrastCheck(chorus, roomy).every((i) => i.ok)).toBe(true);
  });

  it('gives harmony and rhythm advice even without a chorus melody', () => {
    const g = verseGuidance(undefined, [], { tonic: 0, mode: 'major' });
    expect(g.range).toBeUndefined();
    expect(g.harmony.length).toBeGreaterThan(0);
    expect(g.rhythm.length).toBeGreaterThan(0);
  });
});

describe('linked sections', () => {
  const withChorus = () => {
    let idea = addSection(createIdea(), 'chorus').idea;
    const chorus = idea.sections[1]!;
    idea = updateSection(idea, chorus.id, { progression: [item(FMAJ7)], bpm: 100 });
    return { idea, chorus: idea.sections[1]! };
  };

  it('repeats a section right after it, and edits flow to every linked copy', () => {
    const { idea, chorus } = withChorus();
    const r = duplicateSection(idea, chorus.id, true)!;
    expect(r.idea.sections.map((s) => s.label)).toEqual(['verse', 'chorus', 'chorus']);
    expect(linkedSections(r.idea, chorus.id).map((s) => s.id)).toEqual([chorus.id, r.section.id]);

    const edited = updateSection(r.idea, r.section.id, { progression: [item(FM7), item(EM7)], label: 'outro' });
    const [, a, b] = edited.sections;
    expect(a!.progression.map((p) => p.frets)).toEqual([FM7, EM7]);
    expect(b!.progression.map((p) => p.frets)).toEqual([FM7, EM7]);
    expect(a!.label).toBe('outro');
    expect(edited.sections[0]!.progression).toEqual([]); // 沒連動的不受影響
  });

  it('makes an independent copy when not linked', () => {
    const { idea, chorus } = withChorus();
    const r = duplicateSection(idea, chorus.id, false)!;
    expect(r.section.link).toBeUndefined();
    expect(r.section.progression[0]!.id).not.toBe(chorus.progression[0]!.id);
    const edited = updateSection(r.idea, r.section.id, { progression: [] });
    expect(edited.sections[1]!.progression).toHaveLength(1);
  });

  it('unlinks, and drops a link once only one section is left in it', () => {
    const { idea, chorus } = withChorus();
    let r = duplicateSection(idea, chorus.id, true)!;
    r = duplicateSection(r.idea, chorus.id, true)!;
    expect(linkedSections(r.idea, chorus.id)).toHaveLength(3);
    const un = unlinkSection(r.idea, r.section.id);
    expect(linkedSections(un, chorus.id)).toHaveLength(2);
    expect(un.sections.find((s) => s.id === r.section.id)!.link).toBeUndefined();
    const removed = removeSection(un, chorus.id);
    expect(removed.sections.every((s) => s.link === undefined)).toBe(true);
  });

  it('keeps links through save and load', () => {
    const { idea, chorus } = withChorus();
    const r = duplicateSection(idea, chorus.id, true)!;
    const loaded = normalizeIdea(JSON.parse(JSON.stringify(r.idea)))!;
    expect(linkedSections(loaded, chorus.id)).toHaveLength(2);
  });

  it('moves a section to any position and measures the song', () => {
    const { idea, chorus } = withChorus();
    const moved = moveSectionTo(idea, chorus.id, 0);
    expect(moved.sections[0]!.id).toBe(chorus.id);
    expect(songLength(idea)).toEqual({ beats: 4, seconds: 2.4 });
  });
});

describe('layoutBars', () => {
  it('splits a progression into 4-beat bars, carrying long chords over', () => {
    const prog = [{ id: 'a', frets: FMAJ7, beats: 2 }, { id: 'b', frets: FM7, beats: 2 }, { id: 'c', frets: EM7, beats: 6 }];
    const bars = layoutBars(prog);
    expect(bars.map((b) => b.map((c) => `${c.itemId}${c.start}+${c.beats}${c.continued ? '~' : ''}`))).toEqual([
      ['a0+2', 'b2+2'],
      ['c0+4'],
      ['c0+2~'],
    ]);
  });
});

describe('strum pattern', () => {
  it('defaults to one strum per beat, follows linked sections and survives saving', () => {
    let idea = addSection(createIdea(), 'chorus').idea;
    const chorus = idea.sections[1]!;
    expect(patternOf(chorus)).toBe('beat');
    const r = duplicateSection(idea, chorus.id, true)!;
    idea = updateSection(r.idea, chorus.id, { pattern: 'folk' });
    expect(idea.sections.find((s) => s.id === r.section.id)!.pattern).toBe('folk');
    const loaded = normalizeIdea(JSON.parse(JSON.stringify({ ...idea, sections: [...idea.sections, { ...chorus, id: 'x', pattern: 'bogus' }] })))!;
    expect(loaded.sections[1]!.pattern).toBe('folk');
    expect(loaded.sections[3]!.pattern).toBeUndefined();
  });
});
