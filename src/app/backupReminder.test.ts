import { describe, expect, it } from 'vitest';
import { createIdea, updateSection, type Idea } from '../core';
import { backupReminder } from './BackupPanel';

const DAY = 86_400_000;
const withChord = (updatedAt: number): Idea => {
  const idea = createIdea('x', 0);
  return { ...updateSection(idea, idea.sections[0]!.id, { progression: [{ id: 'c', frets: [null, 3, 2, 0, 1, 0] }] }), updatedAt };
};

describe('backupReminder', () => {
  it('stays quiet when there is nothing worth backing up', () => {
    expect(backupReminder([createIdea()], undefined, 10 * DAY)).toBe('');
  });
  it('asks for a first backup once there is real content', () => {
    expect(backupReminder([withChord(DAY)], undefined, 2 * DAY)).toBe('還沒備份過');
  });
  it('reminds after a week only if something changed since the last backup', () => {
    expect(backupReminder([withChord(5 * DAY)], 1 * DAY, 9 * DAY)).toBe('8 天沒備份');
    expect(backupReminder([withChord(5 * DAY)], 1 * DAY, 3 * DAY)).toBe('');
    expect(backupReminder([withChord(1 * DAY)], 2 * DAY, 30 * DAY)).toBe('');
  });
});
