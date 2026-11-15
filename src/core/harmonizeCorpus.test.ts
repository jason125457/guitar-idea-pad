import { describe, expect, it } from 'vitest';
import { CORPUS, corpusReport, scoreSet } from './harmonizeCorpus';

// 真實旋律＋常見歌本和弦的對照。旋律憑記憶寫、參考和弦一小節只取一個，所以只設保守的下限，不鎖定輸出。
describe('harmonizer against a small corpus of known tunes', () => {
  it('builds every piece with whole bars and one reference per bar', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(8);
    expect(CORPUS.some((p) => p.key.mode === 'minor')).toBe(true);
    expect(CORPUS.some((p) => p.split === 'test')).toBe(true);
    for (const p of CORPUS) {
      expect(p.refs.length).toBeGreaterThan(0);
      expect(Math.max(...p.notes.map((n) => n.beat + n.beats))).toBeLessThanOrEqual(p.refs.length * 4 + 1e-9);
    }
  });

  // CORPUS_REPORT=1 npx vitest run src/core/harmonizeCorpus.test.ts --silent=false 會印出整張表
  it('prints the comparison table', () => {
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
    if (env?.CORPUS_REPORT) console.log(`\n${corpusReport()}`);
    expect(corpusReport()).toContain('TOTAL all');
  });

  it('the Viterbi path matches the songbook at least as often as the per-bar picker', () => {
    const greedy = scoreSet(CORPUS, 'greedy');
    const flow = scoreSet(CORPUS, 'flowSimple');
    expect(flow.family).toBeGreaterThanOrEqual(greedy.family);
    expect(flow.triad).toBeGreaterThanOrEqual(greedy.triad);
    expect(flow.func).toBeGreaterThanOrEqual(greedy.func);
  });

  // 寫測試時（2026-11）大約是：簡單模式 三度相符 60%、功能相近 75%；色彩模式 55%、62%；不摩擦 96–98%。
  // 下限留一點空間，是防止明顯退步用的，不是品質保證
  it('keeps modest floors on the whole corpus', () => {
    const floors = { flowSimple: { triad: 0.55, func: 0.7 }, flowColor: { triad: 0.5, func: 0.57 } };
    for (const m of ['flowSimple', 'flowColor'] as const) {
      const s = scoreSet(CORPUS, m);
      expect(s.triad / s.bars).toBeGreaterThanOrEqual(floors[m].triad);
      expect(s.func / s.bars).toBeGreaterThanOrEqual(floors[m].func);
      expect(s.clashFree / s.bars).toBeGreaterThanOrEqual(0.9);
    }
  });
});
