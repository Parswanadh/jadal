import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { AlertChannel, AlertSeverity, Allocation } from '../api/extra';
import { useI18n } from '../i18n/I18nContext';
import { useFormat } from '../lib/useFormat';
import { api } from './api';
import { alertDeliveryState } from './alertDelivery';
import './alert.css';

const CHANNELS: AlertChannel[] = ['call', 'sms', 'whatsapp'];
const SEVERITIES: AlertSeverity[] = ['info', 'warning', 'urgent', 'emergency'];

interface Props {
  farmerId: string;
  farmerName: string;
}

interface SentResult {
  channel: AlertChannel;
  severity: AlertSeverity;
  simulated: boolean;
  detail: string;
  /**
   * The handset the API says it actually rang, or null when no call was placed.
   *
   * Never the farmer's stored number: a demo mapping can redirect a call to a
   * different handset (see `forwardTargetForFarmer` on the API side), so the
   * only honest source for "where did this go" is what the API reports.
   */
  dialled: string | null;
  /** The allocation the alert carried, when it carried one. */
  allocation: Allocation | null;
}

/**
 * Reach one farmer by call, SMS or WhatsApp, at a chosen warning level.
 *
 * When the API has an approved allocation for the farmer — the volume the
 * coordinator granted and the turn window it belongs to — the control offers to
 * include it, so the call tells the farmer how much water they have and when to
 * use it. Both figures are read from the API; this control never derives them.
 *
 * The result is reported exactly as the API returns it: when `simulated` is
 * true the control says so plainly and never implies a real call or message.
 */
export default function AlertControl({ farmerId, farmerName }: Props) {
  const { t } = useI18n();
  const f = useFormat();
  const uid = useId();
  const [channel, setChannel] = useState<AlertChannel>('call');
  const [severity, setSeverity] = useState<AlertSeverity>('info');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SentResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [allocationReady, setAllocationReady] = useState(false);
  const [withAllocation, setWithAllocation] = useState(false);

  // Read the farmer's allocation from the API whenever the control opens.
  // Without one the block explains why and stays out of the way.
  useEffect(() => {
    let cancelled = false;
    setAllocationReady(false);
    setAllocation(null);
    setWithAllocation(false);
    api
      .allocationFor(farmerId)
      .then((found) => {
        if (cancelled) return;
        setAllocation(found);
        // Offer it by default: telling the farmer their allocation is the point.
        setWithAllocation(found !== null);
      })
      .catch(() => {
        if (!cancelled) setAllocation(null);
      })
      .finally(() => {
        if (!cancelled) setAllocationReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [farmerId]);

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const sending = withAllocation && allocation ? allocation : undefined;
      const res = await api.sendAlert(farmerId, channel, severity, message, sending);
      setResult({
        channel,
        severity,
        simulated: res.simulated,
        detail: res.detail,
        dialled: res.dialled ?? null,
        allocation: sending ?? null,
      });
    } catch (error) {
      // The API's own reason, not a generic line: an alert that did not leave must
      // say why, the same way a refused decision does.
      setFailure(error instanceof Error && error.message.trim() ? error.message : null);
    } finally {
      setBusy(false);
    }
  }

  const canSend = !busy && (!withAllocation || allocation !== null);

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
          <span className="field-label" id={`${uid}-severity`}>
            {t('coord.alert.severityLabel')}
          </span>
          <div className="segmented segmented-wrap" role="group" aria-labelledby={`${uid}-severity`}>
            {SEVERITIES.map((option) => (
              <button
                key={option}
                type="button"
                className="segment"
                aria-pressed={severity === option}
                onClick={() => setSeverity(option)}
              >
                {t(`coord.alert.severity.${option}`)}
              </button>
            ))}
          </div>
        </div>

        <AllocationField
          uid={uid}
          ready={allocationReady}
          allocation={allocation}
          checked={withAllocation}
          onToggle={setWithAllocation}
          summary={(a) =>
            t('coord.alert.allocationSummary', { m3: f.m3(a.volume_m3), when: f.range(a.start, a.end) })
          }
        />

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
          <button type="submit" className="btn" disabled={!canSend}>
            {busy
              ? t('coord.alert.sending')
              : withAllocation && allocation
                ? t('coord.alert.allocationSend')
                : t('coord.alert.send')}
          </button>
        </div>

        {failure !== null && (
          <div className="notice notice-crit" role="alert">
            <p>{t('coord.alert.error')}</p>
            {failure && <p className="alert-reason">{failure}</p>}
          </div>
        )}

        {result && (
          /*
           * The channel decides the wording first (see `alertDeliveryState`).
           * `sms`/`whatsapp` have no transport in this app, so they are always
           * reported as "not sent" — never as sent, and not as a simulated
           * call either. Only a `call` can be sent or simulated.
           */
          (() => {
            const state = alertDeliveryState(result.channel, result.simulated);
            const channel = t(`coord.alert.channel.${result.channel}`);
            const severity = t(`coord.alert.severity.${result.severity}`);
            return (
              <div className={`notice ${state === 'sent' ? 'notice-ok' : 'notice-warn'}`} role="status">
                <p>
                  {state === 'not-sent'
                    ? t('coord.alert.notSent', { channel, severity, detail: result.detail })
                    : state === 'simulated'
                      ? t('coord.alert.simulated', { channel, severity, detail: result.detail })
                      : t('coord.alert.sent', { channel, severity })}
                </p>
                {/* Where it actually went, in the API's own words. A demo mapping can
                    redirect a call to a different handset, so the farmer's stored
                    number is not an honest answer to "where did this go". A simulated
                    call says plainly that no number was rung; a not-sent message says
                    nothing about calls at all because none was attempted. */}
                {state === 'simulated' && <p className="alert-dialled">{t('coord.alert.dialledNone')}</p>}
                {state === 'sent' && result.dialled !== null && result.dialled.trim().length > 0 && (
                  <p className="alert-dialled">{t('coord.alert.dialled', { number: result.dialled })}</p>
                )}
                {result.allocation && (
                  <p>
                    {t('coord.alert.allocationSent', {
                      name: farmerName,
                      m3: f.m3(result.allocation.volume_m3),
                      when: f.range(result.allocation.start, result.allocation.end),
                    })}
                  </p>
                )}
              </div>
            );
          })()
        )}
      </form>
    </details>
  );
}

interface AllocationFieldProps {
  uid: string;
  ready: boolean;
  allocation: Allocation | null;
  checked: boolean;
  onToggle: (next: boolean) => void;
  summary: (allocation: Allocation) => string;
}

/**
 * The allocation half of the alert: a single opt-in line with the volume and the
 * window the API reported, or an explanation when the farmer has none yet.
 */
function AllocationField({ uid, ready, allocation, checked, onToggle, summary }: AllocationFieldProps) {
  const { t } = useI18n();

  if (!ready) {
    return (
      <p className="field-hint" role="status">
        {t('coord.alert.allocationUnavailable')}
      </p>
    );
  }

  if (!allocation) {
    return (
      <div className="field">
        <span className="field-label">{t('coord.alert.allocationLabel')}</span>
        <p className="field-hint">{t('coord.alert.allocationNone')}</p>
      </div>
    );
  }

  return (
    <div className="field">
      <span className="field-label">{t('coord.alert.allocationLabel')}</span>
      <label className="choice choice-compact" htmlFor={`${uid}-allocation`}>
        <input
          id={`${uid}-allocation`}
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span>
          <strong>{t('coord.alert.allocationOn')}</strong>
          <span className="muted small">{summary(allocation)}</span>
        </span>
      </label>
      <p className="field-hint">{t('coord.alert.allocationHelp')}</p>
    </div>
  );
}
