// @vitest-environment jsdom
// 唱旋律面板：用假的麥克風（直接給音高幀）測「唱完先確認、改錯，再放進時間軸」。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BeatNote, PitchFrame } from '../core';
import { SingAlong } from './SingAlong';

/** 0.5 秒一拍：E4 兩拍、一個低了兩個八度的雜訊、G4 兩拍 */
function frames(): PitchFrame[] {
  const out: PitchFrame[] = [];
  const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
  const seg = (m: number, from: number, to: number) => {
    for (let t = from; t < to; t += 0.01) out.push({ t, hz: hz(m), clarity: 0.98, rms: 0.1 });
  };
  seg(64, 0.03, 0.98);
  seg(40, 1.03, 1.5);
  seg(67, 1.53, 2.48);
  return out;
}

vi.mock('../audio/context', () => ({ getContext: () => ({ currentTime: 0, outputLatency: 0, baseLatency: 0 }) }));
vi.mock('../audio/pitchTracker', () => ({
  TrackerError: class extends Error {},
  PitchTracker: class {
    onFrame: unknown;
    async start() {}
    now() {
      return 0;
    }
    stop() {
      return frames();
    }
  },
}));

afterEach(cleanup);

describe('SingAlong review', () => {
  it('shows what was heard, flags the odd note, lets you fix it, then saves', async () => {
    const onDone = vi.fn<(n: BeatNote[]) => void>();
    render(
      <SingAlong
        hasChords
        bars={4}
        onBars={() => {}}
        takes={[]}
        onUseTake={() => {}}
        onHearTake={() => {}}
        onHearNotes={() => {}}
        onTyped={() => {}}
        onClose={() => {}}
        sectionName="主歌"
        beatSec={0.5}
        totalBeats={8}
        keyInfo={undefined}
        speller={(pc) => ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][((pc % 12) + 12) % 12] as string}
        hasMelody={false}
        start={() => ({ t0: 0, total: 4 })}
        stop={() => {}}
        onDone={onDone}
        onClear={() => {}}
        withMelody
        onWithMelody={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /開始唱/ }));
    fireEvent.click(await screen.findByRole('button', { name: '■ 唱完了' }));

    const notes = () => [...document.querySelectorAll('.rnote')].map((b) => (b.firstChild as Text).textContent);
    await waitFor(() => expect(notes()).toEqual(['E4', 'E2', 'G4']));
    // 低兩個八度的那個被標成可疑
    const odd = [...document.querySelectorAll('.rnote')][1] as HTMLElement;
    expect(odd.className).toContain('is-sus');

    fireEvent.click(odd);
    expect(screen.getByText(/抓錯八度/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '刪掉' }));
    expect(notes()).toEqual(['E4', 'G4']);
    expect(onDone).not.toHaveBeenCalled(); // 還沒按「放進時間軸」

    fireEvent.click(screen.getByRole('button', { name: '放進時間軸' }));
    expect(onDone.mock.calls[0]![0].map((n) => n.midi)).toEqual([64, 67]);
  });
});
