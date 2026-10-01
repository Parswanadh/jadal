/**
 * B9 step 1: the Worker builds `TelephonyDeps` and mounts `/api/telephony`.
 *
 * The B8 module is tested in isolation against hand-built deps (`telephony/telephony.test.ts`). This
 * file tests the *seam*: the deps the app actually builds, against the real event store, and the
 * module reached through `createApp()`.
 *
 * Three properties are load-bearing and each gets an explicit test:
 *
 *  * every dep that changes state appends `contact.updated` through `appendEvent` — nothing writes a
 *    projection directly;
 *  * `raiseRequest` is the *same* path as `POST /api/requests`, asserted by comparing the events the
 *    dep produces with the events the HTTP route produces;
 *  * the mount works end to end, with Twilio's signature check skipped the way `.dev.vars.example`
 *    documents for local replay.
 *
 * NO NETWORK: `test/harness.ts`'s fetch throws on any unmocked URL.
 */

import type { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createApp } from "./app";
import { now as clockNow } from "./db/clock";
import { newId } from "./db/id";
import { getContact, getRequest } from "./db/repo";
import { appendEvent, readEvents } from "./db/store";
import type { Env } from "./env";
import { buildTelephonyDeps } from "./telephony-deps";
import { call, createEnv, createTestDb, expectStatus, type TestEnv } from "../test/harness";
import { seedScenario } from "../test/fixtures";
import type { Contact } from "@jadal/contracts";

const CANAL_ID = "c1";

/** A KV stand-in that can hold binary values, which the telephony audio cache needs. */
class BinaryKV {
  readonly map = new Map<string, ArrayBuffer>();
  async get(key: string): Promise<ArrayBuffer | null> {
    return this.map.get(key) ?? null;
  }
  async put(key: string, value: ArrayBuffer): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async list(): Promise<unknown> {
    return { keys: [...this.map.keys()].map((name) => ({ name })) };
  }
}

/** A seeded env with the migrations applied and Twilio's signature check skipped. */
async function telephonyEnv(extra: Record<string, unknown> = {}): Promise<TestEnv> {
  const env = createEnv();
  env.DB = await createTestDb();
  await seedScenario(env);
  return Object.assign(env, { SKIP_TWILIO_SIGNATURE: "1" }, extra);
}

function app(): Hono<{ Bindings: TestEnv }> {
  return createApp() as unknown as Hono<{ Bindings: TestEnv }>;
}

/** Append a `queued` voice contact for f1 and return it. */
async function seedContact(env: TestEnv, id = "ct-tel-1"): Promise<Contact> {
  const at = await clockNow(env);
  const contact: Contact = {
    id,
    farmer_id: "f1",
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

/** POST a Twilio-style form body to the mounted app. */
async function postForm(env: TestEnv, path: string, params: Record<string, string> = {}) {
  const res = await app().fetch(
    new Request(`https://api.jadal.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    }),
    env as never,
  );
  const text = await res.text();
  return { status: res.status, text, contentType: res.headers.get("content-type") ?? "" };
}

describe("buildTelephonyDeps", () => {
  it("reads the contact and its Telugu message from the store", async () => {
    const env = await telephonyEnv();
    const contact = await seedContact(env);
    const deps = buildTelephonyDeps(env as unknown as Env);

    const found = await deps.getContact(contact.id);
    expect(found?.id).toBe(contact.id);
    expect(found?.farmer_id).toBe("f1");
    expect(await deps.getMessage(contact.id)).toBe(contact.message_te);
    expect(await deps.getContact("ct-nope")).toBeNull();
    expect(await deps.getMessage("ct-nope")).toBe("");
  });

  it("recordAck appends an acknowledged contact.updated event", async () => {
    const env = await telephonyEnv();
    const contact = await seedContact(env);
    const deps = buildTelephonyDeps(env as unknown as Env);

    await deps.recordAck(contact.id, true, "dtmf:1");

    expect((await getContact(env, contact.id))?.status).toBe("acknowledged");
    const updates = (await readEvents(env)).filter((event) => event.type === "contact.updated");
    expect(updates).toHaveLength(2);
    const last = updates[1];
    expect(last?.type === "contact.updated" && last.contact.status).toBe("acknowledged");
  });

  it("recordAck(false) records nothing and leaves the status alone", async () => {
    const env = await telephonyEnv();
    const contact = await seedContact(env);
    const deps = buildTelephonyDeps(env as unknown as Env);

    await deps.recordAck(contact.id, false, "dtmf:7");

    expect((await getContact(env, contact.id))?.status).toBe("queued");
    expect((await readEvents(env)).filter((event) => event.type === "contact.updated")).toHaveLength(1);
  });

  it("updateContactStatus appends the mapped status and never regresses an acknowledged contact", async () => {
    const env = await telephonyEnv();
    const contact = await seedContact(env);
    const deps = buildTelephonyDeps(env as unknown as Env);

    await deps.updateContactStatus(contact.id, "delivered", { callStatus: "completed", callSid: "CA9", durationSec: 12 });
    expect((await getContact(env, contact.id))?.status).toBe("delivered");

    // A late `completed` webhook must not overwrite the farmer's confirmation.
    await deps.recordAck(contact.id, true, "dtmf:1");
    await deps.updateContactStatus(contact.id, "failed", { callStatus: "busy" });
    expect((await getContact(env, contact.id))?.status).toBe("acknowledged");

    // An unknown contact is a no-op rather than a throw.
    await expect(deps.updateContactStatus("ct-nope", "failed")).resolves.toBeUndefined();
  });

  it("classify is System 1: the offline rules tier when no model key is set", async () => {
    const env = await telephonyEnv();
    const deps = buildTelephonyDeps(env as unknown as Env);

    const result = await deps.classify("నాకు అత్యవసరంగా నీళ్లు కావాలి");
    expect(result.intent).toBe("urgent_request");
    expect(result.source).toBe("rules");
  });

  it("cache is backed by the KV CACHE binding", async () => {
    const kv = new BinaryKV();
    const env = await telephonyEnv({ CACHE: kv });
    const deps = buildTelephonyDeps(env as unknown as Env);
    const bytes = new Uint8Array([82, 73, 70, 70, 9, 9]).buffer;

    expect(await deps.cache.get("missing")).toBeNull();
    await deps.cache.put("telephony:msg:c1:abc", bytes);
    expect([...new Uint8Array((await deps.cache.get("telephony:msg:c1:abc")) as ArrayBuffer)]).toEqual([82, 73, 70, 70, 9, 9]);
    expect(kv.map.has("telephony:msg:c1:abc")).toBe(true);
  });

  it("raiseRequest takes the same path as POST /api/requests", async () => {
    // The HTTP route, on a fresh env with the same seed.
    const viaHttp = await telephonyEnv();
    const httpRes = await call(app(), "POST", "/api/requests", {
      env: viaHttp,
      body: {
        farmer_id: "f1",
        type: "urgent",
        volume_m3: 0,
        reason: "నాకు అత్యవసరంగా నీళ్లు కావాలి",
        channel: "voice",
      },
    });
    expectStatus(httpRes, 200);

    // The telephony dep, on an identically seeded env.
    const viaVoice = await telephonyEnv();
    const deps = buildTelephonyDeps(viaVoice as unknown as Env);
    await deps.raiseRequest({
      farmerId: "f1",
      type: "urgent",
      reason: "నాకు అత్యవసరంగా నీళ్లు కావాలి",
      channel: "voice",
    });

    const shape = async (env: TestEnv) => {
      const events = await readEvents(env);
      return events
        .filter((event) => event.type === "request.raised" || event.type === "request.triaged")
        .map((event) =>
          event.type === "request.raised"
            ? {
                type: event.type,
                actor: event.actor,
                farmer_id: event.request.farmer_id,
                request_type: event.request.type,
                volume_m3: event.request.volume_m3,
                channel: event.request.channel,
                status: event.request.status,
                reason: event.request.reason,
              }
            : { type: event.type, actor: event.actor, intent: event.intent },
        );
    };

    // Same two events, same actors, same request fields — the voice path is not a second
    // implementation. `triage_score` is excluded only because the route's response is what proves it.
    expect(await shape(viaVoice)).toEqual(await shape(viaHttp));

    const raised = (await readEvents(viaVoice)).find((event) => event.type === "request.raised");
    expect(raised?.type === "request.raised" && raised.request.channel).toBe("voice");
    expect(raised?.type === "request.raised" && raised.request.volume_m3).toBe(0);

    // And it is visible through the read surface a coordinator uses.
    const requests = await call<unknown[]>(app(), "GET", "/api/requests", { env: viaVoice });
    expect(requests.body).toHaveLength(1);
    const stored = await getRequest(viaVoice, (requests.body[0] as { id: string }).id);
    expect(stored?.reason).toBe("నాకు అత్యవసరంగా నీళ్లు కావాలి");
  });

  it("raiseRequest ignores an unknown farmer instead of throwing into a webhook", async () => {
    const env = await telephonyEnv();
    const deps = buildTelephonyDeps(env as unknown as Env);
    await expect(
      deps.raiseRequest({ farmerId: "f-missing", type: "urgent", reason: "x", channel: "voice" }),
    ).resolves.toBeUndefined();
    expect((await readEvents(env)).filter((event) => event.type === "request.raised")).toHaveLength(0);
  });

  it("onTranscript persists the transcript onto the contact", async () => {
    const env = await telephonyEnv();
    const contact = await seedContact(env);
    const deps = buildTelephonyDeps(env as unknown as Env);

    await deps.onTranscript?.(contact.id, "నాకు నీళ్లు కావాలి", "sarvam");
    expect((await getContact(env, contact.id))?.transcript).toBe("నాకు నీళ్లు కావాలి");
  });
});

describe("mounted /api/telephony", () => {
  it("serves TwiML for a known contact through the real app", async () => {
    const env = await telephonyEnv();
    const contact = await seedContact(env);

    const res = await app().fetch(
      new Request(`https://api.jadal.test/api/telephony/twiml/${contact.id}`, { method: "GET" }),
      env as never,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const body = await res.text();
    // No Sarvam key in the test env, so the module falls back to Twilio's own Telugu `<Say>`.
    expect(body).toContain(`<Say language="te-IN">${contact.message_te}</Say>`);
    expect(body).toContain(`<Gather input="dtmf"`);
  });

  it("DTMF 1 reaches the store and acknowledges the contact", async () => {
    const env = await telephonyEnv();
    const contact = await seedContact(env);

    const res = await postForm(env, `/api/telephony/gather/${contact.id}`, { Digits: "1" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("<Hangup/>");
    expect((await getContact(env, contact.id))?.status).toBe("acknowledged");
  });

  it("keeps the module's own TwiML 404 and re-renders an unknown path as the ApiError shape", async () => {
    const env = await telephonyEnv();
    const missing = await app().fetch(
      new Request("https://api.jadal.test/api/telephony/twiml/ct-unknown", { method: "GET" }),
      env as never,
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("text/xml");

    const unknown = await call<{ error: { code: string } }>(app(), "GET", "/api/telephony/nope", { env });
    expectStatus(unknown, 404);
    expect(unknown.body.error.code).toBe("not_found");
  });

  it("refuses webhooks with no auth token configured when the skip flag is absent", async () => {
    const env = await telephonyEnv();
    const contact = await seedContact(env);
    delete (env as unknown as Record<string, unknown>)["SKIP_TWILIO_SIGNATURE"];

    const res = await postForm(env, `/api/telephony/gather/${contact.id}`, { Digits: "1" });
    expect(res.status).toBe(403);
    expect((await getContact(env, contact.id))?.status).toBe("queued");
  });
});
