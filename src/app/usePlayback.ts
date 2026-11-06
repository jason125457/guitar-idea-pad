import { useCallback, useEffect, useRef, useState } from 'react';
import { getContext } from '../audio/context';
import { onStopAll, playTimedChords, stopAll } from '../audio/pluck';
import { patternEvents } from '../audio/rhythm';
import { scheduleClicks, scheduleMelody, stopTones, type PlayableNote } from '../audio/tone';
import type { StrumPattern } from '../core';

/** 播放清單裡的一格：哪個段落的哪個和弦、幾拍、一拍幾秒。 */
export interface PlanItem {
  sectionId: string;
  itemId: string;
  midis: number[];
  beats: number;
  beatSec: number;
  /** 這個段落的彈法 */
  pattern: StrumPattern;
  /** 這個和弦在段落裡從第幾拍開始（節奏型要對齊小節） */
  sectionBeat: number;
}

/** 目前播到哪裡：哪個和弦的第幾拍（從 0 起算）。 */
export interface PlayPos {
  sectionId: string;
  itemId: string;
  beat: number;
}

/** 依每格自己的速度排出開始時間；不同段落可以有不同速度。 */
function schedule(plan: readonly PlanItem[]) {
  let t = 0;
  return plan.map((p) => {
    const start = t;
    t += p.beats * p.beatSec;
    return { ...p, startSec: start };
  });
}

/**
 * 播放和弦並追蹤播放游標：每拍刷一下，畫面跟著亮到目前的和弦與拍點。
 * 任何地方呼叫 stopAll（包含開始播別的東西）都會讓游標停下。
 */
export function usePlayback() {
  const [pos, setPos] = useState<PlayPos | null>(null);
  const [mode, setMode] = useState<'section' | 'song' | null>(null);
  const raf = useRef(0);
  const last = useRef('');

  const halt = useCallback(() => {
    stopTones();
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    last.current = '';
    setPos(null);
    setMode(null);
  }, []);

  useEffect(() => {
    const off = onStopAll(halt);
    return () => {
      off();
      cancelAnimationFrame(raf.current);
    };
  }, [halt]);

  const play = useCallback(
    (
      plan: readonly PlanItem[],
      opts: {
        loop?: boolean;
        mode: 'section' | 'song';
        startAt?: number;
        /** 一起播的旋律，startSec 從整個 plan 的開頭算 */
        melody?: readonly PlayableNote[];
        /** 先空這麼多秒再開始（給數拍用），期間每拍「滴」一下 */
        countInBeats?: number;
        /** 只放節拍器、不刷和弦（錄音時避免吉他聲被麥克風收進去） */
        clickOnly?: boolean;
      },
    ): { t0: number; total: number } | undefined => {
      const full = schedule(plan);
      if (!full.length) return undefined;
      // 從第 startAt 個和弦開始播；循環時第二輪起從頭播整段
      const startAt = Math.max(0, Math.min(opts.startAt ?? 0, plan.length - 1));
      const first = schedule(plan.slice(startAt));
      const firstOffset = full[startAt]?.startSec ?? 0;
      let result: { t0: number; total: number } | undefined;
      const run = (timed: typeof full, offset: number, countIn: number) => {
        const beat0 = timed[0]?.beatSec ?? 0.5;
        const lead = countIn * beat0;
        const chords = timed.flatMap((p) =>
          patternEvents(p.midis, p.beats, p.beatSec, p.pattern, p.sectionBeat).map((c) => ({ ...c, startSec: c.startSec + p.startSec + lead })),
        );
        const span = timed.reduce((e, p) => Math.max(e, p.startSec + p.beats * p.beatSec), 0);
        // 會先 stopAll → halt，所以下面才設定新的狀態；只放節拍器時用一個無聲的「和弦」讓總長一致
        const sounded = opts.clickOnly ? [{ midis: [], startSec: lead, durSec: span }] : chords;
        const total = playTimedChords(sounded) - lead;
        setMode(opts.mode);
        // 用音訊時鐘對齊（playTimedChords 從 currentTime + 0.05 秒開始排），游標才會和聲音同步
        const ctx = getContext();
        const t0 = ctx.currentTime + 0.05 + lead;
        const clicks: number[] = [];
        for (let i = 0; i < countIn; i++) clicks.push(t0 - lead + i * beat0);
        if (opts.clickOnly) for (const p of timed) for (let b = 0; b < p.beats; b++) clicks.push(t0 + p.startSec + b * p.beatSec);
        scheduleClicks(ctx, clicks);
        if (opts.melody?.length) {
          scheduleMelody(ctx, t0, opts.melody.map((n) => ({ ...n, startSec: n.startSec - offset })).filter((n) => n.startSec >= -1e-6));
        }
        result = { t0, total };
        const tick = () => {
          const t = ctx.currentTime - t0;
          if (t < 0) {
            // 還在數拍：游標先不動
            raf.current = requestAnimationFrame(tick);
            return;
          }
          if (t >= total) {
            if (opts.loop) return run(full, 0, 0);
            return halt();
          }
          const cur = [...timed].reverse().find((p) => p.startSec <= t) ?? timed[0]!;
          const beat = Math.max(0, Math.min(cur.beats - 1, Math.floor((t - cur.startSec) / cur.beatSec)));
          const key = `${cur.itemId}:${beat}`;
          if (key !== last.current) {
            last.current = key;
            setPos({ sectionId: cur.sectionId, itemId: cur.itemId, beat });
          }
          raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
      };
      run(first, firstOffset, opts.countInBeats ?? 0);
      return result;
    },
    [halt],
  );

  return { pos, mode, play, stop: stopAll };
}
