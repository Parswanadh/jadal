/**
 * The Caller agent — one simulated phone turn.
 *
 * A farmer's reply (typed text, or base64 audio via Sarvam STT) is interpreted by System 1, the
 * explicit acknowledgement is written to the event log through the gated-safe `record_ack` tool, and
 * the agent's next line is rendered from the natural-Telugu templates in `../voice/telugu` and spoken
 * with `../voice/sarvam`'s `tts`. Every provider call is null-safe: with no keys the transcript is
 * whatever text arrived and the reply is text-only, so the demo never blocks on the network.
 *
 * The return shape is exactly `routes.phoneReply.response`.
 */

import { Contact } from "@jadal/contracts";
import { classify } from "../system1";
import { getContact, getFarmer } from "../db/repo";
import { stt, tts } from "../voice/sarvam";
import { ackRecordedEn, ackRecordedTe, farmerGreeting } from "../voice/telugu";
import { providerEnvOf, runTool, type ToolEnv } from "./tools";

export interface CallerReply {
  readonly text?: string;
  readonly audio_base64?: string;
  readonly mime?: string;
}

export interface CallerTurnResult {
  readonly contact: Contact;
  readonly agent_reply_te: string;
  readonly agent_reply_en: string;
  readonly audio_base64?: string;
}

/**
 * Advance one turn of a call with the farmer behind `contactId`.
 *
 * @throws {RangeError} when the contact id is unknown.
 */
export async function callerTurn(env: ToolEnv, contactId: string, reply: CallerReply): Promise<CallerTurnResult> {
  const contact = await getContact(env, contactId);
  if (contact === null) throw new RangeError(`no contact ${contactId}`);

  const provider = providerEnvOf(env);

  // Typed text wins over audio when both are supplied; otherwise transcribe. `stt` returns null on
  // every failure (no key, bad base64, transport), which degrades the call to text instead of failing.
  let transcript = reply.text?.trim() ?? "";
  if (transcript.length === 0 && reply.audio_base64 !== undefined) {
    const heard = await stt(provider, reply.audio_base64, reply.mime);
    transcript = heard ?? "";
  }

  // System 1 decides intent; with no key it falls back to keyword rules, so this never throws.
  const intent = transcript.length === 0 ? "other" : (await classify(provider, transcript)).intent;
  // A spoken "I don't need water this week" is a valid answer but not an acknowledgement of the
  // scheduled turn; everything else the farmer says counts as confirmation.
  const acknowledged = transcript.length > 0 && intent !== "not_needed_this_week";

  // Record the acknowledgement (or the silence) through the same registry the loop uses, so the
  // event log — not this module — is the record of what the farmer said.
  const outcome = await runTool(env, "record_ack", {
    contact_id: contactId,
    acknowledged,
    transcript,
  });
  const updated = Contact.parse(outcome.value);

  const farmer = await getFarmer(env, contact.farmer_id);
  const facts = farmer === null ? {} : { farmerName: farmer.farmer.name };

  const agentReplyTe = acknowledged ? ackRecordedTe(facts) : farmerGreeting(facts.farmerName);
  const agentReplyEn = acknowledged ? ackRecordedEn(facts) : farmerGreeting(facts.farmerName, "en");

  const audio = await tts(provider, agentReplyTe);
  return audio === null
    ? { contact: updated, agent_reply_te: agentReplyTe, agent_reply_en: agentReplyEn }
    : { contact: updated, agent_reply_te: agentReplyTe, agent_reply_en: agentReplyEn, audio_base64: audio };
}
