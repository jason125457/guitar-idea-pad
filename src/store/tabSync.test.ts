import { describe, expect, it } from 'vitest';
import { createIdea, type Idea } from '../core';
import { applyRemote } from './tabSync';

const at = (idea: Idea, updatedAt: number, title = idea.title): Idea => ({ ...idea, updatedAt, title });

describe('applyRemote', () => {
  const a = at(createIdea('A'), 100);
  const b = at(createIdea('B'), 100);

  it('takes a newer version from another tab', () => {
    const out = applyRemote([a, b], { type: 'saved', idea: at(a, 200, 'A2') });
    expect(out.find((i) => i.id === a.id)?.title).toBe('A2');
  });
  it('keeps the local copy when it is the same age or newer', () => {
    const list = [at(a, 300, 'local'), b];
    expect(applyRemote(list, { type: 'saved', idea: at(a, 200, 'remote') })).toBe(list);
    expect(applyRemote(list, { type: 'saved', idea: at(a, 300, 'remote') })).toBe(list);
  });
  it('adds ideas created in another tab and removes deleted ones', () => {
    const c = at(createIdea('C'), 50);
    expect(applyRemote([a], { type: 'saved', idea: c }).map((i) => i.id)).toEqual([c.id, a.id]);
    expect(applyRemote([a, b], { type: 'deleted', id: a.id }).map((i) => i.id)).toEqual([b.id]);
  });
  it('returns the same array when nothing changes', () => {
    const list = [a];
    expect(applyRemote(list, { type: 'deleted', id: 'nope' })).toBe(list);
  });
});
