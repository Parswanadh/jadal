import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { AlertChannel } from '../api/extra';
import { useI18n } from '../i18n/I18nContext';
import { api } from './api';
import './alert.css';

const CHANNELS: AlertChannel[] = ['call', 'sms', 'whatsapp'];

interface Props {
  farmerId: string;
  farmerName: string;
}

interface SentResult {
  channel: AlertChannel;
  simulated: boolean;
  detail: string;
}

/**
 * Reach one farmer by call, SMS or WhatsApp.
 *
 * The result is reported exactly as the API returns it: when `simulated` is
 * true the control says so plainly and never implies a real call or message.
 */
export default function AlertControl({ farmerId, farmerName }: Props) {
  const { t } = useI18n();
  const uid = useId();
  const [channel, setChannel] = useState<AlertChannel>('call');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SentResult | null>(null);
  const [failed, setFailed] = useState(false);

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      const res = await api.sendAlert(farmerId, channel, message);
      setResult({ channel, simulated: res.simulated, detail: res.detail });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="alert-control">
      <summary>{t('coord.alert.title')}</summary>
      <form className="alert-form" onSubmit={(event) => void send(event)}>
        <p className="muted small">{farmerName}</p>

        <div className="field">
          <span className="field-label" id={`${uid}-channel`}>
            {t('coord.alert.channelLabel')}
          </span>
          <div className="segmented" role="group" aria-labelledby={`${uid}-channel`}>
            {CHANNELS.map((option) => (
              <button
                key={option}
                type="button"
                className="segment"
                aria-pressed={channel === option}
                onClick={() => setChannel(option)}
              >
                {t(`coord.alert.channel.${option}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor={`${uid}-message`}>{t('coord.alert.messageLabel')}</label>
          <textarea
            id={`${uid}-message`}
            rows={2}
            value={message}
            placeholder={t('coord.alert.messageHint')}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>

        <div className="btn-row">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? t('coord.alert.sending') : t('coord.alert.send')}
          </button>
        </div>

        {failed && (
          <div className="notice notice-crit" role="alert">
            <p>{t('coord.alert.error')}</p>
          </div>
        )}

        {result && (
          <div className={`notice ${result.simulated ? 'notice-warn' : 'notice-ok'}`} role="status">
            <p>
              {result.simulated
                ? t('coord.alert.simulated', {
                    channel: t(`coord.alert.channel.${result.channel}`),
                    detail: result.detail,
                  })
                : t('coord.alert.sent', { channel: t(`coord.alert.channel.${result.channel}`) })}
            </p>
          </div>
        )}
      </form>
    </details>
  );
}
