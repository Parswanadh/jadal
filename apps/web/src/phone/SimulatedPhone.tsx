import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import "./SimulatedPhone.css";
import { fetchContacts, fetchFarmerNames, postPhoneReply } from "./api";
import {
  CALLER_ID,
  CALLER_ID_TE,
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

/** The call to show: an explicit `?contact=` wins, otherwise the first voice contact. */
function pickVoiceContact(contacts: PhoneContact[], wantedId?: string | null): PhoneContact | null {
  if (wantedId) {
    const wanted = contacts.find((c) => c.id === wantedId);
    if (wanted) return wanted;
  }
  const voice = contacts.find((c) => c.channel === "voice");
  return voice ?? contacts[0] ?? null;
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

export default function SimulatedPhone() {
  const { lang, t } = useI18n();
  const [params] = useSearchParams();
  /** A specific contact to call, e.g. the one an urgent request created. */
  const wantedContact = params.get("contact");
  const [phase, setPhase] = useState<CallPhase>("ringing");
  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
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
  const autoAccepted = useRef(false);
  const fileId = useId();

  const voiceContact = pickVoiceContact(contacts, wantedContact);
  const ownerId = voiceContact?.farmer_id ?? null;
  const ownerName = ownerId ? (names.get(ownerId) ?? "") : "";
  const waAlerts = contacts.filter((c) => c.channel === "whatsapp" && c.farmer_id === ownerId);
  const caps = detectCapabilities();
  const callerId = lang === "te" ? CALLER_ID_TE : CALLER_ID;

  const load = useCallback(async () => {
    const [{ contacts: fetched, source: src }, farmerNames] = await Promise.all([fetchContacts(), fetchFarmerNames()]);
    setContacts(fetched);
    setNames(farmerNames);
    setSource(src);
    return fetched;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: contacts load once; `t` changes with language and must not refetch
  useEffect(() => {
    load().catch(() => setError(t("common.loadError")));
  }, [load]);

  const acceptCall = async (): Promise<void> => {
    setPhase("active");
    setLoading(true);
    setError(null);
    setAnnounce(t("phone.callActive"));
    try {
      const fetched = await load();
      const voice = pickVoiceContact(fetched, wantedContact);
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
    } catch {
      setError(t("common.loadError"));
    } finally {
      setLoading(false);
    }
  };

  // A `?contact=` link (for example from an urgent request) answers the call
  // straight away, so the agent's reply is on screen without another tap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `acceptCall` is redefined each render; adding it would re-run on every render
  useEffect(() => {
    if (!wantedContact || autoAccepted.current || contacts.length === 0) return;
    autoAccepted.current = true;
    void acceptCall();
  }, [wantedContact, contacts.length]);

  // Speech is user-initiated only. The committee's message is on screen as a
  // transcript the moment the call connects, and the play control below speaks
  // it. Auto-speaking on connect hijacked the screen — including when a request
  // raised on the farmer side opened this phone — so nothing here fires on its
  // own. See AgentCall.tsx for the same rule on the outbound-call panel.

  const playAnnouncement = (): void => {
    if (audioRef.current) {
      void audioRef.current.play().catch(() => {
        setError(t("phone.noAudio"));
      });
      setPlayed(true);
    } else {
      setError(t("phone.noAudio"));
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
      setError(t("phone.noAudio"));
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
      text_te: clipBase64 ? t("phone.voiceClipTurn", { name: clipName ?? "" }) : replyText.trim(),
      text_en: clipBase64 ? t("phone.voiceClipTurn", { name: clipName ?? "" }) : replyText.trim(),
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
      setAnnounce(`${t("phone.ackState")}: ${ackLabel(result.contact.status, lang)}`);
      setReplyText("");
      setClipBase64(null);
      setClipName(null);
    } catch {
      setError(t("common.loadError"));
    } finally {
      setSending(false);
    }
  };

  const acknowledgeAlert = (id: string): void => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, status: "acknowledged" as ContactStatus } : c)));
  };

  // Who Jadal contacts, grouped by farmer, for the side panel.
  const farmerIds = [...new Set(contacts.map((c) => c.farmer_id))];
  const reach = farmerIds.map((id) => ({
    id,
    name: names.get(id) ?? "",
    call: contacts.some((c) => c.farmer_id === id && c.channel === "voice"),
    whatsapp: contacts.some((c) => c.farmer_id === id && c.channel === "whatsapp"),
  }));

  return (
    <>
      <PageHeader eyebrow={t("page.phone.eyebrow")} title={t("page.phone.title")} lead={t("page.phone.lead")} />
      <div className="phone-layout">
        <div className="jadal-phone" data-testid="simulated-phone" data-source={source}>
          <div className="jadal-phone__bar">
            <span>{ownerName ? t("phone.phoneOf", { name: ownerName }) : t("phone.title")}</span>
          </div>

          <div className="jadal-phone__screen">
            {phase === "ringing" && (
              <section className="jadal-phone__incoming" role="dialog" aria-modal="false" aria-labelledby="phone-caller-id">
                <div className="jadal-phone__avatar jadal-phone__avatar--ringing" aria-hidden="true">
                  <PhoneIcon />
                </div>
                <p className="jadal-phone__hint">{t("phone.incoming")}</p>
                <h2 className="jadal-phone__caller" id="phone-caller-id">
                  {callerId}
                </h2>
                <div className="jadal-phone__call-actions">
                  <div>
                    <button
                      type="button"
                      className="jadal-phone__btn jadal-phone__btn--decline"
                      onClick={() => {
                        setPhase("ended");
                        setAnnounce(t("phone.callEnded"));
                      }}
                      aria-label={t("phone.decline")}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                    <span className="jadal-phone__btn-label">{t("phone.decline")}</span>
                  </div>
                  <div>
                    <button type="button" className="jadal-phone__btn jadal-phone__btn--accept" onClick={() => void acceptCall()} aria-label={t("phone.accept")}>
                      <PhoneIcon />
                    </button>
                    <span className="jadal-phone__btn-label">{t("phone.accept")}</span>
                  </div>
                </div>
              </section>
            )}

            {phase === "ended" && (
              <section aria-live="polite">
                <p className="jadal-phone__hint">{t("phone.callEnded")}</p>
                <p>{t("phone.declined")}</p>
                <button type="button" className="jadal-phone__send" onClick={() => setPhase("ringing")}>
                  {t("phone.callBack")}
                </button>
                <button type="button" className="jadal-phone__upload" onClick={() => setDrawerOpen(true)}>
                  {t("phone.whatsapp")}
                </button>
              </section>
            )}

            {phase === "active" && (
              <>
                <div className="jadal-phone__status-row">
                  <strong>{callerId}</strong>
                  <span className={`jadal-phone__badge jadal-phone__badge--${ackTone(ack)}`} aria-live="polite">
                    {t("phone.ackState")}: {ackLabel(ack, lang)}
                  </span>
                </div>

                {loading && <p className="jadal-phone__hint">{t("common.loading")}</p>}
                {error && (
                  <p className="jadal-phone__error" role="alert">
                    {error}
                  </p>
                )}

                {ttsUrl ? (
                  <>
                    <audio ref={audioRef} className="jadal-phone__audio" src={ttsUrl} controls aria-label={t("phone.playAnnouncement")} />
                    {ttsSimulated && <p className="jadal-phone__hint">{t("phone.demoSound")}</p>}
                  </>
                ) : (
                  <button type="button" className="jadal-phone__upload" onClick={playAnnouncement} disabled={turns.length === 0}>
                    {played ? t("phone.replay") : t("phone.playAnnouncement")}
                  </button>
                )}

                <h2 className="jadal-phone__heading">{t("phone.transcript")}</h2>
                <ul className="jadal-phone__transcript" aria-live="polite">
                  {turns.map((turn) => (
                    <li key={turn.id} className={`jadal-phone__turn jadal-phone__turn--${turn.from}`}>
                      <div className="jadal-phone__turn-meta">
                        {turn.from === "farmer" ? t("phone.farmerYou") : turn.from === "agent" ? t("phone.agent") : t("phone.committee")} · {formatTime(turn.at, lang)}
                      </div>
                      <div>{lang === "te" ? turn.text_te : turn.text_en}</div>
                    </li>
                  ))}
                </ul>

                <div className="jadal-phone__reply">
                  <label htmlFor={`${fileId}-text`} className="jadal-phone__file">
                    {t("phone.replyPlaceholder")}
                  </label>
                  <textarea
                    id={`${fileId}-text`}
                    className="jadal-phone__input"
                    rows={2}
                    value={replyText}
                    placeholder={t("phone.replyPlaceholder")}
                    onChange={(e) => setReplyText(e.target.value)}
                  />
                  <div className="jadal-phone__reply-row">
                    <button type="button" className="jadal-phone__send" disabled={sending || (!replyText.trim() && !clipBase64)} onClick={() => void sendReply()}>
                      {sending ? t("phone.sending") : t("phone.send")}
                    </button>
                    {/* Upload is always offered: browser mic recording is not guaranteed, so voice replies go through file upload. */}
                    <label className="jadal-phone__upload jadal-phone__upload--file">
                      {t("phone.uploadVoice")}
                      <input id={`${fileId}-file`} className="jadal-phone__file" type="file" accept="audio/*" onChange={(e) => void handleClipFile(e.target.files?.[0])} />
                    </label>
                  </div>
                  {!caps.mediaRecorder && <p className="jadal-phone__hint">{t("phone.micNote")}</p>}
                  {clipName && (
                    <p className="jadal-phone__clip" aria-live="polite">
                      {t("phone.clipReady")}: {clipName}
                    </p>
                  )}
                  <button type="button" className="jadal-phone__upload" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen}>
                    {t("phone.whatsapp")}
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
            <section className="jadal-phone__drawer" role="dialog" aria-modal="false" aria-label={t("phone.whatsappTitle")}>
              <div className="jadal-phone__drawer-head">
                <span>
                  {t("phone.whatsappTitle")} ({waAlerts.length})
                </span>
                <button type="button" className="jadal-phone__drawer-close" onClick={() => setDrawerOpen(false)}>
                  {t("phone.close")}
                </button>
              </div>
              <ul className="jadal-phone__messages">
                {waAlerts.length === 0 && <li className="jadal-phone__msg">{t("phone.noMessages")}</li>}
                {waAlerts.map((alert) => (
                  <li key={alert.id} className="jadal-phone__msg">
                    <div>{lang === "te" ? alert.message_te : alert.message_en}</div>
                    <span className="jadal-phone__msg-time">
                      {formatTime(alert.at, lang)} · {ackLabel(alert.status, lang)}
                    </span>
                    {alert.status !== "acknowledged" && (
                      <button type="button" className="jadal-phone__ack-btn" onClick={() => acknowledgeAlert(alert.id)}>
                        {t("phone.markAck")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="phone-try">
            <h2 className="card-title" id="phone-try">{t("phone.tryTitle")}</h2>
            <ol className="steps-list">
              <li>{t("phone.try1")}</li>
              <li>{t("phone.try2")}</li>
              <li>{t("phone.try3")}</li>
            </ol>
          </section>

          <section className="card" aria-labelledby="phone-reach">
            <h2 className="card-title" id="phone-reach">{t("phone.reachTitle")}</h2>
            <p className="card-sub">{t("phone.reachSub")}</p>
            {reach.length === 0 ? (
              <EmptyState title={t("phone.reachEmptyTitle")} body={t("phone.reachEmptyBody")} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t("coord.col.farmer")}</th>
                      <th scope="col">{t("phone.colCall")}</th>
                      <th scope="col">{t("phone.colWhatsapp")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reach.map((r) => (
                      <tr key={r.id}>
                        <th scope="row">{r.name}</th>
                        <td>{r.call ? t("common.yes") : t("common.no")}</td>
                        <td>{r.whatsapp ? t("common.yes") : t("common.no")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
