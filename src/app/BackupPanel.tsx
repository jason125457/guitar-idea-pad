import { useEffect, useRef, useState } from 'react';
import {
  MAX_BACKUP_BYTES,
  backupFileName,
  createBackup,
  parseBackup,
  planImport,
  serializeBackup,
  type Idea,
} from '../core';

const LAST_BACKUP_KEY = 'guitar-idea-pad.lastBackup';

function readLastBackup(): number | undefined {
  try {
    const v = Number(localStorage.getItem(LAST_BACKUP_KEY));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const fmt = (t: number) =>
  new Date(t).toLocaleString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

interface Props {
  ideas: Idea[];
  current: Idea;
  onImport: (ideas: Idea[]) => void;
}

type Notice = { kind: 'ok' | 'err'; text: string } | undefined;

export function BackupPanel({ ideas, current, onImport }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice>();
  const [lastBackup, setLastBackup] = useState<number | undefined>(readLastBackup);
  const [persisted, setPersisted] = useState<boolean | undefined>();

  // 請瀏覽器把資料標成「持久」，降低空間不足時被自動清掉的機會（不能防止使用者手動清除）
  useEffect(() => {
    const s = navigator.storage;
    if (!s?.persisted) return;
    void s
      .persisted()
      .then((p) => (p ? true : s.persist ? s.persist() : false))
      .then(setPersisted)
      .catch(() => setPersisted(undefined));
  }, []);

  const doExport = (scope: 'all' | 'current') => {
    const list = scope === 'all' ? ideas : [current];
    const now = new Date();
    download(
      backupFileName(now, scope === 'all' ? undefined : current.title),
      serializeBackup(createBackup(list, now.getTime())),
    );
    const t = now.getTime();
    setLastBackup(t);
    try {
      localStorage.setItem(LAST_BACKUP_KEY, String(t));
    } catch {
      /* 忽略 */
    }
    setNotice({ kind: 'ok', text: `已下載 ${list.length} 個靈感的備份檔，請收好這個檔案（雲端硬碟或寄給自己都可以）` });
  };

  const doImport = async (file: File) => {
    if (file.size > MAX_BACKUP_BYTES) {
      setNotice({ kind: 'err', text: '檔案太大，不像是靈感備份檔' });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setNotice({ kind: 'err', text: '讀不到這個檔案，請再試一次' });
      return;
    }
    const r = parseBackup(text);
    if (!r.ok) {
      setNotice({ kind: 'err', text: r.error });
      return;
    }
    const plan = planImport(ideas, r.ideas);
    onImport(plan.add);
    const added = plan.add.length - plan.copied;
    const parts = [`新增 ${added} 個`];
    if (plan.copied) parts.push(`${plan.copied} 個與本機的同一個靈感內容不同，已另存為「（匯入）」複本`);
    if (plan.identical) parts.push(`${plan.identical} 個已經在本機，略過`);
    if (r.skipped) parts.push(`${r.skipped} 個資料損壞，無法匯入`);
    setNotice({
      kind: plan.add.length === 0 && r.skipped > 0 ? 'err' : 'ok',
      text: plan.add.length === 0 && !r.skipped ? '備份檔裡的靈感都已經在本機了，沒有需要匯入的' : `匯入完成：${parts.join('；')}`,
    });
  };

  return (
    <details className="backup panel">
      <summary>備份與還原</summary>
      <p className="help">
        靈感只存在這台裝置的瀏覽器裡。清除網站資料、換手機或換瀏覽器前，請先匯出備份檔。
      </p>
      <div className="row wrap">
        <button type="button" className="btn btn-primary" onClick={() => doExport('all')}>
          匯出全部（{ideas.length}）
        </button>
        <button type="button" className="btn" onClick={() => doExport('current')}>
          只匯出「{current.title.length > 10 ? `${current.title.slice(0, 10)}…` : current.title}」
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          匯入備份檔
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-label="選擇備份檔"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ''; // 允許再次選同一個檔案
            if (f) void doImport(f);
          }}
        />
      </div>
      <p className="help" role="status">
        {lastBackup ? `上次備份：${fmt(lastBackup)}` : '還沒有備份過'}
        {persisted === true && ' · 瀏覽器已同意保留這份資料'}
        {persisted === false && ' · 瀏覽器沒有承諾保留資料，更需要定期備份'}
      </p>
      {notice && (
        <p className={`notice ${notice.kind}`} role={notice.kind === 'err' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
      <p className="help">匯入不會覆蓋任何現有靈感：重複的會略過，內容不同的會另存成複本。</p>
    </details>
  );
}
