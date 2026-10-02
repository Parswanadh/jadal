import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { fetchAgentReply } from './api';
import { CALLER_ID, CALLER_ID_TE, detectCapabilities, toAudioDataUrl } from './helpers';
import './SimulatedPhone.css';
import './AgentCall.css';

interface Props {
  /** The contact the outbound call created (from the alert response). */
  contactId: string;
  farmerName: string;
  /** True when nothing really left the device. */
  simulated: boolean;
  detail: string;
}

interface Reply {
  te: string;
  en: string;
  audio?: string;
}

/**
 * The agent's side of an outbound call, in the phone frame.
 *
 * It reads the reply the call carries and speaks it in Telugu, falling back to
 * the written transcript and a play control where speech is unavailable. When
 * the call is simulated the panel says so plainly.
 */
export default function AgentCall({ contactId, farmerName, simulated, detail }: Props) {
  const { t, lang } = useI18n();
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const caps = detectCapabilities();

  useEffect(() => {
    let cancelled = false;
    setReply(null);
    setError(false);
    setSpeaking(false);
    fetchAgentReply(contactId)
      .then((res) => {
        if (!cancelled) setReply({ te: res.reply_te, en: res.reply_en, audio: res.audio_base64 });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  function speakReply(): void {
    if (!reply || !caps.speechSynthesis) return;
    try {
      const utter = new SpeechSynthesisUtterance(reply.te);
      utter.lang = 'te-IN';
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
      setSpeaking(true);
    } catch {
      setSpeaking(false);
    }
  }

  // Speech is user-initiated only. The agent's reply is shown as text (and plays
  // its real Sarvam audio when the API returns one); the browser voice is a
  // fallback the user asks for, never something that fires on its own. Auto-
  // speaking hijacked the screen the moment a request was raised, which is not
  // what "raise a request" should do.

  return (
    <section className="agent-call jadal-phone" aria-labelledby={`agent-call-${contactId}`}>
      <div className="jadal-phone__bar">
        <span id={`agent-call-${contactId}`}>{t('phone.agentCallTitle')}</span>
      </div>
      <div className="jadal-phone__screen">
        <div className="jadal-phone__status-row">
          <strong>{lang === 'te' ? CALLER_ID_TE : CALLER_ID}</strong>
        </div>
        <p className="jadal-phone__hint">{t('phone.agentCallLead')}</p>
        <p className="muted small">{farmerName}</p>

        {!reply && !error && (
          <p className="jadal-phone__hint" role="status">
            {t('common.loading')}
          </p>
        )}
        {error && (
          <p className="jadal-phone__error" role="alert">
            {t('phone.agentCallError')}
          </p>
        )}

        {reply && (
          <>
            <ul className="jadal-phone__transcript" aria-live="polite">
              <li className="jadal-phone__turn jadal-phone__turn--agent">
                <div className="jadal-phone__turn-meta">{t('phone.agent')}</div>
                {/* The agent speaks Telugu, so the spoken line is always shown;
                    an English translation follows when the screen is English. */}
                <div>{reply.te}</div>
                {lang !== 'te' && <div className="muted small">{reply.en}</div>}
              </li>
            </ul>

            {caps.speechSynthesis ? (
              <button type="button" className="jadal-phone__send" onClick={speakReply} disabled={speaking}>
                {speaking ? t('phone.agentCallSpeaking') : t('phone.agentCallPlay')}
              </button>
            ) : (
              <>
                {reply.audio && (
                  <audio className="jadal-phone__audio" src={toAudioDataUrl(reply.audio)} controls aria-label={t('phone.agentCallPlay')} />
                )}
                <p className="jadal-phone__hint">{t('phone.agentCallNoSpeech')}</p>
              </>
            )}

            {simulated && (
              <p className="jadal-phone__hint">
                {t('phone.agentCallSimulated')} {detail}
              </p>
            )}

            <Link className="btn" to={`/phone?contact=${encodeURIComponent(contactId)}`}>
              {t('phone.agentCallOpen')}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
