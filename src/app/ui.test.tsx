// @vitest-environment jsdom
// 畫面層級的測試：真的把元件畫出來、點按鈕，確認使用者看到的行為（單元測試抓不到的那一類問題）。
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fret } from '../core';
import { App } from './App';
import { Fretboard } from './Fretboard';
import { Timeline } from './Timeline';
import { UndoToast } from './UndoToast';

// jsdom 沒有 AudioContext：加和弦、換按法時會順便刷一下，這裡只要不出聲就好
vi.mock('../audio/pluck', async (orig) => ({
  ...(await orig<typeof import('../audio/pluck')>()),
  playChords: vi.fn(() => 0),
  playTimedChords: vi.fn(() => 0),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function FretboardHarness({ initial }: { initial: Fret[] }) {
  const [frets, setFrets] = useState<Fret[]>(initial);
  return (
    <>
      <Fretboard frets={frets} onChange={setFrets} />
      <button type="button" onClick={() => setFrets([20, null, null, null, null, 22])}>
        外部改成高把位
      </button>
      <output data-testid="frets">{frets.map((f) => (f === null ? 'x' : f)).join(' ')}</output>
    </>
  );
}

describe('Fretboard', () => {
  it('keeps the window where the player is looking when they tap a fret', () => {
    render(<FretboardHarness initial={[3, null, null, null, null, null]} />);
    expect(screen.getByText('第 1–5 品')).toBeTruthy();
    const higher = screen.getByRole('button', { name: '指板往高把位移動' });
    for (let i = 0; i < 7; i++) fireEvent.click(higher);
    expect(screen.getByText('第 8–12 品')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '二弦 第 10 品' }));
    expect(screen.getByTestId('frets').textContent).toBe('3 x x x 10 x');
    expect(screen.getByText('第 8–12 品')).toBeTruthy(); // 以前會跳回 1–5 品
  });

  it('scrolls to show frets that change from outside, up to the 24th fret', () => {
    render(<FretboardHarness initial={[null, 3, 2, 0, 1, 0]} />);
    fireEvent.click(screen.getByRole('button', { name: '外部改成高把位' }));
    expect(screen.getByText('第 20–24 品')).toBeTruthy();
  });
});

describe('Timeline with a sung melody', () => {
  it('draws each note over the chord it falls under and marks a clashing chord', () => {
    render(
      <Timeline
        chords={[
          { id: 'a', name: 'C', roman: 'I', tag: 'diatonic', beats: 4, fit: 'stable' },
          { id: 'b', name: 'G', roman: 'V', tag: 'diatonic', beats: 4, fit: 'clash', clashText: 'C5' },
        ]}
        selectedId={null}
        pos={null}
        onSelect={() => {}}
        onAdd={() => {}}
        addActive
        melody={[{ midi: 64, beat: 0, beats: 2 }, { midi: 67, beat: 2, beats: 4 }, { midi: 72, beat: 6, beats: 2 }]}
      />,
    );
    const blocks = [...document.querySelectorAll('.tl-block:not(.tl-add)')];
    // 第二個音跨過兩個和弦：兩邊各畫一段
    expect(blocks.map((b) => b.querySelectorAll('.tl-note').length)).toEqual([2, 2]);
    expect(blocks[0]!.querySelector('.tl-clash')).toBeNull();
    expect(blocks[1]!.querySelector('.tl-clash')?.textContent).toBe('摩擦');
    expect(screen.getByRole('button', { name: /第 2 個和弦 G.*跟旋律的 C5 有摩擦/ })).toBeTruthy();
  });
});

describe('UndoToast', () => {
  it('closes by itself, but not while the pointer is over it', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<UndoToast message="已刪除 C" onUndo={() => {}} onClose={onClose} timeoutMs={1000} />);
    const toast = screen.getByRole('status');
    fireEvent.mouseEnter(toast);
    act(() => void vi.advanceTimersByTime(5000));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseLeave(toast);
    act(() => void vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('App', () => {
  const chipNames = () => [...document.querySelectorAll('.tl .chip-name')].map((e) => e.textContent);
  /** 等畫面載入（右邊的加和弦分頁出現） */
  const ready = () => screen.findByRole('tab', { name: '常用' });
  const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
  /** 清空這段（在段落的 ⋯ 選單裡）；空的段落沒有這個選項 */
  const clearSection = () => {
    const b = screen.queryByRole('button', { name: '清空這段的和弦' });
    if (b) fireEvent.click(b);
  };
  const sectionTabs = () => within(document.querySelector('.st-strip') as HTMLElement).getAllByRole('tab');

  it('names a chord pressed on the board, then loads, clears and restores a progression', async () => {
    render(<App />);
    await ready();
    tab('自己按');
    fireEvent.change(screen.getByLabelText('六弦 → 一弦，x 代表悶音'), { target: { value: 'x32010' } });
    expect(document.querySelector('.inspector-bare .now-name')?.textContent).toBe('C');

    fireEvent.click(await screen.findByRole('button', { name: /載入範例/ }));
    await waitFor(() => expect(chipNames()).toEqual(['Fmaj7/C', 'Fm7/C', 'Em7/B']));

    clearSection();
    expect(chipNames()).toEqual([]);
    const toast = document.querySelector('.toast') as HTMLElement;
    expect(toast.textContent).toContain('已清空');
    fireEvent.click(within(toast).getByRole('button', { name: '復原' }));
    await waitFor(() => expect(chipNames()).toEqual(['Fmaj7/C', 'Fm7/C', 'Em7/B']));
  });

  it('turns a pasted chord progression into high-position electric voicings', async () => {
    render(<App />);
    await ready();
    clearSection();
    tab('打字／貼上');
    fireEvent.change(screen.getByLabelText('和弦進行'), {
      target: { value: '這只是說明，C 和 F 都有提到。\n副歌：C → G/B → Am7 → Fmaj7' },
    });
    expect(document.querySelectorAll('.import-row')).toHaveLength(1);
    expect(screen.getByLabelText('第 1 行的段落')).toHaveProperty('value', 'chorus');

    fireEvent.click(screen.getByRole('button', { name: /^＋ 加進/ }));
    await waitFor(() => expect(chipNames()).toEqual(['C', 'G/B', 'Am7', 'Fmaj7']));
    // 電吉他高把位：沒有空弦
    for (const f of [...document.querySelectorAll('.import-frets')].map((e) => e.textContent ?? '')) {
      expect(f.split(' ')).not.toContain('0');
    }
  });

  it('adds chords from the palette and edits the selected one in place', async () => {
    render(<App />);
    await ready();
    clearSection();

    // 鎖定 C 大調，點調內和弦就加進時間軸；加完會選取剛加的和弦，按 ✕ 回到加和弦
    fireEvent.change(screen.getByLabelText('指定調性'), { target: { value: '0-major' } });
    fireEvent.click(screen.getByRole('button', { name: '加入 C' }));
    fireEvent.click(screen.getByRole('button', { name: '取消選取，回到加和弦' }));
    fireEvent.click(screen.getByRole('button', { name: '加入 Am' }));
    await waitFor(() => expect(chipNames()).toEqual(['C', 'Am']));

    // 打和弦名稱加入：Am 選取中，會插在它後面
    fireEvent.click(screen.getByRole('button', { name: '取消選取，回到加和弦' }));
    fireEvent.click(screen.getByRole('button', { name: /第 2 個和弦 Am/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消選取，回到加和弦' }));
    tab('打字／貼上');
    fireEvent.change(screen.getByLabelText('直接輸入和弦名稱'), { target: { value: 'Fmaj7' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ Fmaj7' }));
    await waitFor(() => expect(chipNames()).toEqual(['C', 'Am', 'Fmaj7']));

    // 選中 Am：拍數 −／＋ 直接改那一格，方塊的拍點跟著變
    fireEvent.click(screen.getByRole('button', { name: /第 2 個和弦 Am/ }));
    fireEvent.click(screen.getByRole('button', { name: '少一拍' }));
    fireEvent.click(screen.getByRole('button', { name: '少一拍' }));
    await waitFor(() => expect(document.querySelectorAll('.tl-block')[1]?.querySelectorAll('.tl-beat')).toHaveLength(2));

    // 換按法：還是 Am，只是指法換了
    const before = (screen.getByLabelText('六弦 → 一弦，x 代表悶音') as HTMLInputElement).value;
    const options = [...document.querySelectorAll<HTMLButtonElement>('.shapes .shape')];
    expect(options.length).toBeGreaterThan(1);
    expect(options[0]!.textContent).toContain('最好接');
    expect(options.filter((o) => o.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    fireEvent.click(options.find((o) => o.getAttribute('aria-pressed') !== 'true')!);
    await waitFor(() => expect((screen.getByLabelText('六弦 → 一弦，x 代表悶音') as HTMLInputElement).value).not.toBe(before));
    expect(chipNames()).toEqual(['C', 'Am', 'Fmaj7']);
  });

  it('adds a typed chord list at once, and hands a pasted paragraph to the paste panel', async () => {
    render(<App />);
    await ready();
    clearSection();
    tab('打字／貼上');
    fireEvent.change(screen.getByLabelText('直接輸入和弦名稱'), { target: { value: 'Cmaj7、Fmaj7' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ 加入 2 個' }));
    await waitFor(() => expect(chipNames()).toEqual(['Cmaj7', 'Fmaj7']));

    fireEvent.click(screen.getByRole('button', { name: '取消選取，回到加和弦' }));
    tab('打字／貼上');
    const paragraph = '主歌：Cadd9 → Fmaj7#11\n副歌：C → G/B → Am7 → Fmaj7';
    fireEvent.paste(screen.getByLabelText('直接輸入和弦名稱'), { clipboardData: { getData: () => paragraph } });
    await waitFor(() => expect((screen.getByLabelText('和弦進行') as HTMLTextAreaElement).value).toBe(paragraph));
    expect(document.querySelectorAll('.import-row')).toHaveLength(2);
  });

  it('shows the song as a chart with the chosen shapes, and jumps back to edit a chord', async () => {
    render(<App />);
    await ready();
    clearSection();
    tab('打字／貼上');
    fireEvent.change(screen.getByLabelText('直接輸入和弦名稱'), { target: { value: 'Am7 Fmaj7 Am7' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ 加入 3 個' }));
    await waitFor(() => expect(chipNames()).toHaveLength(3));

    fireEvent.click(screen.getByRole('button', { name: '譜（和弦＋指法）' }));
    // 用到的指法：Am7 出現兩次但按法一樣，只列一次
    expect([...document.querySelectorAll('.sheet-shape figcaption')].map((e) => e.textContent)).toEqual(['Am7', 'Fmaj7']);
    const chords = [...document.querySelectorAll<HTMLButtonElement>('.sheet-chord')];
    expect(chords.map((c) => c.textContent)).toEqual(['Am7', 'Fmaj7', 'Am7']);

    fireEvent.click(chords[1]!);
    await waitFor(() => expect(document.querySelector('.inspector h2')?.textContent).toBe('第 2 個和弦'));
  });

  it('repeats a section as a linked copy, so editing one changes both', async () => {
    render(<App />);
    await ready();
    tab('打字／貼上');
    fireEvent.change(screen.getByLabelText('直接輸入和弦名稱'), { target: { value: 'Am7' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ Am7' }));
    await waitFor(() => expect(chipNames()).toContain('Am7'));
    const before = chipNames();

    fireEvent.click(screen.getByRole('button', { name: /^重複這段（連動）/ }));
    await waitFor(() => expect(sectionTabs()).toHaveLength(2));
    expect(sectionTabs()[1]!.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('.linked-note')?.textContent).toContain('主歌 1');

    // 在第二段加一個和弦，切回第一段也看得到
    tab('打字／貼上');
    fireEvent.change(screen.getByLabelText('直接輸入和弦名稱'), { target: { value: 'G' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ G' }));
    await waitFor(() => expect(chipNames()).toEqual([...before, 'G']));
    fireEvent.click(sectionTabs()[0]!);
    await waitFor(() => expect(chipNames()).toEqual([...before, 'G']));
  });

  it('shows the key and roman numerals for the example progression', async () => {
    // 同一個測試檔共用假的 IndexedDB：上一個測試存下的進行會被載回來
    render(<App />);
    await ready();
    clearSection();
    fireEvent.click(await screen.findByRole('button', { name: /載入範例/ }));
    await waitFor(() => expect(document.querySelector('.key-name')?.textContent).toContain('C 大調'));
    expect([...document.querySelectorAll('.tl .chip-roman')].map((e) => e.textContent).slice(0, 3)).toEqual(['IVmaj7', 'ivm7', 'iiim7']);
  });

  it('lets you sing before there are any chords', async () => {
    render(<App />);
    await ready();
    clearSection();
    fireEvent.click(screen.getByRole('button', { name: '唱旋律' }));
    expect(screen.getByText(/這段還沒有和弦：只放節拍器/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /開始唱/ })).toHaveProperty('disabled', false);
    expect(screen.getByLabelText('唱幾小節')).toHaveProperty('value', '4');
  });
});
