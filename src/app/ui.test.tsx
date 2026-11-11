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

    // 打和弦名稱加入：Am 選取中，開完整加和弦盤，會插在它後面
    fireEvent.click(screen.getByRole('button', { name: '在這個後面加其他和弦…' }));
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

  it('inserts a chord after the selected one, from the typed palette or from the next-chord ideas', async () => {
    render(<App />);
    await ready();
    clearSection();
    fireEvent.change(screen.getByLabelText('指定調性'), { target: { value: '0-major' } });
    fireEvent.click(screen.getByRole('button', { name: '加入 C' }));
    fireEvent.click(screen.getByRole('button', { name: '取消選取，回到加和弦' }));
    fireEvent.click(screen.getByRole('button', { name: '加入 G' }));
    await waitFor(() => expect(chipNames()).toEqual(['C', 'G']));

    // 選中中間前面的 C，打 Am：插在 C 和 G 中間，並改選到新的 Am
    fireEvent.click(screen.getByRole('button', { name: /第 1 個和弦 C/ }));
    fireEvent.click(screen.getByRole('button', { name: '在這個後面加其他和弦…' }));
    expect(screen.getByRole('button', { name: '← 回到第 1 個和弦' })).toBeTruthy();
    tab('打字／貼上');
    fireEvent.change(screen.getByLabelText('直接輸入和弦名稱'), { target: { value: 'Am' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ Am' }));
    await waitFor(() => expect(chipNames()).toEqual(['C', 'Am', 'G']));
    expect(screen.getByRole('heading', { name: '第 2 個和弦' })).toBeTruthy();

    // 檢視器裡的推薦：再選回 C，按第一個「在此後面插入」，多一個和弦，緊接在 C 後面
    fireEvent.click(screen.getByRole('button', { name: /第 1 個和弦 C/ }));
    const insertBtn = screen.getAllByRole('button', { name: /^在此後面插入 / })[0]!;
    const sym = insertBtn.getAttribute('aria-label')!.replace('在此後面插入 ', '');
    fireEvent.click(insertBtn);
    await waitFor(() => expect(chipNames()).toHaveLength(4));
    expect(chipNames()[1]).toBe(sym);
    expect(chipNames()[0]).toBe('C');
    expect(screen.getByRole('heading', { name: '第 2 個和弦' })).toBeTruthy();
  });

  it('drags a chord block to a new place in the timeline', async () => {
    render(<App />);
    await ready();
    clearSection();
    tab('打字／貼上');
    fireEvent.change(screen.getByLabelText('直接輸入和弦名稱'), { target: { value: 'C、G、Am、F' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ 加入 4 個' }));
    await waitFor(() => expect(chipNames()).toEqual(['C', 'G', 'Am', 'F']));

    const dt = { setData: () => {}, effectAllowed: '', dropEffect: '' };
    const block = (n: number) => screen.getByRole('button', { name: new RegExp(`第 ${n} 個和弦`) });
    // 把第 4 個 F 拖到第 2 個的位置
    fireEvent.dragStart(block(4), { dataTransfer: dt });
    fireEvent.dragOver(block(2), { dataTransfer: dt });
    fireEvent.drop(block(2), { dataTransfer: dt });
    await waitFor(() => expect(chipNames()).toEqual(['C', 'F', 'G', 'Am']));
  });

  it('fills a half-empty bar: a chord after a 2-beat chord gets 2 beats, then back to 4', async () => {
    render(<App />);
    await ready();
    clearSection();
    fireEvent.change(screen.getByLabelText('指定調性'), { target: { value: '0-major' } });
    fireEvent.click(screen.getByRole('button', { name: '加入 C' }));
    const beatsOfBlock = () => [...document.querySelectorAll('.tl-block:not(.tl-add)')].map((b) => b.querySelectorAll('.tl-beat').length);
    expect(beatsOfBlock()).toEqual([4]);

    // C 改成 2 拍，接著加 G：小節還缺 2 拍，G 自動 2 拍
    fireEvent.click(screen.getByRole('button', { name: '少一拍' }));
    fireEvent.click(screen.getByRole('button', { name: '少一拍' }));
    fireEvent.click(screen.getByRole('button', { name: '取消選取，回到加和弦' }));
    fireEvent.click(screen.getByRole('button', { name: '加入 G' }));
    await waitFor(() => expect(beatsOfBlock()).toEqual([2, 2]));

    // 小節滿了，下一個 Am 回到 4 拍
    fireEvent.click(screen.getByRole('button', { name: '取消選取，回到加和弦' }));
    fireEvent.click(screen.getByRole('button', { name: '加入 Am' }));
    await waitFor(() => expect(beatsOfBlock()).toEqual([2, 2, 4]));

    // 從選中的 C 後面插入：前面是 2 拍，插入的也是 2 拍
    fireEvent.click(screen.getByRole('button', { name: /第 1 個和弦 C/ }));
    fireEvent.click(screen.getByRole('button', { name: '在這個後面加其他和弦…' }));
    tab('打字／貼上');
    fireEvent.change(screen.getByLabelText('直接輸入和弦名稱'), { target: { value: 'F' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ F' }));
    await waitFor(() => expect(beatsOfBlock()).toEqual([2, 2, 2, 4]));
  });

  it('changes a selected chord to 2 or 4 beats from the quick bar on the timeline', async () => {
    render(<App />);
    await ready();
    clearSection();
    fireEvent.change(screen.getByLabelText('指定調性'), { target: { value: '0-major' } });
    fireEvent.click(screen.getByRole('button', { name: '加入 C' }));
    const beatCount = () => document.querySelectorAll('.tl-block:not(.tl-add)')[0]?.querySelectorAll('.tl-beat').length;
    expect(beatCount()).toBe(4);
    expect(screen.getByRole('button', { name: '設為 4 拍' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '設為 2 拍' }));
    await waitFor(() => expect(beatCount()).toBe(2));
    expect(screen.getByRole('button', { name: '設為 2 拍' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '設為 4 拍' }));
    await waitFor(() => expect(beatCount()).toBe(4));

    // 沒選中的和弦沒有快捷鍵
    fireEvent.click(screen.getByRole('button', { name: '取消選取，回到加和弦' }));
    expect(screen.queryByRole('button', { name: '設為 2 拍' })).toBeNull();
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
    // 預設用白話標籤；打開「顯示樂理標記」才是級數
    const roles = () => [...document.querySelectorAll('.tl .chip-roman')].map((e) => e.textContent).slice(0, 3);
    expect(roles()).toEqual(['展開', '借來的色彩', '穩']);
    fireEvent.click(screen.getByLabelText(/顯示樂理標記/));
    await waitFor(() => expect(roles()).toEqual(['IVmaj7', 'ivm7', 'iiim7']));
    fireEvent.click(screen.getByLabelText(/顯示樂理標記/));
    await waitFor(() => expect(roles()).toEqual(['展開', '借來的色彩', '穩']));
  });

  it('offers starter progressions on an empty section and in the palette', async () => {
    render(<App />);
    await ready();
    clearSection();
    // 空白段落：換到 G 大調，套用「流行萬用」
    const empty = within(document.querySelector('.arrange .empty') as HTMLElement);
    fireEvent.click(empty.getByRole('button', { name: 'G 大調' }));
    fireEvent.click(empty.getByRole('button', { name: /^用這組流行萬用：G – D – Em – C$/ }));
    await waitFor(() => expect(chipNames()).toEqual(['G', 'D', 'Em', 'C']));
    expect([...document.querySelectorAll('.tl .chip-roman')].map((e) => e.textContent)).toEqual(['家', '想回家', '穩', '展開']);
    expect(document.querySelector('.key-name')?.textContent).toContain('G 大調');
    expect(screen.getByText(/已套用「流行萬用」/)).toBeTruthy();

    // 已有和弦：和弦盤的「常用」分頁也有，會接在後面
    const pal = within(document.querySelector('.palette') as HTMLElement);
    fireEvent.click(pal.getByRole('button', { name: /^加進來三個和弦：G – C – D – C$/ }));
    await waitFor(() => expect(chipNames()).toEqual(['G', 'D', 'Em', 'C', 'G', 'C', 'D', 'C']));
  });

  it('treats a list of note names in the chord box as a melody and fills chords from it', async () => {
    render(<App />);
    await ready();
    clearSection();
    tab('打字／貼上');
    fireEvent.change(screen.getByLabelText('直接輸入和弦名稱'), { target: { value: 'Eb3 B2 E3 F#3 Bb2' } });
    // 以前會把 B2、Bb2 讀成 Bsus2、Bbsus2
    expect(document.querySelector('#chord-search-help')?.textContent).toContain('不是和弦名稱');
    fireEvent.click(screen.getByRole('button', { name: '當旋律，幫我配和弦' }));
    // 五個音、每個一拍 → 兩小節，各配一個和弦；旋律畫在和弦上面
    await waitFor(() => expect(chipNames()).toHaveLength(2));
    expect(chipNames().some((n) => /sus2/.test(n ?? ''))).toBe(false);
    expect(document.querySelectorAll('.tl-note').length).toBeGreaterThanOrEqual(5);
  });

  it('takes typed note names in the sing panel', async () => {
    render(<App />);
    await ready();
    clearSection();
    fireEvent.click(screen.getByRole('button', { name: '唱旋律' }));
    fireEvent.change(screen.getByLabelText('或直接打音名'), { target: { value: 'E4 G4 A4 C5' } });
    fireEvent.click(screen.getByRole('button', { name: '用這些音' }));
    await waitFor(() => expect(document.querySelectorAll('.tl-note').length).toBe(4));
    expect(screen.getByText(/已用 4 個音當旋律/)).toBeTruthy();
  });

  it('harmonizes a typed melody with plain chords from the tonic, and lets you re-key, add colour and swap one bar', async () => {
    try {
      localStorage.removeItem('guitar-idea-pad.harmonyStyle');
    } catch {
      /* 忽略 */
    }
    render(<App />);
    await ready();
    clearSection();
    fireEvent.click(screen.getByRole('button', { name: '唱旋律' }));
    // 小星星
    fireEvent.change(screen.getByLabelText('或直接打音名'), { target: { value: 'C4 C4 G4 G4 A4 A4 G4 G4 F4 F4 E4 E4 D4 D4 C4 C4' } });
    fireEvent.click(screen.getByRole('button', { name: '用這些音' }));
    await waitFor(() => expect(chipNames()).toHaveLength(4));
    expect(chipNames()[0]).toBe('C'); // 以前是 Fadd9
    chipNames().forEach((n) => expect(n).toMatch(/^[A-G][#b♯♭]?m?$/));

    // 多點色彩 → 重新配：出現七和弦或加九
    const re = within(screen.getByRole('group', { name: '依旋律重新配和弦' }));
    fireEvent.click(re.getByRole('button', { name: '多點色彩' }));
    fireEvent.click(re.getByRole('button', { name: '重新配' }));
    await waitFor(() => expect(chipNames().some((n) => /7|add9/.test(n ?? ''))).toBe(true));

    // 換成別的調重新配
    fireEvent.click(re.getByRole('button', { name: '簡單和弦' }));
    fireEvent.change(re.getByLabelText('用其他調重新配'), { target: { value: '9-minor' } });
    await waitFor(() => expect(screen.getByText(/已用 A 小調 依旋律重新配了 4 小節/)).toBeTruthy());
    expect(re.getByRole('button', { name: 'A 小調' })).toHaveProperty('ariaPressed', 'true');
    chipNames().forEach((n) => expect(n).toMatch(/^[A-G][#b♯♭]?m?$/));

    // 點一個和弦 → 換一個：只換那一格
    const before = chipNames();
    fireEvent.click(screen.getByRole('button', { name: /^第 1 個和弦/ }));
    fireEvent.click(await screen.findByRole('button', { name: /第 1 個和弦換一個/ }));
    await waitFor(() => expect(chipNames()[0]).not.toBe(before[0]));
    expect(chipNames().slice(1)).toEqual(before.slice(1));
  });

  it('lets you sing before there are any chords', async () => {
    render(<App />);
    await ready();
    clearSection();
    fireEvent.click(screen.getByRole('button', { name: '唱旋律' }));
    // 預設是自由哼；切到「跟節拍器」才要選唱幾小節
    expect(screen.getByRole('button', { name: /開始哼/ })).toHaveProperty('disabled', false);
    fireEvent.click(screen.getByRole('button', { name: '跟節拍器' }));
    expect(screen.getByText(/這段還沒有和弦：只放節拍器/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /開始唱/ })).toHaveProperty('disabled', false);
    expect(screen.getByLabelText('唱幾小節')).toHaveProperty('value', '4');
  });
});
