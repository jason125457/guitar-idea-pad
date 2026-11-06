import { useEffect, useState } from 'react';

/** 破壞性操作要點兩次：第一次變成「確定？」，4 秒內沒按就還原。 */
export function ConfirmButton({ label, confirmLabel, onConfirm, ariaLabel, className = 'btn btn-sm btn-ghost' }: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  ariaLabel: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className} ${armed ? 'is-danger' : ''}`}
      aria-label={armed ? `${confirmLabel}：${ariaLabel}` : ariaLabel}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
