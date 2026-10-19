import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addSection, createIdea, updateSection } from '../core';
import { deleteIdea, listIdeas, putIdea } from './db';

describe('IndexedDB store', () => {
  it('round-trips an idea with sections and sorts newest first', async () => {
    const older = createIdea('舊的', 1000);
    let newer = createIdea('新的', 2000);
    newer = addSection(newer, 'chorus').idea;
    newer = updateSection(newer, newer.sections[1]!.id, { melody: 'A4 C5', progression: [{ id: 'c1', frets: [8, 8, 10, 9, 10, 8] }] });
    newer = { ...newer, updatedAt: 3000 };
    await putIdea(older);
    await putIdea(newer);

    const list = await listIdeas();
    const ids = list.map((i) => i.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    const back = list.find((i) => i.id === newer.id)!;
    expect(back.sections.map((s) => s.label)).toEqual(['verse', 'chorus']);
    expect(back.sections[1]!.progression[0]!.frets).toEqual([8, 8, 10, 9, 10, 8]);
    expect(back.sections[1]!.melody).toBe('A4 C5');
  });

  it('put overwrites by id and delete removes', async () => {
    const idea = createIdea('x', 10);
    await putIdea(idea);
    await putIdea({ ...idea, title: 'y', updatedAt: 11 });
    expect((await listIdeas()).filter((i) => i.id === idea.id).map((i) => i.title)).toEqual(['y']);
    await deleteIdea(idea.id);
    expect((await listIdeas()).some((i) => i.id === idea.id)).toBe(false);
  });

  it('skips corrupted rows instead of failing the whole list', async () => {
    const dbReq = indexedDB.open('guitar-idea-pad');
    await new Promise<void>((resolve, reject) => {
      dbReq.onsuccess = () => {
        const tx = dbReq.result.transaction('ideas', 'readwrite');
        tx.objectStore('ideas').put({ id: 'broken', sections: 'nope', title: 42 });
        tx.objectStore('ideas').put({ nokey: true, id: 'garbage-no-sections' });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
    const list = await listIdeas();
    const broken = list.find((i) => i.id === 'broken');
    expect(broken?.title).toBe('未命名靈感'); // 被修復成可用的靈感
    expect(broken?.sections.length).toBeGreaterThan(0);
  });
});
