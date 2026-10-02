/**
 * `POST /api/alerts` — the coordinator's "Alert the farmer" action (task B, task 2 critical path).
 *
 * This is the endpoint the coordinator console calls when a coordinator decides to alert a farmer
 * directly, rather than the alert being a side effect of approving a request. It is the same outbound
 * call, reached from the coordinator's own action.
 *
 * ## SAFETY — no real call can be placed from this file
 *
 * Every test drives `test/harness.ts`'s `createEnv(routes)`, whose injected `fetch` **throws** on any
 * URL that is not explicitly routed. The Twilio endpoint is a canned `Response`. The offline cases
 * additionally assert `env.calls.length === 0`, so "nothing dialled" is proven structurally rather
 * than assumed.
 *
 * ## The frozen shape, exercised exactly as the web lane sends it
 *
 *   POST /api/alerts
 *   { farmer_id, channel: "call"|"sms"|"whatsapp", severity, message?, allocation? }
 *   -> 200 { ok, contact_id, simulated, detail }
 */

import type { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createApp } from "./app";
import { ALERT_CHANNELS, ALERT_SEVERITIES, ALERTS_PATH, type AlertResponseBody } from "./alerts";
import { listContacts } from "./db/repo";
import { call, createEnv, createTestDb, expectOk, expectStatus, type FetchCall, type TestEnv } from "../test/harness";
import { seedScenario } from "../test/fixtures";

/** A complete Twilio credential set, so `placeCall` really attempts a (mocked) dial. */
const TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-auth-token",
  TWILIO_FROM_NUMBER: "+15005550006",
  PUBLIC_BASE_URL: "https://api.jadal.test",
} as const;
const TWILIO_ACCEPTED = { sid: "CA" + "0".repeat(32), status: "queued" };
/** f1's registered number in the seed scenario. */
const F1_PHONE = "+919000000001";

function app(): Hono<{ Bindings: TestEnv }> {
  return createApp() as unknown as Hono<{ Bindings: TestEnv }>;
}

async function seededEnv(routes: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<TestEnv> {
  const env = createEnv(routes);
  env.DB = await createTestDb();
  await seedScenario(env);
  return Object.assign(env, extra);
}

function twilioCalls(env: TestEnv): FetchCall[] {
  return env.calls.filter((candidate) => candidate.url.includes("api.twilio.com"));
}

/** Post one alert and return the parsed frozen-shape response. */
async function postAlert(
  env: TestEnv,
  body: unknown,
): Promise<{ status: number; body: AlertResponseBody; headers: Headers }> {
  return call<AlertResponseBody>(app(), "POST", ALERTS_PATH, { env, body });
}

describe("POST /api/alerts — the coordinator alerts a farmer directly", () => {
  /**
   * The safety property that matters most now that `REAL_TELEPHONY=true` and a real
   * `COORDINATOR_PHONE` are configured on the development machine: the suite must not be able to
   * reach a handset. `createEnv` injects a `fetch` that throws on anything unrouted, and
   * `placeCall` only ever uses the injected one — so an un-stubbed dial fails loudly instead of
   * ringing. Pinned here because this is exactly the property a later refactor could quietly break.
   */
  it("cannot reach the real network: the injected fetch is never the global one", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
    expect(env.fetch).not.toBe(globalThis.fetch);
    expect(env.fetch).not.toBe(fetch);

    // And an unrouted destination throws rather than escaping to the runtime fetch.
    await expect(env.fetch("https://api.some-other-provider.test/v1/send")).rejects.toThrow(/Unmocked outbound fetch/);
  });

  it("places the call from the coordinator's action, with the allocation volume and window spoken", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });

    const response = expectOk(
      await postAlert(env, {
        farmer_id: "f1",
        channel: "call",
        severity: "urgent",
        allocation: { volume_m3: 120, start: "2026-09-15T00:30:00Z", end: "2026-09-16T00:30:00Z" },
      }),
    );

    // The frozen response shape, exactly.
    expect(Object.keys(response).sort()).toEqual(["contact_id", "detail", "ok", "simulated"]);
    expect(response.ok).toBe(true);
    expect(response.simulated).toBe(false);
    expect(response.contact_id).toMatch(/^contact_/);
    expect(response.detail).toContain(F1_PHONE);

    // One real call, to the farmer's registered number, carrying the request id the audit row uses.
    const dialled = twilioCalls(env);
    expect(dialled.length).toBe(1);
    const body = new URLSearchParams(String((dialled[0] as FetchCall).body ?? ""));
    expect(body.get("To")).toBe(F1_PHONE);
    expect(body.get("Url")).toBe(`https://api.jadal.test/api/telephony/twiml/${response.contact_id}`);

    // The spoken text states the allocated volume AND the window from which to use it, in Telugu and
    // English — the requirement the frozen shape attaches to `allocation` on a `call`.
    const contact = (await listContacts(env))[0];
    expect(contact?.id).toBe(response.contact_id);
    expect(contact?.channel).toBe("voice");
    expect(contact?.status).toBe("sent");
    expect(contact?.message_te).toContain("120 ఘన మీటర్లు");
    expect(contact?.message_te).toContain("06:00");
    expect(contact?.message_te).toMatch(/[\u0C00-\u0C7F]/);
    expect(contact?.message_en).toContain("120 cubic metres");
    expect(contact?.message_en).toContain("06:00");
    expect(contact?.message_en).toContain("IST");
  });

  it("speaks the volume with no time clause when the allocation carries no window", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
    const response = expectOk(
      await postAlert(env, { farmer_id: "f1", channel: "call", severity: "warning", allocation: { volume_m3: 75 } }),
    );
    expect(response.simulated).toBe(false);

    const contact = (await listContacts(env))[0];
    expect(contact?.message_en).toContain("75 cubic metres");
    // Degrades to a shorter, still-true sentence rather than inventing a window or printing `undefined`.
    expect(contact?.message_en).not.toContain("undefined");
    expect(contact?.message_en).not.toContain("Invalid Date");
  });

  it("includes the coordinator's own message verbatim, and still speaks when only a severity is given", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
    const withNote = expectOk(
      await postAlert(env, {
        farmer_id: "f1",
        channel: "call",
        severity: "info",
        message: "Please check your field gate.",
      }),
    );
    expect(withNote.simulated).toBe(false);
    const contact = (await listContacts(env))[0];
    expect(contact?.message_te).toContain("Please check your field gate.");
    expect(contact?.message_en).toContain("Please check your field gate.");

    // A severity with no allocation and no free-text message is still a real, sayable alert: the
    // severity's own wording is what the farmer hears. The UI defaults to exactly this (a severity
    // and an empty message), so refusing to dial here made the coordinator's Alert button look
    // broken. The call goes out, and it carries the severity's template.
    const severityOnly = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
    const spoken = expectOk(await postAlert(severityOnly, { farmer_id: "f1", channel: "call", severity: "info" }));
    expect(spoken.simulated).toBe(false);
    expect(spoken.contact_id).not.toBe("");
    expect(twilioCalls(severityOnly).length).toBe(1);
    const told = (await listContacts(severityOnly))[0];
    expect(told?.message_te.length).toBeGreaterThan(0);
    expect(told?.message_en.length).toBeGreaterThan(0);
    expect(told?.message_en).not.toContain("Invalid Date");
  });

  it("accepts every severity and channel in the frozen shape", async () => {
    // Every alert below carries an allocation or a message, because an alert with neither has nothing
    // true to say and is refused by the "nothing to tell" guard (covered in its own test above).
    for (const severity of ALERT_SEVERITIES) {
      const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
      const response = expectOk(
        await postAlert(env, {
          farmer_id: "f1",
          channel: "call",
          severity,
          allocation: { volume_m3: 10, start: "2026-09-15T00:30:00Z" },
        }),
      );
      expect(response.ok).toBe(true);
      expect(response.simulated).toBe(false);
    }

    for (const channel of ALERT_CHANNELS) {
      const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
      const response = expectOk(
        await postAlert(env, {
          farmer_id: "f1",
          channel,
          severity: "warning",
          allocation: { volume_m3: 10, start: "2026-09-15T00:30:00Z" },
        }),
      );
      expect(response.ok).toBe(true);
      if (channel === "call") continue;
      // No messaging transport is dispatched: audited as queued, reported simulated, and nothing dialled.
      expect(response.simulated).toBe(true);
      expect(response.detail.toLowerCase()).toContain("not sent");
      expect(response.detail).toContain(`no ${channel} transport`);
      expect(twilioCalls(env).length).toBe(0);
      expect((await listContacts(env))[0]?.status).toBe("queued");
      // The queued message still carries the allocation, so the coordinator's list shows what was meant.
      expect((await listContacts(env))[0]?.message_te).toContain("10 ఘన మీటర్లు");
    }
  });

  it("never describes an sms or whatsapp alert as sent, placed or delivered", async () => {
    for (const channel of ["sms", "whatsapp"] as const) {
      // Twilio env is fully configured and a Twilio route is available: if this
      // endpoint ever grew a transport by accident, the test would see the call.
      const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
      const response = expectOk(
        await postAlert(env, {
          farmer_id: "f1",
          channel,
          severity: "urgent",
          allocation: { volume_m3: 20, start: "2026-09-15T00:30:00Z" },
        }),
      );

      expect(response.simulated).toBe(true);
      // The two existing response fields carry the whole truth, unambiguously.
      expect(response.detail).toContain("NOT SENT");
      expect(response.detail).toContain(`no ${channel} transport exists in this app`);
      expect(response.detail).toContain("nothing reached the farmer");
      // It must not claim any dispatch verb for the channel.
      expect(response.detail).not.toMatch(/placed|delivered|sent to/i);
      // And structurally: no outbound fetch at all, and the audit row is queued.
      expect(twilioCalls(env).length).toBe(0);
      expect((await listContacts(env))[0]?.status).toBe("queued");
    }
  });

  it("keeps a real call's detail free of the not-sent wording", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
    const response = expectOk(
      await postAlert(env, {
        farmer_id: "f1",
        channel: "call",
        severity: "urgent",
        allocation: { volume_m3: 20, start: "2026-09-15T00:30:00Z" },
      }),
    );
    expect(response.simulated).toBe(false);
    expect(response.detail).not.toContain("NOT SENT");
    expect(response.detail).toContain("call placed to");
  });

  it("is simulated:true with no fetch at all when Twilio env is absent", async () => {
    const env = await seededEnv();
    const response = expectOk(
      await postAlert(env, {
        farmer_id: "f1",
        channel: "call",
        severity: "urgent",
        allocation: { volume_m3: 120, start: "2026-09-15T00:30:00Z" },
      }),
    );

    expect(response.simulated).toBe(true);
    expect(response.detail).toContain("simulated");
    // Nothing was fetched at all, so nothing was dialled (ADR-003).
    expect(env.calls.length).toBe(0);
    // The alert is still audited, so the coordinator's trail shows what was attempted.
    expect(response.contact_id).toMatch(/^contact_/);
    expect((await listContacts(env))[0]?.status).toBe("failed");
  });

  it("reports a Twilio refusal honestly instead of claiming the call went out", async () => {
    const env = await seededEnv(
      {
        "api.twilio.com": new Response(JSON.stringify({ message: "Unverified number" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      },
      { ...TWILIO_ENV },
    );
    const response = expectOk(
      await postAlert(env, {
        farmer_id: "f1",
        channel: "call",
        severity: "urgent",
        allocation: { volume_m3: 120, start: "2026-09-15T00:30:00Z" },
      }),
    );

    expect(response.ok).toBe(true);
    expect(response.simulated).toBe(false);
    expect(response.detail).toContain("failed");
    expect((await listContacts(env))[0]?.status).toBe("failed");
    expect(env.calls.length).toBe(twilioCalls(env).length);
  });

  it("404s an unknown farmer and 400s a malformed body", async () => {
    const env = await seededEnv();

    expectStatus(await postAlert(env, { farmer_id: "nobody", channel: "call", severity: "info" }), 404);
    expectStatus(await postAlert(env, { farmer_id: "f1", channel: "call", severity: "bogus" }), 400);
    expectStatus(await postAlert(env, { farmer_id: "f1", channel: "email", severity: "info" }), 400);
    expectStatus(await postAlert(env, { channel: "call", severity: "info" }), 400);
    expectStatus(await postAlert(env, { farmer_id: "f1", channel: "call", severity: "info", allocation: { volume_m3: "lots" } }), 400);
    // A malformed window is refused rather than spoken as a bad time.
    expectStatus(
      await postAlert(env, { farmer_id: "f1", channel: "call", severity: "info", allocation: { volume_m3: 5, start: "yesterday" } }),
      400,
    );
    expect(env.calls.length).toBe(0);
  });

  it("appends exactly one contact.updated event per alert, through appendEvent", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
    await postAlert(env, {
      farmer_id: "f1",
      channel: "call",
      severity: "urgent",
      allocation: { volume_m3: 120, start: "2026-09-15T00:30:00Z" },
    });

    const { readEvents } = await import("./db/store");
    const events = (await readEvents(env)).filter((event) => event.type === "contact.updated");
    expect(events.length).toBe(1);
    const event = events[0];
    if (event === undefined || event.type !== "contact.updated") throw new Error("no contact.updated event");
    expect(event.actor).toEqual({ kind: "agent", id: "caller" });
    expect(event.contact.farmer_id).toBe("f1");
    expect(event.contact.message_te).toContain("120 ఘన మీటర్లు");
  });
});
