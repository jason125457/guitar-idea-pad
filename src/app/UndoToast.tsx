import { useEffect, useRef, useState } from 'react';

interface Props {
  message: string;
  onUndo: () => void;
  onClose: () => void;
  /** 自動消失的時間；滑鼠移上去或鍵盤聚焦時暫停計時，讓人來得及按「復原」 */
  timeoutMs?: number;
}

/** 刪除／清空之後出現的「復原」提示：不搶焦點，用 aria-live 告知螢幕閱讀器。 */
export function UndoToast({ message, onUndo, onClose, timeoutMs = 6000 }: Props) {
  const [paused, setPaused] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => closeRef.current(), timeoutMs);
    return () => window.clearTimeout(t);
  }, [paused, timeoutMs, message]);

  return (
    <div
      className="toast"
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast-msg">{message}</span>
      <button type="button" className="btn btn-sm toast-undo" onClick={onUndo}>
        復原
      </button>
      <button type="button" className="toast-x" aria-label="關閉提示" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
