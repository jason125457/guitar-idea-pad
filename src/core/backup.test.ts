import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  addSection,
  backupFileName,
  createBackup,
  createIdea,
  parseBackup,
  planImport,
  serializeBackup,
  updateSection,
  type Idea,
} from './index';

function sample(title = '靈感 A'): Idea {
  let idea = createIdea(title, 1000);
  idea = addSection(idea, 'chorus').idea;
  idea = updateSection(idea, idea.sections[1]!.id, {
    melody: 'A4 C5',
    keyLock: { tonic: 0, mode: 'major' },
    progression: [{ id: 'c1', frets: [8, 8, 10, 9, 10, 8] }, { id: 'c2', frets: [null, 3, 2, 0, 1, 0] }],
  });
  return { ...idea, updatedAt: 2000 };
}

describe('backup round trip', () => {
  it('serializes and parses back to identical ideas', () => {
    const a = sample('A');
    const b = sample('B');
    const text = serializeBackup(createBackup([a, b], 5));
    const r = parseBackup(text);
    expect(r).toMatchObject({ ok: true, skipped: 0, exportedAt: 5 });
    if (!r.ok) return;
    expect(r.ideas).toEqual([a, b]);
  });

  it('does not alias the live objects', () => {
    const a = sample();
    const backup = createBackup([a]);
    a.title = 'changed later';
    expect(backup.ideas[0]!.title).toBe('靈感 A');
  });
});

describe('parseBackup rejects bad files without throwing', () => {
  it.each([
    ['not json', '{oops', 'JSON'],
    ['other json', JSON.stringify({ hello: 1 }), '備份檔'],
    ['array', '[]', '備份檔'],
    ['null', 'null', '備份檔'],
    ['no version', JSON.stringify({ format: BACKUP_FORMAT, ideas: [] }), '版本'],
    ['newer version', JSON.stringify({ format: BACKUP_FORMAT, version: 99, ideas: [] }), '較新版本'],
    ['no ideas', JSON.stringify({ format: BACKUP_FORMAT, version: 1 }), '沒有靈感'],
  ])('%s', (_name, text, hint) => {
    const r = parseBackup(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(hint);
  });

  it('skips unusable ideas and counts them, repairing partial ones', () => {
    const good = sample();
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      ideas: [good, 42, { nothing: true }, { id: 'half', title: 'x', sections: [{ progression: [{ frets: [1, 2] }] }] }],
    });
    const r = parseBackup(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skipped).toBe(2);
    expect(r.ideas.map((i) => i.id)).toEqual([good.id, 'half']);
    expect(r.ideas[1]!.sections[0]!.progression).toEqual([]); // 壞指法被丟掉，不會進資料庫
  });

  it('rejects oversized input', () => {
    expect(parseBackup('x'.repeat(21 * 1024 * 1024)).ok).toBe(false);
  });
});

describe('planImport never overwrites', () => {
  it('adds new ideas, skips identical ones, copies conflicting ones', () => {
    const same = sample('same');
    const local = sample('local version');
    const remoteChanged = { ...local, title: 'remote version', updatedAt: 9999 };
    const fresh = sample('brand new');
    const plan = planImport([same, local], [same, remoteChanged, fresh], 7);

    expect(plan.identical).toBe(1);
    expect(plan.copied).toBe(1);
    expect(plan.add).toHaveLength(2);
    const copy = plan.add.find((i) => i.title.includes('匯入'))!;
    expect(copy.title).toBe('remote version（匯入）');
    expect(copy.id).not.toBe(local.id);
    expect(copy.sections.map((s) => s.id)).not.toContain(local.sections[0]!.id);
    expect(copy.sections[1]!.progression[0]!.frets).toEqual([8, 8, 10, 9, 10, 8]);
    expect(plan.add.some((i) => i.id === fresh.id)).toBe(true);
  });

  it('handles the same id appearing twice in one file', () => {
    const a = sample('dup');
    const plan = planImport([], [a, { ...a, title: 'dup edited' }]);
    expect(plan.add).toHaveLength(2);
    expect(new Set(plan.add.map((i) => i.id)).size).toBe(2);
    expect(plan.copied).toBe(1);
  });

  it('importing the same backup twice adds nothing the second time', () => {
    const ideas = [sample('x'), sample('y')];
    const first = planImport([], ideas);
    const second = planImport(first.add, ideas);
    expect(second.add).toHaveLength(0);
    expect(second.identical).toBe(2);
  });
});

describe('backupFileName', () => {
  it('formats dates and sanitizes titles', () => {
    const d = new Date(2026, 9, 19);
    expect(backupFileName(d)).toBe('指板靈感本-備份-2026-10-19.json');
    expect(backupFileName(d, 'a/b:c*?"<>|d')).toBe('指板靈感本-a_b_c______d-2026-10-19.json');
    expect(backupFileName(d, '   ')).toBe('指板靈感本-未命名靈感-2026-10-19.json');
    expect(backupFileName(d, 'x'.repeat(100))).toContain('x'.repeat(40) + '-2026');
  });
});
