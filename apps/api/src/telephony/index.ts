// Mount with: app.route("/api/telephony", createTelephonyRoutes(deps))
export { createTelephonyRoutes, CALL_STATUS_MAP, OUTBOUND_STT_ORDER } from "./routes";
export { registerInboundRoutes, INBOUND_STT_ORDER, INBOUND_GATHER_TIMEOUT_SEC } from "./inbound";
export { placeCall, realCallsEnabled } from "./twilio";
export { computeTwilioSignature, validateTwilioSignature } from "./signature";
export { transcribe, sarvamStt, sarvamTts, deepgramStt, type TranscriptionOutcome } from "./speech";
export { speak, spokenPart, phraseAudio, phraseCacheKey, recordSpeechPath, type Spoken } from "./audio";
export {
  inboundTwiml,
  inboundUrls,
  inboundRecordTwiml,
  listenTwiml,
  renderSpokenPart,
  speakAndHangupTwiml,
  spokenPath,
  type InboundUrls,
  type SpokenTwimlPart,
} from "./twiml";
export type {
  AudioCache,
  InboundCaller,
  PlaceCallInput,
  PlaceCallResult,
  RaiseRequestInput,
  SpeechPath,
  SpeechPathDetail,
  SpeechPhase,
  StatusDetail,
  SttEngine,
  TelephonyDeps,
  TelephonyEnv,
} from "./types";
