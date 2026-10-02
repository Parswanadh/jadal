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
  /**
   * One word for what this control does, shown in the stepped heading and on the
   * starting button (e.g. "Reject"). Without it the first click is a silent
   * state change and the user cannot tell they are being asked to confirm.
   */
  action?: string;
}

/**
 * A button that asks "are you sure?" right where it sits, instead of opening a dialog.
 *
 * The control is deliberately two-step: the first click only *arms* it, and the
 * action happens on the second (confirm) click. Because that first click changes
 * nothing visible in the rest of the page, the asking state has to be unmistakable
 * on its own:
 *
 *  * the panel is announced as a `role="alertdialog"` and focused, so a screen
 *    reader reads the question instead of silently swapping a button;
 *  * a numbered heading names the step ("Reject: step 1 of 2", "step 2 of 2"), so
 *    a coordinator can see they are mid-confirmation and not looking at a no-op;
 *  * the confirm button leads the panel, focused and filled, and the dismiss
 *    button is plainly labelled Cancel.
 *
 * Confirm and Cancel both stay visible while the request is in flight; the panel
 * only closes once `onConfirm` settles, so the control never disappears out from
 * under a click that is still being processed.
 */
export default function ConfirmAction({ label, question, confirmLabel, onConfirm, variant = 'default', disabled, action }: ConfirmActionProps) {
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
      <button
        type="button"
        className={`btn btn-${variant}`}
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => setAsking(true)}
      >
        {/* The label is what the coordinator is about to do; the marker says a
            question follows rather than the deed itself. */}
        <span className="btn-step" aria-hidden="true">
          ?
        </span>
        {label}
      </button>
    );
  }

  /** "Reject: step 1 of 2" — the whole reason the panel is unmistakable. */
  const stepHeading = t('common.connect.confirmStep', {
    action: action ?? label,
    step: t('common.connect.confirmArmed'),
  });

  return (
    <div
      className="confirm-inline"
      role="alertdialog"
      aria-modal="false"
      aria-label={t('common.connect.confirmAsking', { question })}
    >
      <p className="confirm-question">
        <span className="confirm-step">{stepHeading}</span>
        {question}
      </p>
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
      <p className="confirm-step confirm-step-next">{t('common.connect.confirmConfirm')}</p>
    </div>
  );
}
