/**
 * Task 1 + 4: the inbound path end to end through the **real app**, with the network stubbed.
 *
 * `telephony/inbound.test.ts` proves the inbound module against hand-built deps. This file proves the
 * *seam* — the deps `buildTelephonyDeps` actually builds against the real event store, reached through
 * `createApp()`'s mounted `/api/telephony`, with a Twilio-shaped signed webhook.
 *
 * Four properties are load-bearing here, and each is the thing that was missing or unproven before:
 *
 *  1. **`resolveCaller` is wired.** The app-level deps resolve a `From` number to the seeded farmer, so
 *     an inbound call is attributed. A known number gets a *named* Telugu greeting; an unknown one gets
 *     the generic greeting. Before this was wired, `deps.resolveCaller` was `undefined` and every call
 *     was anonymous, so `raiseRequest` could never fire.
 *  2. **DTMF 2 starts a recording**, and the keypad signal rides through to the recording step as
 *     `?urgent=1`.
 *  3. **The recording is transcribed, classified and raised.** With Deepgram stubbed, the Telugu
 *     transcript reaches System-1 and a real request row is written, readable via `GET /api/requests`.
 *  4. **The signature is enforced.** `SKIP_TWILIO_SIGNATURE` absent ⇒ an unsigned or wrongly-signed
 *     webhook is a 403 and nothing is written.
 *
 * NO NETWORK: `test/harness.ts`'s fetch throws on any unmocked URL, and the one recording/STT route is
 * stubbed explicitly. No test contacts Twilio, Sarvam or Deepgram.
 */

import type { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createApp } from "../app";
import { now as clockNow } from "../db/clock";
import { newId } from "../db/id";
import { getContact, getRequest } from "../db/repo";
import { appendEvent, readEvents } from "../db/store";
import type { Env } from "../env";
import { buildTelephonyDeps, phoneKey } from "../telephony-deps";
import { computeTwilioSignature } from "./signature";
import { call, createEnv, createTestDb, expectStatus, type TestEnv } from "../../test/harness";
import { seedScenario } from "../../test/fixtures";
import type { Contact } from "@jadal/contracts";

const CANAL_ID = "c1";
/** The public origin the signature is computed against — the same value the app reads from env. */
const BASE = "https://api.jadal.test";
const TOKEN = "test-auth-token-not-a-secret";
/** f1's seeded number (packages/contracts/fixtures/demo-scenario.json). */
const F1_PHONE = "+919000000001";
const UNKNOWN_PHONE = "+919999999999";
const RECORDING_URL = "https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/RE1";
/** A phrase System-1's offline rules classify as an urgent request. */
const URGENT_TE = "నాకు అత్యవసరంగా నీళ్లు కావాలి";
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04]);

/**
 * A seeded env with the Twilio signature check armed.
 *
 * `PUBLIC_BASE_URL` is set to `BASE` so `guardTwilioRequest` rebuilds the signed URL identically to
 * {@link signed}. `SKIP_TWILIO_SIGNATURE` is deliberately **absent** — these tests prove the real
 * check, not the local bypass.
 */
async function inboundEnv(extra: Record<string, unknown> = {}): Promise<TestEnv> {
  const env = createEnv({
    // The only outbound calls the inbound path makes: Twilio's recording, then Deepgram STT.
    "twilio.com": () => new Response(WAV, { status: 200, headers: { "Content-Type": "audio/wav" } }),
    "deepgram.com": { results: { channels: [{ alternatives: [{ transcript: URGENT_TE }] }] } },
  });
  env.DB = await createTestDb();
  await seedScenario(env);
  // `DEEPGRAM_API_KEY` is what makes the recording path really transcribe: without a key the engine
  // chain reports "no key" and the flow falls to the keypad-only raise (a case tested separately).
  return Object.assign(
    env,
    { TWILIO_AUTH_TOKEN: TOKEN, PUBLIC_BASE_URL: BASE, DEEPGRAM_API_KEY: "dg-test-key" },
    extra,
  );
}

function app(): Hono<{ Bindings: TestEnv }> {
  return createApp() as unknown as Hono<{ Bindings: TestEnv }>;
}

/** Sign and POST a webhook the way Twilio does: signature over `BASE + path` and the sorted form. */
async function signedPost(
  env: TestEnv,
  path: string,
  params: Record<string, string>,
  opts: { token?: string | null; signature?: string } = {},
) {
  const entries = Object.entries(params);
  const token = opts.token === undefined ? TOKEN : opts.token;
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (token !== null) {
    headers["x-twilio-signature"] =
      opts.signature ?? (await computeTwilioSignature(token, `${BASE}${path}`, entries));
  } else if (opts.signature !== undefined) {
    headers["x-twilio-signature"] = opts.signature;
  }

  const res = await app().fetch(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers,
      body: new URLSearchParams(params).toString(),
    }),
    env as never,
  );
  return { status: res.status, text: await res.text(), speech: res.headers.get("x-jadal-speech") ?? "" };
}

/** Append a `queued` voice contact for `farmerId` and return it. */
async function seedContact(env: TestEnv, farmerId = "f1", id = "ct-inbound-1"): Promise<Contact> {
  const at = await clockNow(env);
  const contact: Contact = {
    id,
    farmer_id: farmerId,
    channel: "voice",
    purpose: "roster_change",
    status: "queued",
    attempt: 1,
    message_te: "జడల్: మీ నీటి వంతు రేపు ఉదయం.",
    message_en: "Jadal: your turn is tomorrow morning.",
    at,
  };
  await appendEvent(env, {
    id: newId("evt"),
    at,
    canal_id: CANAL_ID,
    actor: { kind: "agent", id: "caller" },
    type: "contact.updated",
    contact,
  });
  return contact;
}

/** The webhook params Twilio sends on an inbound voice call. */
const callParams = (from: string) => ({ From: from, To: "+17320008034", CallSid: "CAinbound1" });

describe("resolveCaller wiring (the missing dep)", () => {
  it("is present on the deps the Worker builds", async () => {
    const env = await inboundEnv();
    const deps = buildTelephonyDeps(env as unknown as Env);
    expect(deps.resolveCaller).toBeTypeOf("function");
  });

  it("resolves a seeded farmer number to that farmer, with no contact when none is open", async () => {
    const env = await inboundEnv();
    const deps = buildTelephonyDeps(env as unknown as Env);

    const caller = await deps.resolveCaller?.(F1_PHONE);
    expect(caller?.farmerId).toBe("f1");
    expect(caller?.farmerName).toBe("Ramaiah Kota");
    // A farmer calling in about an urgent request usually has no open contact.
    expect(caller?.contactId).toBeUndefined();
  });

  it("matches despite formatting differences, and returns null for a stranger", async () => {
    const env = await inboundEnv();
    const deps = buildTelephonyDeps(env as unknown as Env);

    expect((await deps.resolveCaller?.("+91 90000 00001"))?.farmerId).toBe("f1");
    expect((await deps.resolveCaller?.("tel:+919000000001"))?.farmerId).toBe("f1");
    expect(await deps.resolveCaller?.(UNKNOWN_PHONE)).toBeNull();
    expect(await deps.resolveCaller?.("")).toBeNull();
  });

  it("attaches the most recent open contact, and ignores acknowledged ones", async () => {
    const env = await inboundEnv();
    await seedContact(env, "f1", "ct-queued");
    const deps = buildTelephonyDeps(env as unknown as Env);

    const caller = await deps.resolveCaller?.(F1_PHONE);
    expect(caller?.contactId).toBe("ct-queued");

    // Once that contact is acknowledged it is closed, so a second call has nothing to acknowledge.
    const deps2 = buildTelephonyDeps(env as unknown as Env);
    await deps2.recordAck("ct-queued", true, "dtmf:1");
    expect((await deps2.resolveCaller?.(F1_PHONE))?.contactId).toBeUndefined();
  });

  it("phoneKey is a digit-only matching key", () => {
    expect(phoneKey("+91 90000 00001")).toBe("919000000001");
    expect(phoneKey("tel:+919000000001")).toBe("919000000001");
    expect(phoneKey("(91) 90000-00001")).toBe("919000000001");
  });
});

describe("inbound call through the real app", () => {
  it("answers a known farmer by name, in Telugu, and starts the keypad gather", async () => {
    const env = await inboundEnv();
    const res = await signedPost(env, "/api/telephony/inbound", callParams(F1_PHONE));

    expect(res.status).toBe(200);
    expect(res.text).toContain("<Response>");
    expect(res.text).toContain("<Gather input=\"dtmf\" numDigits=\"1\"");
    expect(res.text).toContain("/api/telephony/inbound/respond");
    expect(res.text).toContain("/api/telephony/inbound/listen");
    // The seeded farmer's name proves resolveCaller matched the number (it drives the vocative).
    expect(res.text).toContain("Ramaiah Kota");
    // No Sarvam key in the test env, so speech honestly falls back to Twilio's Telugu voice.
    expect(res.speech).toBe("say");
  });

  it("answers an unknown number with the generic greeting and no name", async () => {
    const env = await inboundEnv();
    const res = await signedPost(env, "/api/telephony/inbound", callParams(UNKNOWN_PHONE));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Ramaiah Kota");
    expect(res.text).toContain("<Gather input=\"dtmf\"");
  });

  it("DTMF 1 acknowledges an open contact", async () => {
    const env = await inboundEnv();
    const contact = await seedContact(env);
    const res = await signedPost(env, "/api/telephony/inbound/respond", { ...callParams(F1_PHONE), Digits: "1" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("<Hangup/>");
    expect((await getContact(env, contact.id))?.status).toBe("acknowledged");
  });

  it("DTMF 2 starts a recording and carries the keypad signal as ?urgent=1", async () => {
    const env = await inboundEnv();
    const res = await signedPost(env, "/api/telephony/inbound/respond", { ...callParams(F1_PHONE), Digits: "2" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("<Record");
    expect(res.text).toContain("/api/telephony/inbound/recording?urgent=1");
  });

  it("no keypress falls through to the listen/record step", async () => {
    const env = await inboundEnv();
    const res = await signedPost(env, "/api/telephony/inbound/listen", callParams(F1_PHONE));

    expect(res.status).toBe(200);
    expect(res.text).toContain("<Record");
    expect(res.text).toContain("/api/telephony/inbound/recording");
  });

  it("transcribes the recording, classifies it, raises the request, and serves it on GET /api/requests", async () => {
    const env = await inboundEnv();
    const res = await signedPost(env, "/api/telephony/inbound/recording?urgent=1", {
      ...callParams(F1_PHONE),
      RecordingUrl: RECORDING_URL,
      RecordingSid: "RE1",
      RecordingDuration: "4",
    });

    // The agent confirms in Telugu and hangs up — the *recorded*, not the failed, message.
    expect(res.status).toBe(200);
    expect(res.text).toContain("<Hangup/>");
    expect(res.speech).toBe("say");

    // A real request row exists, attributed to f1, carrying the transcript as its reason.
    const requests = await call<{ id: string; farmer_id: string; type: string; channel: string; reason: string }[]>(
      app(),
      "GET",
      "/api/requests",
      { env },
    );
    expectStatus(requests, 200);
    expect(requests.body).toHaveLength(1);
    const raised = requests.body[0]!;
    expect(raised.farmer_id).toBe("f1");
    expect(raised.type).toBe("urgent");
    expect(raised.channel).toBe("voice");
    expect(raised.reason).toBe(URGENT_TE);

    const stored = await getRequest(env, raised.id);
    expect(stored?.reason).toBe(URGENT_TE);

    // System-1 really classified the transcript (source is the offline rules tier here).
    const event = (await readEvents(env)).find((e) => e.type === "request.raised");
    expect(event?.type === "request.raised" && event.request.channel).toBe("voice");
  });

  it("never raises a request for a caller whose number is not on the roster", async () => {
    const env = await inboundEnv();
    const res = await signedPost(env, "/api/telephony/inbound/recording?urgent=1", {
      ...callParams(UNKNOWN_PHONE),
      RecordingUrl: RECORDING_URL,
      RecordingSid: "RE2",
      RecordingDuration: "4",
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain("<Hangup/>");
    const requests = await call<unknown[]>(app(), "GET", "/api/requests", { env });
    expect(requests.body).toHaveLength(0);
    expect((await readEvents(env)).filter((e) => e.type === "request.raised")).toHaveLength(0);
  });

  it("still raises an urgent request on keypad 2 when the recording cannot be fetched", async () => {
    // A recording URL that is not a Twilio host is refused before any network call.
    const env = await inboundEnv();
    const res = await signedPost(env, "/api/telephony/inbound/recording?urgent=1", {
      ...callParams(F1_PHONE),
      RecordingUrl: "https://evil.example.com/rec.wav",
    });

    expect(res.status).toBe(200);
    const requests = await call<{ type: string; reason: string }[]>(app(), "GET", "/api/requests", { env });
    expect(requests.body).toHaveLength(1);
    expect(requests.body[0]?.type).toBe("urgent");
    // Honest about what happened: the keypad signal raised it, the audio was not heard.
    expect(requests.body[0]?.reason).toMatch(/keypad/);
  });
});

describe("inbound webhook signature", () => {
  it("rejects an unsigned webhook with 403 and writes nothing", async () => {
    const env = await inboundEnv();
    const res = await signedPost(env, "/api/telephony/inbound", callParams(F1_PHONE), { token: null });

    expect(res.status).toBe(403);
    expect(res.text).not.toContain("Ramaiah Kota");
  });

  it("rejects a webhook signed with the wrong token", async () => {
    const env = await inboundEnv();
    const res = await signedPost(env, "/api/telephony/inbound", callParams(F1_PHONE), { token: "wrong-token" });
    expect(res.status).toBe(403);
  });

  it("rejects a webhook whose body was tampered with after signing", async () => {
    const env = await inboundEnv();
    // Sign for the honest number, then send a different one: the signature no longer matches.
    const signature = await computeTwilioSignature(TOKEN, `${BASE}/api/telephony/inbound`, [
      ["From", F1_PHONE],
      ["To", "+17320008034"],
      ["CallSid", "CAinbound1"],
    ]);
    const res = await signedPost(env, "/api/telephony/inbound", callParams(UNKNOWN_PHONE), { signature });

    expect(res.status).toBe(403);
  });

  it("rejects the recording step too, so a forged webhook cannot raise a request", async () => {
    const env = await inboundEnv();
    const res = await signedPost(
      env,
      "/api/telephony/inbound/recording?urgent=1",
      { ...callParams(F1_PHONE), RecordingUrl: RECORDING_URL },
      { token: null },
    );

    expect(res.status).toBe(403);
    expect((await readEvents(env)).filter((e) => e.type === "request.raised")).toHaveLength(0);
  });
});
