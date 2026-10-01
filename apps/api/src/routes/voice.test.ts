/**
 * Voice-route tests.
 *
 * Both routes must work with **no API keys**, so these tests assert the fallback explicitly: an
 * unmocked provider URL throws in the harness, and `env.calls.length === 0` proves a code path made
 * no network request at all. Audio without a key degrades to the typed text (or to an empty
 * transcript), and `phoneReply` is delegated to the caller agent.
 */

import type { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { routes } from "@jadal/contracts";

import { createApp } from "../app";
import { call, createEnv, expectStatus, type FetchRoutes, type TestEnv } from "../../test/harness";
import { demoScenario, demoWeather, seedScenario, seedWeather } from "../../test/fixtures";

function app(): Hono<{ Bindings: TestEnv }> {
  return createApp() as unknown as Hono<{ Bindings: TestEnv }>;
}

async function demoEnv(fetchRoutes: FetchRoutes = {}): Promise<TestEnv> {
  const env = createEnv(fetchRoutes);
  const scenario = demoScenario();
  const weather = demoWeather();
  await seedScenario(env, scenario, weather);
  await seedWeather(env, weather, scenario.canal.id);
  return env;
}

/** Approve a roster so at least one queued contact exists, then return its id. */
async function firstContactId(env: TestEnv): Promise<string> {
  const app0 = app();
  const proposal = routes.proposeRoster.response.parse(
    (await call(app0, "POST", routes.proposeRoster.path, { env, body: { release_window_id: "rw1" } })).body,
  );
  await call(app0, "POST", `/api/rosters/${proposal.roster.id}/approve`, { env, body: {} });
  const contacts = routes.contacts.response.parse((await call(app0, "GET", routes.contacts.path, { env })).body);
  const contact = contacts[0];
  if (contact === undefined) throw new Error("expected the approved roster to queue at least one contact");
  return contact.id;
}

describe("POST /api/intake", () => {
  it("classifies typed text and raises a request for an urgent ask", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.intake.path, {
      env,
      body: { farmer_id: "f1", text: "urgent need water immediately 100 cubic metres" },
    });

    expectStatus(res, 200);
    const body = routes.intake.response.parse(res.body);
    expect(body.transcript_te).toBe("urgent need water immediately 100 cubic metres");
    expect(body.intent).toBe("urgent_request");
    expect(body.urgency).toBeGreaterThan(0);
    expect(body.request?.type).toBe("urgent");
    expect(body.request?.volume_m3).toBe(100);
    // No key: System 1 answered from the deterministic rules, never the network.
    expect(env.calls.length).toBe(0);
  });

  it("degrades audio with no key to an empty transcript and no request, without a network call", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.intake.path, {
      env,
      body: { farmer_id: "f1", audio_base64: "YXVkaW8=", mime: "audio/wav" },
    });

    expectStatus(res, 200);
    const body = routes.intake.response.parse(res.body);
    expect(body.transcript_te).toBe("");
    expect(body.request).toBeUndefined();
    expect(env.calls.length).toBe(0);
  });

  it("404s for an unknown farmer", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.intake.path, { env, body: { farmer_id: "nope", text: "hi" } });

    expectStatus(res, 404);
    expect(res.body).toHaveProperty("error.code");
  });

  it("400s on a body with no farmer id", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.intake.path, { env, body: { text: "hi" } });

    expectStatus(res, 400);
    expect(res.body).toHaveProperty("error.code");
  });
});

describe("POST /api/phone/:contactId/reply", () => {
  it("delegates a typed reply to the caller agent and records the acknowledgement", async () => {
    const env = await demoEnv();
    const contactId = await firstContactId(env);

    const res = await call(app(), "POST", `/api/phone/${contactId}/reply`, {
      env,
      body: { text: "yes I will be there" },
    });

    expectStatus(res, 200);
    const body = routes.phoneReply.response.parse(res.body);
    expect(body.contact.id).toBe(contactId);
    expect(body.contact.status).toBe("acknowledged");
    expect(body.agent_reply_te.length).toBeGreaterThan(0);
    expect(body.agent_reply_en.length).toBeGreaterThan(0);
    // No Sarvam key → text-only reply, no network.
    expect(body.audio_base64).toBeUndefined();
    expect(env.calls.length).toBe(0);
  });

  it("404s for an unknown contact", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", "/api/phone/nope/reply", { env, body: { text: "hello" } });

    expectStatus(res, 404);
    expect(res.body).toHaveProperty("error.code");
  });
});
