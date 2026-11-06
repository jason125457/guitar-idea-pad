import { useCallback, useEffect, useRef, useState } from 'react';
import { getContext } from '../audio/context';
import { onStopAll, playTimedChords, stopAll, strumBeats } from '../audio/pluck';

/** 播放清單裡的一格：哪個段落的哪個和弦、幾拍、一拍幾秒。 */
export interface PlanItem {
  sectionId: string;
  itemId: string;
  midis: number[];
  beats: number;
  beatSec: number;
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
    (plan: readonly PlanItem[], opts: { loop?: boolean; mode: 'section' | 'song' }) => {
      const timed = schedule(plan);
      if (!timed.length) return;
      const run = () => {
        const chords = timed.flatMap((p) =>
          strumBeats([{ midis: p.midis, beats: p.beats }], p.beatSec).map((c) => ({ ...c, startSec: c.startSec + p.startSec })),
        );
        const total = playTimedChords(chords); // 會先 stopAll → halt，所以下面才設定新的狀態
        setMode(opts.mode);
        // 用音訊時鐘對齊（playTimedChords 從 currentTime + 0.05 秒開始排），游標才會和聲音同步
        const ctx = getContext();
        const t0 = ctx.currentTime + 0.05;
        const tick = () => {
          const t = ctx.currentTime - t0;
          if (t >= total) {
            if (opts.loop) return run();
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
      run();
    },
    [halt],
  );

  return { pos, mode, play, stop: stopAll };
}
