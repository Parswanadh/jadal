import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import PageHeader from "../components/PageHeader";
import "./SimulatedPhone.css";
import { fetchContacts, postPhoneReply } from "./api";
import {
  CALLER_ID,
  CALLER_ID_TE,
  MOCK_CALLER_NUMBER,
  ackLabel,
  ackTone,
  detectCapabilities,
  fileToBase64,
  formatTime,
  toAudioDataUrl,
  type ContactStatus,
  type PhoneContact,
  type TranscriptTurn,
} from "./helpers";

type CallPhase = "ringing" | "active" | "ended";
type UiLang = "te" | "en";

interface UiStrings {
  incoming: string;
  accept: string;
  decline: string;
  callEnded: string;
  callActive: string;
  playAnnouncement: string;
  replay: string;
  replyPlaceholder: string;
  send: string;
  sending: string;
  uploadVoice: string;
  micNote: string;
  transcript: string;
  ackState: string;
  whatsapp: string;
  whatsappTitle: string;
  close: string;
  markAck: string;
  liveOn: string;
  sourceApi: string;
  sourceMock: string;
  farmerYou: string;
  committee: string;
  agent: string;
  noAudio: string;
  declined: string;
  callBack: string;
  clipReady: string;
}

const STRINGS: Record<UiLang, UiStrings> = {
  en: {
    incoming: "Incoming call",
    accept: "Accept",
    decline: "Decline",
    callEnded: "Call ended",
    callActive: "Call in progress",
    playAnnouncement: "Play announcement",
    replay: "Replay announcement",
    replyPlaceholder: "Type your reply (Telugu or English)…",
    send: "Send reply",
    sending: "Sending…",
    uploadVoice: "Upload voice clip",
    micNote: "Microphone recording is not available in this browser — please upload a voice clip instead.",
    transcript: "Transcript",
    ackState: "Acknowledgement",
    whatsapp: "WhatsApp alerts",
    whatsappTitle: "Night-release alerts",
    close: "Close",
    markAck: "Acknowledge",
    liveOn: "Live",
    sourceApi: "Live data (API)",
    sourceMock: "Demo data (offline mock)",
    farmerYou: "You (farmer)",
    committee: "Water Committee",
    agent: "Jadal agent",
    noAudio: "Audio announcement unavailable.",
    declined: "You declined the call. The committee will retry on WhatsApp.",
    callBack: "Call back",
    clipReady: "Voice clip ready",
  },
  te: {
    incoming: "వస్తున్న కాల్",
    accept: "స్వీకరించు",
    decline: "తిరస్కరించు",
    callEnded: "కాల్ ముగిసింది",
    callActive: "కాల్ జరుగుతోంది",
    playAnnouncement: "ప్రకటన వినండి",
    replay: "మళ్లీ వినండి",
    replyPlaceholder: "మీ సమాధానం రాయండి (తెలుగు లేదా ఇంగ్లీష్)…",
    send: "పంపించు",
    sending: "పంపుతోంది…",
    uploadVoice: "వాయిస్ క్లిప్ అప్‌లోడ్",
    micNote: "ఈ బ్రౌజర్‌లో మైక్ రికార్డింగ్ లేదు — దయచేసి వాయిస్ క్లిప్ అప్‌లోడ్ చేయండి.",
    transcript: "సంభాషణ",
    ackState: "ధృవీకరణ స్థితి",
    whatsapp: "వాట్సాప్ హెచ్చరికలు",
    whatsappTitle: "రాత్రి విడుదల హెచ్చరికలు",
    close: "మూసివేయి",
    markAck: "ధృవీకరించు",
    liveOn: "ప్రత్యక్షం",
    sourceApi: "ప్రత్యక్ష డేటా (API)",
    sourceMock: "డెమో డేటా (ఆఫ్‌లైన్)",
    farmerYou: "మీరు (రైతు)",
    committee: "నీటి కమిటీ",
    agent: "జడల్ ఏజెంట్",
    noAudio: "ఆడియో ప్రకటన అందుబాటులో లేదు.",
    declined: "మీరు కాల్ తిరస్కరించారు. కమిటీ వాట్సాప్‌లో మళ్లీ ప్రయత్నిస్తుంది.",
    callBack: "తిరిగి కాల్ చేయి",
    clipReady: "వాయిస్ క్లిప్ సిద్ధం",
  },
};

function pickVoiceContact(contacts: PhoneContact[]): PhoneContact | null {
  const voice = contacts.find((c) => c.channel === "voice");
  return voice ?? contacts[0] ?? null;
}

function pickWhatsApp(contacts: PhoneContact[]): PhoneContact[] {
  return contacts.filter((c) => c.channel === "whatsapp");
}

export default function SimulatedPhone() {
  const [phase, setPhase] = useState<CallPhase>("ringing");
  const { lang, t: tr } = useI18n();
  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [source, setSource] = useState<"api" | "mock">("mock");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [replyText, setReplyText] = useState("");
  const [clipName, setClipName] = useState<string | null>(null);
  const [clipBase64, setClipBase64] = useState<string | null>(null);
  const [clipMime, setClipMime] = useState<string>("audio/webm");
  const [sending, setSending] = useState(false);
  const [ack, setAck] = useState<ContactStatus>("delivered");
  const [ttsUrl, setTtsUrl] = useState<string | null>(null);
  const [ttsSimulated, setTtsSimulated] = useState(true);
  const [played, setPlayed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileId = useId();
  const t = STRINGS[lang];

  const voiceContact = pickVoiceContact(contacts);
  const waAlerts = pickWhatsApp(contacts);
  const caps = detectCapabilities();

  const acceptCall = async (): Promise<void> => {
    setPhase("active");
    setLoading(true);
    setError(null);
    setAnnounce(t.callActive);
    try {
      const { contacts: fetched, source: src } = await fetchContacts();
      setContacts(fetched);
      setSource(src);
      const voice = pickVoiceContact(fetched);
      if (voice) {
        setAck(voice.status);
        setTurns([
          {
            id: `${voice.id}-committee`,
            from: "committee",
            text_te: voice.message_te,
            text_en: voice.message_en,
            at: voice.at,
          },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Speak the committee message in Telugu when it arrives (feature-detected),
  // so the demo works even where the TTS audio payload is only a tone.
  useEffect(() => {
    if (phase !== "active" || turns.length === 0 || !caps.speechSynthesis) {
      return;
    }
    try {
      const first = turns[0];
      if (!first) return;
      const utter = new SpeechSynthesisUtterance(first.text_te);
      utter.lang = "te-IN";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch {
      // Speech synthesis is best-effort; the audio element is the fallback.
    }
    // Run once per call acceptance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, contacts.length]);

  const playAnnouncement = (): void => {
    if (audioRef.current) {
      void audioRef.current.play().catch(() => {
        setError(t.noAudio);
      });
      setPlayed(true);
    } else {
      setError(t.noAudio);
    }
  };

  const handleClipFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setClipName(file.name);
    setClipMime(file.type || "audio/webm");
    try {
      const b64 = await fileToBase64(file);
      setClipBase64(b64);
    } catch {
      setError(t.noAudio);
    }
  };

  const sendReply = async (): Promise<void> => {
    if (!voiceContact) return;
    if (!replyText.trim() && !clipBase64) return;
    setSending(true);
    setError(null);
    const farmerTurn: TranscriptTurn = {
      id: `farmer-${Date.now()}`,
      from: "farmer",
      text_te: clipBase64 ? `🎙️ ${clipName ?? ""}` : replyText.trim(),
      text_en: clipBase64
        ? `Voice clip: ${clipName ?? "upload"}`
        : replyText.trim(),
      at: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, farmerTurn]);
    try {
      const { result, source: src } = await postPhoneReply(voiceContact, {
        text: replyText.trim() || undefined,
        audio_base64: clipBase64 ?? undefined,
        mime: clipBase64 ? clipMime : undefined,
      });
      setSource(src);
      setAck(result.contact.status);
      if (result.audio_base64) {
        const looksWav = result.audio_base64.startsWith("UklGR");
        setTtsUrl(toAudioDataUrl(result.audio_base64));
        setTtsSimulated(src === "mock" || !looksWav);
      }
      setTurns((prev) => [
        ...prev,
        {
          id: `agent-${Date.now()}`,
          from: "agent",
          text_te: result.agent_reply_te,
          text_en: result.agent_reply_en,
          at: new Date().toISOString(),
        },
      ]);
      setAnnounce(`${t.ackState}: ${ackLabel(result.contact.status, lang)}`);
      setReplyText("");
      setClipBase64(null);
      setClipName(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const acknowledgeAlert = (id: string): void => {
    setContacts((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, status: "acknowledged" as ContactStatus } : c,
      ),
    );
  };

  return (
    <>
    <PageHeader
      eyebrow={tr("page.phone.eyebrow")}
      title={tr("page.phone.title")}
      lead={tr("page.phone.lead")}
    />
    <div
      className="jadal-phone"
      data-testid="simulated-phone"
    >
      <div className="jadal-phone__bar">
        <span aria-live="polite">
          {source === "api" ? t.sourceApi : t.sourceMock}
        </span>
      </div>

      <div className="jadal-phone__screen">
        {phase === "ringing" && (
          <section
            className="jadal-phone__incoming"
            role="dialog"
            aria-modal="false"
            aria-labelledby="phone-caller-id"
          >
            <div className="jadal-phone__avatar jadal-phone__avatar--ringing" aria-hidden="true">
              📞
            </div>
            <p className="jadal-phone__hint">{t.incoming}</p>
            <h3 className="jadal-phone__caller" id="phone-caller-id">
              {CALLER_ID}
            </h3>
            <p className="jadal-phone__caller-sub">{CALLER_ID_TE}</p>
            <p className="jadal-phone__number">{MOCK_CALLER_NUMBER}</p>
            <div className="jadal-phone__call-actions">
              <div>
                <button
                  type="button"
                  className="jadal-phone__btn jadal-phone__btn--decline"
                  onClick={() => {
                    setPhase("ended");
                    setAnnounce(t.callEnded);
                  }}
                  aria-label={t.decline}
                >
                  ✕
                </button>
                <span className="jadal-phone__btn-label">{t.decline}</span>
              </div>
              <div>
                <button
                  type="button"
                  className="jadal-phone__btn jadal-phone__btn--accept"
                  onClick={() => void acceptCall()}
                  aria-label={t.accept}
                >
                  📞
                </button>
                <span className="jadal-phone__btn-label">{t.accept}</span>
              </div>
            </div>
          </section>
        )}

        {phase === "ended" && (
          <section aria-live="polite">
            <p className="jadal-phone__hint">{t.callEnded}</p>
            <p>{t.declined}</p>
            <button
              type="button"
              className="jadal-phone__send"
              onClick={() => setPhase("ringing")}
            >
              {t.callBack}
            </button>
            <button
              type="button"
              className="jadal-phone__upload"
              onClick={() => setDrawerOpen(true)}
            >
              {t.whatsapp}
            </button>
          </section>
        )}

        {phase === "active" && (
          <>
            <div className="jadal-phone__status-row">
              <strong>
                {CALLER_ID} · {t.liveOn} 🔴
              </strong>
              <span
                className={`jadal-phone__badge jadal-phone__badge--${ackTone(ack)}`}
                aria-live="polite"
              >
                {t.ackState}: {ackLabel(ack, lang)}
              </span>
            </div>

            {loading && <p className="jadal-phone__hint">…</p>}
            {error && (
              <p className="jadal-phone__error" role="alert">
                {error}
              </p>
            )}

            {ttsUrl ? (
              <>
                {/* TTS audio comes from the API reply; offline it is a
                    clearly-labelled simulated tone (see mock.ts). */}
                <audio
                  ref={audioRef}
                  className="jadal-phone__audio"
                  src={ttsUrl}
                  controls
                  aria-label={t.playAnnouncement}
                />
                <p className="jadal-phone__hint">
                  {ttsSimulated ? "🔈 simulated audio (mock)" : "🔈 TTS audio (API)"}
                </p>
              </>
            ) : (
              <button
                type="button"
                className="jadal-phone__upload"
                onClick={playAnnouncement}
                disabled={turns.length === 0}
              >
                {played ? t.replay : t.playAnnouncement}
              </button>
            )}

            <h4 style={{ margin: 0 }}>{t.transcript}</h4>
            <ul className="jadal-phone__transcript" aria-live="polite">
              {turns.map((turn) => (
                <li
                  key={turn.id}
                  className={`jadal-phone__turn jadal-phone__turn--${turn.from}`}
                >
                  <div className="jadal-phone__turn-meta">
                    {turn.from === "farmer"
                      ? t.farmerYou
                      : turn.from === "agent"
                        ? t.agent
                        : t.committee}{" "}
                    · {formatTime(turn.at, lang)}
                  </div>
                  <div>{lang === "te" ? turn.text_te : turn.text_en}</div>
                </li>
              ))}
            </ul>

            <div className="jadal-phone__reply">
              <label htmlFor={`${fileId}-text`} className="jadal-phone__file">
                {t.replyPlaceholder}
              </label>
              <textarea
                id={`${fileId}-text`}
                className="jadal-phone__input"
                rows={2}
                value={replyText}
                placeholder={t.replyPlaceholder}
                onChange={(e) => setReplyText(e.target.value)}
              />
              <div className="jadal-phone__reply-row">
                <button
                  type="button"
                  className="jadal-phone__send"
                  disabled={sending || (!replyText.trim() && !clipBase64)}
                  onClick={() => void sendReply()}
                >
                  {sending ? t.sending : t.send}
                </button>
                {/* Upload is always offered: browser mic recording is not
                    guaranteed, so voice replies go through file upload. */}
                <label className="jadal-phone__upload" htmlFor={`${fileId}-file`}>
                  🎙️ {t.uploadVoice}
                </label>
                <input
                  id={`${fileId}-file`}
                  className="jadal-phone__file"
                  type="file"
                  accept="audio/*"
                  onChange={(e) => void handleClipFile(e.target.files?.[0])}
                />
              </div>
              {!caps.mediaRecorder && (
                <p className="jadal-phone__hint">{t.micNote}</p>
              )}
              {clipName && (
                <p className="jadal-phone__clip" aria-live="polite">
                  {t.clipReady}: {clipName}
                </p>
              )}
              <button
                type="button"
                className="jadal-phone__upload"
                onClick={() => setDrawerOpen(true)}
                aria-expanded={drawerOpen}
              >
                💬 {t.whatsapp}
                {waAlerts.length > 0 ? ` (${waAlerts.length})` : ""}
              </button>
            </div>
          </>
        )}

        <span className="jadal-phone__file" aria-live="polite">
          {announce}
        </span>
      </div>

      {drawerOpen && (
        <section
          className="jadal-phone__drawer"
          role="dialog"
          aria-modal="false"
          aria-label={t.whatsappTitle}
        >
          <div className="jadal-phone__drawer-head">
            <span>
              💬 {t.whatsappTitle} ({waAlerts.length})
            </span>
            <button
              type="button"
              className="jadal-phone__drawer-close"
              onClick={() => setDrawerOpen(false)}
            >
              {t.close} ✕
            </button>
          </div>
          <ul className="jadal-phone__messages">
            {waAlerts.length === 0 && (
              <li className="jadal-phone__msg">—</li>
            )}
            {waAlerts.map((alert) => (
              <li key={alert.id} className="jadal-phone__msg">
                <div>{lang === "te" ? alert.message_te : alert.message_en}</div>
                <span className="jadal-phone__msg-time">
                  {formatTime(alert.at, lang)} · {ackLabel(alert.status, lang)} ✓✓
                </span>
                {alert.status !== "acknowledged" && (
                  <button
                    type="button"
                    className="jadal-phone__ack-btn"
                    onClick={() => acknowledgeAlert(alert.id)}
                  >
                    {t.markAck}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
    </>
  );
}
