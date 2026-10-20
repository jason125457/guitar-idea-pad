import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  clearOfflineCache,
  downloadSample,
  formatBytes,
  getOfflineStatus,
  onPrecached,
  type OfflineStatus,
} from '../audio/offline';
import {
  SAMPLE_TIMBRES,
  TIMBRES,
  getSoundState,
  loadSamples,
  setTimbre,
  subscribe,
  type SampleTimbre,
  type Timbre,
} from '../audio/sound';

const name = (t: Timbre) => TIMBRES.find((x) => x.id === t)?.name ?? t;

export function SoundPanel() {
  const sound = useSyncExternalStore(subscribe, getSoundState);
  const [offline, setOffline] = useState<OfflineStatus | undefined>();
  const [busy, setBusy] = useState<SampleTimbre | undefined>();
  const [progress, setProgress] = useState<{ loaded: number; total: number } | undefined>();
  const [message, setMessage] = useState('');

  const refresh = useCallback(() => void getOfflineStatus().then(setOffline).catch(() => undefined), []);

  useEffect(() => {
    refresh();
    return onPrecached(() => refresh());
  }, [refresh]);

  // 取樣載入完成（可能剛被 service worker 存進快取）後更新狀態
  useEffect(() => {
    refresh();
  }, [sound.samples.steel.status, sound.samples.nylon.status, refresh]);

  const download = async (t: SampleTimbre) => {
    setBusy(t);
    setMessage('');
    setProgress({ loaded: 0, total: 0 });
    try {
      const stored = await downloadSample(t, (loaded, total) => setProgress({ loaded, total }));
      void loadSamples(t);
      setMessage(
        stored
          ? `${name(t)}已存進這台裝置，之後沒有網路也能播放`
          : offline?.mode === 'ready'
            ? `${name(t)}已下載，但瀏覽器沒有把它保存起來（可能儲存空間不足）`
            : `${name(t)}已下載`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '下載失敗，請檢查網路後再試');
    } finally {
      setBusy(undefined);
      setProgress(undefined);
      refresh();
    }
  };

  const clear = async () => {
    await clearOfflineCache();
    setMessage('已清除離線快取（網頁與音色需要重新下載才能離線使用）');
    refresh();
  };

  const selected = sound.timbre;
  const sel = selected === 'synth' ? undefined : sound.samples[selected];

  const status = (): string => {
    if (selected === 'synth') return '使用內建合成音色。';
    if (!sel) return '';
    switch (sel.status) {
      case 'loading':
        return sel.total ? `${name(selected)}載入中… ${sel.loaded}/${sel.total}（載入完成前先用合成音色）` : `${name(selected)}載入中…（先用合成音色）`;
      case 'ready':
        return `${name(selected)}已就緒。`;
      case 'error':
        return `${name(selected)}載入失敗：${sel.error ?? '未知原因'}。目前改用合成音色。`;
      default:
        return `${name(selected)}尚未載入。`;
    }
  };

  return (
    <details className="sound panel">
      <summary>音色與離線</summary>

      <fieldset className="timbres">
        <legend className="field">試聽和弦的音色</legend>
        {TIMBRES.map((t) => (
          <label key={t.id} className={`timbre ${selected === t.id ? 'is-on' : ''}`}>
            <input type="radio" name="timbre" value={t.id} checked={selected === t.id} onChange={() => setTimbre(t.id)} />
            <span className="timbre-name">{t.name}</span>
            <span className="timbre-hint">{t.hint}</span>
          </label>
        ))}
      </fieldset>
      <p className="help" role="status">{status()}</p>
      {sel?.status === 'error' && (
        <button type="button" className="btn btn-sm" onClick={() => void loadSamples(selected as SampleTimbre)}>重試載入</button>
      )}
      <p className="help">旋律試聽固定用簡單的合成音，才能和吉他和弦分得出來。</p>

      <h3>離線使用</h3>
      {offline?.mode === 'dev' && (
        <p className="help">開發模式不啟用離線快取。執行 <span className="mono">npm run build</span> 再 <span className="mono">npm run preview</span> 就能測試。</p>
      )}
      {offline?.mode === 'unsupported' && (
        <p className="help">這個瀏覽器或網址不支援離線快取（需要 HTTPS 或 localhost）。</p>
      )}
      {offline?.mode === 'ready' && (
        <>
          <ul className="offline-list">
            <li>
              <span>網頁本體</span>
              <span className={offline.app ? 'ok-text' : 'muted-text'}>{offline.app ? '已存進這台裝置' : '準備中…（載入完成後會自動存）'}</span>
            </li>
            {SAMPLE_TIMBRES.map((t) => (
              <li key={t}>
                <span>{name(t)}</span>
                {offline.samples[t] ? (
                  <span className="ok-text">已可離線使用</span>
                ) : (
                  <button type="button" className="btn btn-sm" disabled={busy !== undefined} onClick={() => void download(t)}>
                    {busy === t
                      ? progress?.total
                        ? `下載中 ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
                        : '下載中…'
                      : '下載供離線使用（約 2 MB）'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void clear()}>清除離線快取</button>
        </>
      )}
      {message && <p className="notice" role="status">{message}</p>}

      <p className="help credit">
        吉他取樣來自 FluidR3_GM 音色庫（作者 Frank Wen，經 gleitz/midi-js-soundfonts 轉為網頁格式），
        以 <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a> 授權。
      </p>
    </details>
  );
}
