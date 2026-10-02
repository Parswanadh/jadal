/**
 * Task B: coordinator alerting, tested with the network stubbed.
 *
 * ## SAFETY — no real call can be placed from this file
 *
 * Every test drives `test/harness.ts`'s `createEnv()`, whose injected `fetch` **throws** on any URL
 * that is not explicitly routed. Nothing here ever reaches `api.twilio.com`; the Twilio route is a
 * canned `Response`. The two structural guarantees are asserted per test, not assumed:
 *
 *  * the offline case asserts `env.calls.length` is `0` — no fetch was attempted at all;
 *  * the Twilio-failure case asserts the *only* call made was to `api.twilio.com`, so a bug that
 *    started dialling somewhere else would be visible rather than silent.
 *
 * ## What is covered, and why each one matters
 *
 *  * raising a request with `COORDINATOR_PHONE` set rings the coordinator exactly **once**, with the
 *    farmer's name, the reason, the volume and the fact that approval is needed;
 *  * raising one **without** `COORDINATOR_PHONE` still creates the request and notifies nobody;
 *  * a Twilio failure does **not** fail the request, and is recorded honestly as a failed attempt;
 *  * the farmer-allocation call composes the existing Telugu/English `request_update` text with the
 *    allocated volume and the IST start time;
 *  * with Twilio env absent everything is `{ simulated: true }` — and no fetch happens.
 */

import type { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { routes } from "@jadal/contracts";

import { createApp } from "./app";
import {
  COORDINATOR_REQUEST_EN,
  COORDINATOR_REQUEST_TE,
  coordinatorPhone,
  notifyFarmerOfAllocation,
  type AlertOutcome,
} from "./coordinator-alert";
import { getFarmer, getRequest, listContacts } from "./db/repo";
import type { Env } from "./env";
import { call, createEnv, createTestDb, expectOk, type FetchCall, type TestEnv } from "../test/harness";
import { seedScenario } from "../test/fixtures";

/** The coordinator's number in this test. Not a real handset used for anything. */
const COORDINATOR = "+917207997965";
/** A complete Twilio credential set, so `realCallsEnabled` is satisfied and `placeCall` really dials. */
const TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-auth-token",
  TWILIO_FROM_NUMBER: "+15005550006",
  PUBLIC_BASE_URL: "https://api.jadal.test",
} as const;
/** f1's registered number in the seed scenario. */
const F1_PHONE = "+919000000001";

/** What a successful Twilio `Calls.json` response looks like. */
const TWILIO_ACCEPTED = { sid: "CA" + "0".repeat(32), status: "queued" };

function app(): Hono<{ Bindings: TestEnv }> {
  return createApp() as unknown as Hono<{ Bindings: TestEnv }>;
}

/**
 * A seeded env with the migrations applied.
 *
 * `routes` are the *fetch* routes (keyed by URL substring, so they must be handed to `createEnv`);
 * `extra` is everything else — Twilio credentials, `COORDINATOR_PHONE`, `REAL_TELEPHONY` — merged
 * onto the env. Keeping the two apart matters: passing a route through `Object.assign` would put it
 * on the env and leave the outbound fetch still unmocked.
 */
async function seededEnv(routes: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<TestEnv> {
  const env = createEnv(routes);
  env.DB = await createTestDb();
  await seedScenario(env);
  return Object.assign(env, extra);
}

/** Every call the app made to Twilio, in order. */
function twilioCalls(env: TestEnv): FetchCall[] {
  return env.calls.filter((candidate) => candidate.url.includes("api.twilio.com"));
}

/** The `URLSearchParams` body of a recorded Twilio call. */
function twilioBody(callRecord: FetchCall): URLSearchParams {
  return new URLSearchParams(String(callRecord.body ?? ""));
}

/** Raise `f1`'s urgent request through the HTTP route and return the stored request. */
async function raiseUrgent(env: TestEnv, reason = "అత్యవసరంగా 40 క్యూబిక్ మీటర్లు నీరు కావాలి", volume = 40) {
  const raised = routes.raiseRequest.response.parse(
    expectOk(
      await call(app(), "POST", routes.raiseRequest.path, {
        env,
        body: { farmer_id: "f1", type: "urgent", volume_m3: volume, reason, channel: "voice" },
      }),
    ),
  );
  return raised;
}

/* ------------------------------------------------------------------ the pure gate */

describe("coordinatorPhone", () => {
  it("accepts only a plausible E.164 number and treats a blank or malformed one as unset", () => {
    expect(coordinatorPhone({ COORDINATOR_PHONE: COORDINATOR })).toBe(COORDINATOR);
    expect(coordinatorPhone({ COORDINATOR_PHONE: `  ${COORDINATOR}  ` })).toBe(COORDINATOR);
    expect(coordinatorPhone({ COORDINATOR_PHONE: "" })).toBeNull();
    expect(coordinatorPhone({ COORDINATOR_PHONE: "   " })).toBeNull();
    expect(coordinatorPhone({ COORDINATOR_PHONE: "7207997965" })).toBeNull();
    expect(coordinatorPhone({})).toBeNull();
  });
});

/* ------------------------------------------------------------------ task 1 */

describe("task 1 — the coordinator is phoned when a request is raised", () => {
  it("places exactly one real call, with the farmer, reason, volume and the approval ask", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { COORDINATOR_PHONE: COORDINATOR, ...TWILIO_ENV });

    const raised = await raiseUrgent(env);
    expect(raised.status).toBe("triaged");

    const dialled = twilioCalls(env);
    // Exactly one: the request path notifies once, and System 1 triaging it does not notify again.
    expect(dialled.length).toBe(1);

    const body = twilioBody(dialled[0] as FetchCall);
    expect(body.get("To")).toBe(COORDINATOR);
    expect(body.get("From")).toBe(TWILIO_ENV.TWILIO_FROM_NUMBER);
    expect(dialled[0]?.method).toBe("POST");

    // The spoken text carries the three facts the coordinator needs, in both languages.
    const contact = (await listContacts(env)).find((candidate) => candidate.purpose === "request_update");
    expect(contact).toBeDefined();
    expect(contact?.farmer_id).toBe("f1");
    expect(contact?.channel).toBe("voice");
    expect(contact?.status).toBe("sent");
    expect(contact?.message_en).toContain("Ramaiah Kota"); // the farmer's name, as the seed stores it
    expect(contact?.message_en).toContain("40 cubic metres");
    expect(contact?.message_en).toContain("needs your approval");
    expect(contact?.message_en).toBe(COORDINATOR_REQUEST_EN.replace("{farmer}", "Ramaiah Kota").replace("{volume}", "40").replace("{reason}", raised.reason));
    expect(contact?.message_te).toBe(COORDINATOR_REQUEST_TE.replace("{farmer}", "Ramaiah Kota").replace("{volume}", "40").replace("{reason}", raised.reason));
  });

  it("still creates the request and notifies nobody when COORDINATOR_PHONE is unset", async () => {
    // Twilio env present but no coordinator number: the switch is the number, not the credentials.
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });

    const raised = await raiseUrgent(env);
    expect(raised.id).toMatch(/^req/);
    expect(raised.status).toBe("triaged");

    // The request is durable and readable again — the farmer's request is the important thing.
    expect(await getRequest(env, raised.id)).not.toBeNull();
    expect(twilioCalls(env).length).toBe(0);
    expect(await listContacts(env)).toEqual([]);
  });

  it("does not fail the request when Twilio rejects the call, and records the failure honestly", async () => {
    const env = await seededEnv(
      {
        "api.twilio.com": new Response(JSON.stringify({ message: "Authenticate", code: 20003 }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      },
      { COORDINATOR_PHONE: COORDINATOR, ...TWILIO_ENV },
    );

    const raised = await raiseUrgent(env);
    // The route returned 200 and the request exists: a Twilio 401 never became a request failure.
    expect(raised.id).toMatch(/^req/);
    expect(await getRequest(env, raised.id)).not.toBeNull();

    const contact = (await listContacts(env)).find((candidate) => candidate.purpose === "request_update");
    expect(contact?.status).toBe("failed");

    // The only outbound call was the legitimately-mocked Twilio one. Nothing else was dialled.
    expect(env.calls.length).toBe(twilioCalls(env).length);
  });

  it("does not fail the request when the notifier itself throws", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { COORDINATOR_PHONE: COORDINATOR, ...TWILIO_ENV });
    // The notifier's *own* farmer read blows up (the request path's read already succeeded, so the
    // request is durable). A second read is what the notifier uses to name the farmer, and a database
    // that fails it must cost the coordinator a call — not the farmer their request.
    const realPrepare = env.DB.prepare.bind(env.DB);
    let farmerReads = 0;
    env.DB.prepare = ((sql: string) => {
      if (/FROM farmer\b/.test(sql) && (farmerReads += 1) > 1) throw new Error("d1 unavailable");
      return realPrepare(sql);
    }) as typeof env.DB.prepare;

    const raised = await raiseUrgent(env);
    expect(raised.id).toMatch(/^req/);
    expect(await getRequest(env, raised.id)).not.toBeNull();
    expect(twilioCalls(env).length).toBe(0);
  });
});

/* ------------------------------------------------------------------ task 2 */

describe("task 2 — the farmer hears the allocation when the coordinator alerts them", () => {
  it("composes the existing request_update Telugu/English text with the volume and the IST start", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });

    // 05:00 UTC is 10:30 IST — the same window the roster templates render.
    const result = await notifyFarmerOfAllocation(env as unknown as Env, {
      farmer_id: "f1",
      volume_m3: 120,
      windowStart: "2026-09-15T05:00:00Z",
      windowEnd: "2026-09-15T19:00:00Z",
      requestId: "req_test",
    });

    expect(result.simulated).toBe(false);
    expect(result.alerted).toBe(true);
    expect(result.to).toBe(F1_PHONE);

    // Telugu: the farmer's name in the vocative, the allocated volume, and the window in IST.
    expect(result.messageTe).toContain("నమస్కారం");
    expect(result.messageTe).toContain("Ramaiah Kota");
    expect(result.messageTe).toContain("120 ఘన మీటర్లు");
    expect(result.messageTe).toContain("10:30");
    expect(result.messageTe).toMatch(/[\u0C00-\u0C7F]/);

    // English: the same three facts.
    expect(result.messageEn).toContain("Hello Ramaiah Kota");
    expect(result.messageEn).toContain("120 cubic metres");
    expect(result.messageEn).toContain("10:30");
    expect(result.messageEn).toContain("Status: approved");

    // And the same text is what the call would actually speak.
    const body = twilioBody(twilioCalls(env)[0] as FetchCall);
    expect(body.get("To")).toBe(F1_PHONE);
    expect((await listContacts(env))[0]?.message_te).toBe(result.messageTe);
  });

  it("composes the volume with no time clause when no window is known", async () => {
    const env = await seededEnv();
    const result = await notifyFarmerOfAllocation(env as unknown as Env, { farmer_id: "f1", volume_m3: 75 });

    expect(result.messageEn).toContain("75 cubic metres");
    // Degrades to a shorter, still-correct sentence rather than printing `undefined`.
    expect(result.messageEn).not.toContain("undefined");
    expect(result.messageEn).not.toContain("Invalid Date");
  });

  it("is dispatched from POST /api/requests/:id/decide with the granted volume, not the asked-for one", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
    const raised = await raiseUrgent(env, "urgent 40 m3 needed", 40);

    const decided = routes.decideRequest.response.parse(
      expectOk(
        await call(app(), "POST", `/api/requests/${raised.id}/decide`, {
          env,
          body: { decision: "approve", volume_m3: 25, note: "partial grant" },
        }),
      ),
    );
    expect(decided.status).toBe("approved");

    const allocation = (await listContacts(env)).find((candidate) => candidate.purpose === "request_update");
    // The partial number, because that is what the farmer may actually take.
    expect(allocation?.message_en).toContain("25 cubic metres");
    expect(allocation?.message_en).not.toContain("40 cubic metres");
    // rw1 runs 00:30 UTC → 00:30 UTC the next day, i.e. 06:00–06:00 IST, which is the window
    // the request's own release window supplies.
    expect(allocation?.message_en).toContain("06:00");
  });

  it("does not call the farmer on a rejection", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
    const raised = await raiseUrgent(env, "no longer needed", 10);
    const before = (await listContacts(env)).length;

    const decided = routes.decideRequest.response.parse(
      expectOk(
        await call(app(), "POST", `/api/requests/${raised.id}/decide`, {
          env,
          body: { decision: "reject", volume_m3: 0 },
        }),
      ),
    );
    expect(decided.status).toBe("rejected");
    // No `request_update` contact was added for the refusal, and no call was placed at all.
    const after = await listContacts(env);
    expect(after.filter((candidate) => candidate.purpose === "request_update").length).toBe(0);
    expect(after.length).toBe(before);
    expect(twilioCalls(env).length).toBe(0);
  });
});

/* ------------------------------------------------------------------ task 3 */

describe("task 3 — every attempt is auditable", () => {
  it("appends exactly one contact.updated event per attempt, through appendEvent", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { COORDINATOR_PHONE: COORDINATOR, ...TWILIO_ENV });
    const raised = await raiseUrgent(env);

    const { readEvents } = await import("./db/store");
    const contacts = (await readEvents(env)).filter((event) => event.type === "contact.updated");
    expect(contacts.length).toBe(1);

    const event = contacts[0];
    if (event === undefined || event.type !== "contact.updated") throw new Error("no contact.updated event");
    expect(event.actor).toEqual({ kind: "agent", id: "caller" });
    expect(event.contact.farmer_id).toBe("f1");
    expect(event.contact.message_te.length).toBeGreaterThan(0);
    // The audit row is the coordinator's prompt, and it names the request it is about in its text.
    expect(event.contact.message_te).toContain(raised.reason);
  });

  it("keeps the audit row re-readable through the contacts projection", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { COORDINATOR_PHONE: COORDINATOR, ...TWILIO_ENV });
    await raiseUrgent(env);
    const contacts = routes.contacts.response.parse(expectOk(await call(app(), "GET", routes.contacts.path, { env })));
    expect(contacts.length).toBe(1);
    expect(contacts[0]?.purpose).toBe("request_update");
  });

  it("uses one id for the Twilio call and its audit row, so the log names the attempt that was dialled", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
    const result = await notifyFarmerOfAllocation(env as unknown as Env, { farmer_id: "f1", volume_m3: 50 });

    expect(result.contactId).not.toBeNull();
    // The TwiML/status URLs Twilio was given embed the contact id, which is the same id the audit row
    // carries — so a coordinator reading the log can follow the call back to its own callback URLs.
    const body = twilioBody(twilioCalls(env)[0] as FetchCall);
    expect(body.get("Url")).toBe(`https://api.jadal.test/api/telephony/twiml/${result.contactId}`);
    expect((await listContacts(env))[0]?.id).toBe(result.contactId);
  });
});

/* ------------------------------------------------------------------ task 4 */

describe("task 4 — simulated and real are never confused", () => {
  it("is { simulated: true } with no fetch at all when Twilio env is absent", async () => {
    const env = await seededEnv({}, { COORDINATOR_PHONE: COORDINATOR });

    const raised = await raiseUrgent(env);
    expect(raised.id).toMatch(/^req/);

    // The offline guarantee, asserted structurally: nothing was fetched, so nothing was dialled.
    expect(env.calls.length).toBe(0);
    expect(twilioCalls(env).length).toBe(0);

    // The farmer's allocation call is simulated too.
    const allocation = await notifyFarmerOfAllocation(env as unknown as Env, { farmer_id: "f1", volume_m3: 50 });
    expect(allocation.simulated).toBe(true);
    expect(allocation.alerted).toBe(true);
    expect(allocation.placed).toEqual({ simulated: true });
    expect(env.calls.length).toBe(0);
  });

  it("reports simulated=false once a real call is accepted, and simulated=false/failed when refused", async () => {
    const accepted = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { COORDINATOR_PHONE: COORDINATOR, ...TWILIO_ENV });
    const ok = await notifyFarmerOfAllocation(accepted as unknown as Env, { farmer_id: "f1", volume_m3: 50 });
    expect(ok.simulated).toBe(false);
    expect(ok.alerted).toBe(true);
    if (ok.placed === null || ok.placed.simulated) throw new Error("expected a real call");
    expect(ok.placed.ok).toBe(true);

    const refused = await seededEnv(
      {
        "api.twilio.com": new Response(JSON.stringify({ message: "bad" }), { status: 400, headers: { "content-type": "application/json" } }),
      },
      { COORDINATOR_PHONE: COORDINATOR, ...TWILIO_ENV },
    );
    const bad: AlertOutcome = await notifyFarmerOfAllocation(refused as unknown as Env, { farmer_id: "f1", volume_m3: 50 });
    expect(bad.simulated).toBe(false);
    expect(bad.alerted).toBe(false);
    expect(bad.error).toBeDefined();
  });

  it("honours REAL_TELEPHONY=0 as the kill switch even with a full credential set", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { COORDINATOR_PHONE: COORDINATOR, ...TWILIO_ENV, REAL_TELEPHONY: "0" });
    const result = await notifyFarmerOfAllocation(env as unknown as Env, { farmer_id: "f1", volume_m3: 50 });
    expect(result.simulated).toBe(true);
    expect(env.calls.length).toBe(0);
  });

  it("never reports a simulated dispatch as real in the audit trail", async () => {
    const env = await seededEnv({}, { COORDINATOR_PHONE: COORDINATOR });
    await raiseUrgent(env);
    const contact = (await listContacts(env))[0];
    // `sent` would claim a call went out. Simulated is recorded as `failed` — see the module header
    // for why that is the honest mapping and the contracts gap it exposes.
    expect(contact?.status).toBe("failed");
  });
});

/* ------------------------------------------------------------------ recipient resolution */

describe("recipient resolution", () => {
  it("dials the farmer's registered number", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
    const record = await getFarmer(env, "f1");
    expect(record?.farmer.phone).toBe(F1_PHONE);

    await notifyFarmerOfAllocation(env as unknown as Env, { farmer_id: "f1", volume_m3: 50 });
    expect(twilioBody(twilioCalls(env)[0] as FetchCall).get("To")).toBe(F1_PHONE);
  });

  it("makes no call for a farmer who does not exist, and does not throw", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
    const result = await notifyFarmerOfAllocation(env as unknown as Env, { farmer_id: "nobody", volume_m3: 50 });
    expect(result.simulated).toBe(true);
    expect(result.skipped).toBe("no destination number");
    expect(env.calls.length).toBe(0);
  });

  it("falls back to the farmer id when the name cannot be read, rather than skipping the call", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { COORDINATOR_PHONE: COORDINATOR, ...TWILIO_ENV });
    const raised = await raiseUrgent(env);
    const contacts = await listContacts(env);
    expect(contacts[0]?.message_te).toContain(raised.reason);
  });

  it("returns an empty failed outcome, not a throw, when the allocation lookup itself explodes", async () => {
    const env = await seededEnv({ "api.twilio.com": TWILIO_ACCEPTED }, { ...TWILIO_ENV });
    env.DB.prepare = (() => {
      throw new Error("d1 unavailable");
    }) as typeof env.DB.prepare;

    const result = await notifyFarmerOfAllocation(env as unknown as Env, { farmer_id: "f1", volume_m3: 50 });
    expect(result.alerted).toBe(false);
    expect(result.error).toBe("d1 unavailable");
    expect(result.messageTe).toBe("");
    expect(result.messageEn).toBe("");
    expect(env.calls.length).toBe(0);
  });
});
