// @vitest-environment jsdom
// 畫面層級的測試：真的把元件畫出來、點按鈕，確認使用者看到的行為（單元測試抓不到的那一類問題）。
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fret } from '../core';
import { App } from './App';
import { Fretboard } from './Fretboard';
import { UndoToast } from './UndoToast';

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
  it('names a typed chord, then loads, clears and restores a progression', async () => {
    render(<App />);
    const input = await screen.findByLabelText('六弦 → 一弦，x 代表悶音');

    fireEvent.change(input, { target: { value: 'x32010' } });
    expect(document.querySelector('.now-name')?.textContent).toBe('C');

    fireEvent.click(await screen.findByRole('button', { name: /載入範例/ }));
    const chipNames = () => [...document.querySelectorAll('.chip-name')].map((e) => e.textContent);
    await waitFor(() => expect(chipNames()).toEqual(['Fmaj7/C', 'Fm7/C', 'Em7/B']));

    fireEvent.click(screen.getByRole('button', { name: '清空此段' }));
    expect(chipNames()).toEqual([]);
    const toast = document.querySelector('.toast') as HTMLElement;
    expect(toast.textContent).toContain('已清空');
    fireEvent.click(within(toast).getByRole('button', { name: '復原' }));
    await waitFor(() => expect(chipNames()).toEqual(['Fmaj7/C', 'Fm7/C', 'Em7/B']));
  });

  it('shows the key and roman numerals for the example progression', async () => {
    // 同一個測試檔共用假的 IndexedDB：上一個測試存下的進行會被載回來
    render(<App />);
    await screen.findByLabelText('六弦 → 一弦，x 代表悶音');
    const example = screen.queryByRole('button', { name: /載入範例/ });
    if (example) fireEvent.click(example);
    await waitFor(() => expect(document.querySelector('.key-name')?.textContent).toContain('C 大調'));
    expect([...document.querySelectorAll('.chip-roman')].map((e) => e.textContent).slice(0, 3)).toEqual(['IVmaj7', 'ivm7', 'iiim7']);
  });
});
