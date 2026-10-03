/**
 * Escalation-ladder tests (B7).
 *
 * The ladder is a pure state machine, so most of this file drives `nextEscalation` directly with
 * hand-built contact facts: every transition is asserted, the 15-minute retry delay is asserted
 * both at the instant of failure and part-way through the wait, and the channel decision is asserted
 * for a smartphone farmer, an SMS-capable farmer, and a feature-phone farmer who must never be sent
 * WhatsApp. The one integration test then drives `runEscalation` against the real event store to
 * prove the pure decision is what actually gets appended — events parse as `JadalEvent`, `attempt`
 * bumps, the outbound queue receives the dispatch, and a repeat call is idempotent.
 *
 * NO NETWORK: only `test/harness.ts`'s `createEnv` is used.
 */

import { describe, expect, it } from "vitest";
import { JadalEvent, type Contact } from "@jadal/contracts";

import { createEnv, createTestDb, type FetchRoutes, type TestEnv } from "../../test/harness";
import { seedScenario } from "../../test/fixtures";
import { now as clockNow } from "../db/clock";
import { deterministicId } from "../db/id";
import { getContact } from "../db/repo";
import { appendEvent, readEvents } from "../db/store";
import {
  RETRY_DELAY_MINUTES,
  chooseMessageChannel,
  nextEscalation,
  runEscalation,
  type EscalationContact,
} from "./escalation";

const NOW = "2026-09-14T00:30:00.000Z";

/** `createEnv` plus the migrations `createTestDb` applies; the store cannot run without them. */
async function dbEnv(routes: FetchRoutes = {}): Promise<TestEnv> {
  const env = createEnv(routes);
  env.DB = await createTestDb();
  return env;
}

/** Read the log through the store, which parses and validates every row as `JadalEvent`. */
async function readJadalEvents(env: TestEnv): Promise<JadalEvent[]> {
  return readEvents(env);
}

function plusMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

/** A smartphone farmer who prefers voice then WhatsApp. */
const SMART: EscalationContact = { preferred_channels: ["voice", "whatsapp"], has_smartphone: true };
/** A smartphone farmer reachable by SMS. */
const SMS_CAPABLE: EscalationContact = { preferred_channels: ["voice", "sms"], has_smartphone: true };
/** A feature phone: voice only, no smartphone. */
const FEATURE_PHONE: EscalationContact = { preferred_channels: ["voice"], has_smartphone: false };

describe("nextEscalation", () => {
  it("starts the ladder with a voice call and no delay", () => {
    expect(nextEscalation(SMART, 0, NOW)).toEqual({ action: "call", delayMinutes: 0, channel: "voice" });
  });

  it("retries by voice 15 minutes after the first call", () => {
    const contact: EscalationContact = { ...SMART, channel: "voice", at: NOW };
    expect(nextEscalation(contact, 1, NOW)).toEqual({ action: "retry", delayMinutes: RETRY_DELAY_MINUTES, channel: "voice" });
    expect(RETRY_DELAY_MINUTES).toBe(15);
  });

  it("shortens the retry delay by the time already elapsed", () => {
    const contact: EscalationContact = { ...SMART, channel: "voice", at: NOW };
    expect(nextEscalation(contact, 1, plusMinutes(NOW, 10)).delayMinutes).toBe(5);
    expect(nextEscalation(contact, 1, plusMinutes(NOW, 40)).delayMinutes).toBe(0);
  });

  it("falls back to a message after the retry: WhatsApp for a smartphone", () => {
    expect(nextEscalation(SMART, 2, NOW)).toEqual({ action: "whatsapp", delayMinutes: 0, channel: "whatsapp" });
  });

  it("falls back to SMS when that is the farmer's messaging preference", () => {
    expect(nextEscalation(SMS_CAPABLE, 2, NOW)).toEqual({ action: "sms", delayMinutes: 0, channel: "sms" });
  });

  it("never sends WhatsApp to a farmer without a smartphone", () => {
    const whatsappOnly: EscalationContact = { preferred_channels: ["whatsapp"], has_smartphone: false };
    expect(nextEscalation(FEATURE_PHONE, 2, NOW).channel).not.toBe("whatsapp");
    expect(nextEscalation(whatsappOnly, 2, NOW)).toEqual({ action: "call", delayMinutes: 0, channel: "voice" });
  });

  it("sends SMS to a feature-phone farmer who prefers it", () => {
    const smsFeature: EscalationContact = { preferred_channels: ["voice", "sms"], has_smartphone: false };
    expect(nextEscalation(smsFeature, 2, NOW)).toEqual({ action: "sms", delayMinutes: 0, channel: "sms" });
  });

  it("escalates to the coordinator once attempts are exhausted", () => {
    expect(nextEscalation(SMART, 3, NOW)).toEqual({ action: "escalate", delayMinutes: 0, channel: "portal" });
    expect(nextEscalation(SMART, 4, NOW)).toEqual({ action: "escalate", delayMinutes: 0, channel: "portal" });
  });
});

describe("chooseMessageChannel", () => {
  it("prefers WhatsApp on a smartphone, then SMS, then voice", () => {
    expect(chooseMessageChannel(["voice", "whatsapp"], true)).toBe("whatsapp");
    expect(chooseMessageChannel(["voice", "whatsapp", "sms"], true)).toBe("whatsapp");
    expect(chooseMessageChannel(["voice", "sms"], true)).toBe("sms");
    expect(chooseMessageChannel(["voice"], true)).toBe("voice");
  });

  it("refuses WhatsApp without a smartphone", () => {
    expect(chooseMessageChannel(["whatsapp"], false)).toBe("voice");
    expect(chooseMessageChannel(["whatsapp", "sms"], false)).toBe("sms");
  });
});

describe("runEscalation", () => {
  it("appends the next rung, bumps the attempt, dispatches and is idempotent", async () => {
    const env = await dbEnv();
    await seedScenario(env);
    const at = await clockNow(env);

    const first: Contact = {
      id: "ct-f1-1",
      farmer_id: "f1",
      channel: "voice",
      purpose: "roster_change",
      status: "sent",
      attempt: 1,
      message_te: "జడల్: మీ నీటి వంతు మారింది.",
      message_en: "Jadal: your turn has changed.",
      at,
    };
    await appendEvent(env, {
      id: deterministicId("evt", "contact.updated", first.id),
      at,
      canal_id: "c1",
      actor: { kind: "agent", id: "caller" },
      type: "contact.updated",
      contact: first,
    });

    const second = await runEscalation(env, first.id);
    if (second === null) throw new Error("expected an escalation step");
    expect(second.attempt).toBe(2);
    expect(second.channel).toBe("voice");
    expect(second.status).toBe("queued");
    expect(second.at).toBe(plusMinutes(at, RETRY_DELAY_MINUTES));

    // Idempotent per (contact, attempt): re-running the same step returns the same contact and does
    // not append a duplicate event.
    const again = await runEscalation(env, first.id);
    expect(again?.id).toBe(second.id);

    const third = await runEscalation(env, second.id);
    if (third === null) throw new Error("expected a WhatsApp rung");
    expect(third.attempt).toBe(3);
    expect(third.channel).toBe("whatsapp");

    const fourth = await runEscalation(env, third.id);
    if (fourth === null) throw new Error("expected an escalation to the coordinator");
    expect(fourth.attempt).toBe(4);
    expect(fourth.status).toBe("escalated");
    expect(fourth.channel).toBe("portal");

    const events = await readJadalEvents(env);
    for (const event of events) {
      expect(() => JadalEvent.parse(event)).not.toThrow();
    }
    const updates = events.filter((event) => event.type === "contact.updated");
    expect(updates).toHaveLength(4);
    // Two dispatches: the retry call and the WhatsApp message. The escalation rung is a coordinator
    // flag, not a farmer dispatch, so it is not sent on OUTBOUND.
    expect(env.OUTBOUND.sent).toHaveLength(2);
  });

  it("does nothing for an acknowledged contact", async () => {
    const env = await dbEnv();
    await seedScenario(env);
    const at = await clockNow(env);
    const acked: Contact = {
      id: "ct-f1-acked",
      farmer_id: "f1",
      channel: "voice",
      purpose: "roster_change",
      status: "acknowledged",
      attempt: 1,
      message_te: "జడల్",
      message_en: "Jadal",
      at,
    };
    await appendEvent(env, {
      id: deterministicId("evt", "contact.updated", acked.id),
      at,
      canal_id: "c1",
      actor: { kind: "farmer", id: "f1" },
      type: "contact.updated",
      contact: acked,
    });
    expect(await runEscalation(env, acked.id)).toBeNull();
  });

  it("returns null for an unknown contact", async () => {
    const env = await dbEnv();
    await seedScenario(env);
    expect(await runEscalation(env, "ct-missing")).toBeNull();
  });
});

/**
 * B9 step 2: the ladder places a real call on a voice rung.
 *
 * All three `placeCall` outcomes are covered here, and every one of them is driven through
 * `createEnv`'s recording fetch — the harness throws on an unmocked URL, so a test that accidentally
 * reached the network would fail rather than place a call. The credentials below are Twilio's public
 * test values, not secrets, and no request leaves the process.
 */
describe("runEscalation -> placeCall (B9)", () => {
  /** Twilio's documented test caller ID and a dummy token: safe to commit, never a real account. */
  const TWILIO = {
    TWILIO_ACCOUNT_SID: "ACtest123",
    TWILIO_AUTH_TOKEN: "test-token-not-a-secret",
    TWILIO_FROM_NUMBER: "+15005550006",
    PUBLIC_BASE_URL: "https://jadal.example.dev",
  } as const;

  /** Append the rung the ladder will climb from. */
  async function appendContact(env: TestEnv, at: string, contact: Contact): Promise<Contact> {
    await appendEvent(env, {
      id: deterministicId("evt", "contact.updated", contact.id),
      at,
      canal_id: "c1",
      actor: { kind: "agent", id: "caller" },
      type: "contact.updated",
      contact,
    });
    return contact;
  }

  function voiceContact(id: string, farmerId: string, attempt: number, at: string): Contact {
    return {
      id,
      farmer_id: farmerId,
      channel: "voice",
      purpose: "roster_change",
      status: "sent",
      attempt,
      message_te: "జడల్: మీ నీటి వంతు మారింది.",
      message_en: "Jadal: your turn has changed.",
      at,
    };
  }

  it("branch 1: without Twilio env the simulated phone is kept and nothing is fetched", async () => {
    const env = await dbEnv();
    await seedScenario(env);
    const at = await clockNow(env);
    await appendContact(env, at, voiceContact("ct-sim-1", "f1", 1, at));

    const next = await runEscalation(env, "ct-sim-1");
    expect(next).not.toBeNull();
    // `{simulated: true}`: the rung is still queued for the browser phone, not marked sent.
    expect(next?.status).toBe("queued");
    expect(next?.attempt).toBe(2);
    expect(env.calls).toHaveLength(0);
    // The ladder still dispatches the rung, exactly as it did before B9.
    expect(env.OUTBOUND.sent).toHaveLength(1);
  });

  it("branch 2: a Twilio-accepted call marks the contact sent", async () => {
    const env = await dbEnv({ "api.twilio.com": { sid: "CA123", status: "queued" } });
    Object.assign(env, TWILIO);
    await seedScenario(env);
    const at = await clockNow(env);
    await appendContact(env, at, voiceContact("ct-ok-1", "f1", 1, at));

    const next = await runEscalation(env, "ct-ok-1");
    expect(next?.status).toBe("sent");
    expect(next?.attempt).toBe(2);

    const call = env.calls.find((entry) => entry.url.includes("api.twilio.com"));
    expect(call).toBeDefined();
    expect(call?.url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest123/Calls.json");
    const form = new URLSearchParams(call?.body as string);
    expect(form.get("To")).toBe("+919000000001");
    expect(form.get("From")).toBe("+15005550006");
    expect(form.get("Url")).toBe(`https://jadal.example.dev/api/telephony/twiml/${next?.id}`);
    expect(form.get("StatusCallback")).toBe(`https://jadal.example.dev/api/telephony/status/${next?.id}`);

    // The status is in the event log, not just in the returned object.
    const stored = await getContact(env, next?.id as string);
    expect(stored?.status).toBe("sent");
  });

  it("branch 3: a Twilio rejection marks the contact failed, and the ladder retries then escalates", async () => {
    const env = await dbEnv({
      "api.twilio.com": new Response(JSON.stringify({ message: "Unverified number" }), { status: 400 }),
    });
    Object.assign(env, TWILIO);
    await seedScenario(env);
    const at = await clockNow(env);
    // f5 is a feature phone: voice is the only channel it can be reached on, so every rung below is a
    // voice call and the ladder must exhaust its retries before flagging the coordinator.
    await appendContact(env, at, voiceContact("ct-fail-1", "f5", 1, at));

    // Rung 2: the 15-minute voice retry. Twilio refuses it.
    const second = await runEscalation(env, "ct-fail-1");
    expect(second?.status).toBe("failed");
    expect(second?.attempt).toBe(2);
    expect(second?.channel).toBe("voice");

    // Rung 3: the failed attempt was counted, so the ladder tries voice once more.
    const third = await runEscalation(env, second?.id as string);
    expect(third?.status).toBe("failed");
    expect(third?.attempt).toBe(3);
    expect(third?.channel).toBe("voice");

    // Rung 4: attempts exhausted -> escalate to the coordinator.
    const fourth = await runEscalation(env, third?.id as string);
    expect(fourth?.status).toBe("escalated");
    expect(fourth?.attempt).toBe(4);
    expect(fourth?.channel).toBe("portal");

    // Two voice rungs were actually attempted (the retry and the last-resort call); the escalation
    // rung is a coordinator flag on the portal channel and places no call.
    expect(env.calls.filter((entry) => entry.url.includes("api.twilio.com"))).toHaveLength(2);
    // Every event still parses as the contract's `JadalEvent`, failed rungs included.
    for (const event of await readJadalEvents(env)) {
      expect(() => JadalEvent.parse(event)).not.toThrow();
    }
  });

  it("does not place a call on a messaging rung", async () => {
    const env = await dbEnv({ "api.twilio.com": { sid: "CA123", status: "queued" } });
    Object.assign(env, TWILIO);
    await seedScenario(env);
    const at = await clockNow(env);
    await appendContact(env, at, voiceContact("ct-msg-1", "f1", 2, at));

    const next = await runEscalation(env, "ct-msg-1");
    expect(next?.channel).toBe("whatsapp");
    expect(next?.status).toBe("queued");
    expect(env.calls).toHaveLength(0);
  });
});
