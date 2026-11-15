import { beforeEach, describe, expect, it, vi } from 'vitest';

const cancels: ReturnType<typeof vi.fn>[] = [];
const player = {
  start: vi.fn(() => {
    const cancel = vi.fn();
    cancels.push(cancel);
    return cancel;
  }),
  stop: vi.fn(),
};
vi.mock('./sound', () => ({ STRUM_GAP_SEC: 0.02, activePlayer: () => player, strumVelocity: () => 80 }));

import { scheduleChords, stopAll } from './pluck';

describe('stopAll with the sampled guitar', () => {
  beforeEach(() => {
    cancels.length = 0;
    player.start.mockClear();
    player.stop.mockClear();
  });

  it('cancels notes that were scheduled but have not sounded yet, not only the ones already playing', () => {
    // smplr 的 stop() 只停已經響的音，排在後面的音留在它的佇列裡，會跟下一次播放疊在一起
    scheduleChords({} as AudioContext, 0, [
      { midis: [48, 52, 55], startSec: 0, durSec: 1 },
      { midis: [50, 53, 57], startSec: 8, durSec: 1 },
    ]);
    expect(cancels).toHaveLength(6);
    stopAll();
    for (const c of cancels) expect(c).toHaveBeenCalledTimes(1);
    expect(player.stop).toHaveBeenCalled();

    // 取消過的不會再被取消一次
    stopAll();
    for (const c of cancels) expect(c).toHaveBeenCalledTimes(1);
  });
});
