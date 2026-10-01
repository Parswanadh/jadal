// Simulated phone: data access through the shared typed API client.
// It reads the queued contacts and posts a farmer's reply. In demo mode the
// shared client serves its contract-validated mock instead.

import { api as client, isMockMode } from "../api";
import { makeToneWavBase64 } from "./helpers";
import type { ApiSource, PhoneContact, PhoneReplyResult } from "./helpers";

export interface ReplyInput {
  text?: string;
  audio_base64?: string;
  mime?: string;
}

function source(): ApiSource {
  return isMockMode() ? "mock" : "api";
}

export async function fetchContacts(): Promise<{ contacts: PhoneContact[]; source: ApiSource }> {
  const contacts = await client.contacts();
  return { contacts, source: source() };
}

/** Farmer names by id, so the screen can say who a call or message goes to. */
export async function fetchFarmerNames(): Promise<Map<string, string>> {
  const list = await client.listFarmers();
  return new Map(list.map((r) => [r.farmer.id, r.farmer.name]));
}

/**
 * Post the farmer's reply. In demo mode the shared mock returns no audio, so a
 * short simulated tone is attached (the screen says it is a demo sound) to keep
 * the "play message" control working without a server.
 */
export async function postPhoneReply(
  contact: PhoneContact,
  input: ReplyInput,
): Promise<{ result: PhoneReplyResult; source: ApiSource }> {
  const res = await client.phoneReply(contact.id, input);
  const result: PhoneReplyResult = {
    contact: res.contact,
    agent_reply_te: res.agent_reply_te,
    agent_reply_en: res.agent_reply_en,
    audio_base64: res.audio_base64 ?? (isMockMode() ? makeToneWavBase64() : undefined),
  };
  return { result, source: source() };
}
