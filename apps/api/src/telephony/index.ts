// Mount with: app.route("/api/telephony", createTelephonyRoutes(deps))
export { createTelephonyRoutes, CALL_STATUS_MAP } from "./routes";
export { placeCall, realCallsEnabled } from "./twilio";
export { computeTwilioSignature, validateTwilioSignature } from "./signature";
export type {
  AudioCache,
  PlaceCallInput,
  PlaceCallResult,
  RaiseRequestInput,
  StatusDetail,
  TelephonyDeps,
  TelephonyEnv,
} from "./types";
