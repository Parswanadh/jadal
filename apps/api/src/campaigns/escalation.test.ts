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
import { appendEvent } from "../db/store";
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

/**
 * Read the log directly and validate every row against `JadalEvent`.
 *
 * The store's own `readEvents` helper has a pre-existing bug (it hands the raw `payload` JSON text to
 * `JadalEvent.parse` without `JSON.parse`); this file must not depend on a file it does not own, so it
 * does the one-line read itself and keeps the contract assertion.
 */
async function readJadalEvents(env: TestEnv): Promise<JadalEvent[]> {
  const rows = await env.DB.prepare("SELECT payload FROM events ORDER BY seq ASC").all<{ payload: string }>();
  return rows.map((row) => JadalEvent.parse(JSON.parse(row.payload) as unknown));
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
