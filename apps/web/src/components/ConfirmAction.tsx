import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';

interface ConfirmActionProps {
  /** Text of the button that starts the action. */
  label: string;
  /** The question shown inline before anything happens. */
  question: string;
  /** Text of the button that carries the action out. */
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  variant?: 'primary' | 'danger' | 'default';
  disabled?: boolean;
}

/** A button that asks "are you sure?" right where it sits, instead of opening a dialog. */
export default function ConfirmAction({ label, question, confirmLabel, onConfirm, variant = 'default', disabled }: ConfirmActionProps) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
  }, [asking]);

  async function run(): Promise<void> {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  if (!asking) {
    return (
      <button type="button" className={`btn btn-${variant}`} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className="confirm-inline" role="group" aria-label={question}>
      <p className="confirm-question">{question}</p>
      <div className="confirm-buttons">
        <button
          ref={confirmRef}
          type="button"
          className={`btn btn-${variant === 'default' ? 'primary' : variant}`}
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? t('common.working') : confirmLabel}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => setAsking(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
