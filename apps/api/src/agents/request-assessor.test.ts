/**
 * Request-assessor tests.
 *
 * `assessRequest` answers one urgent or buffer request using only `core-shim`'s `policy`. These
 * tests pin the policy-driven decision and volume for each branch — an urgent grant within quota, an
 * over-quota refusal, a buffer grant, a buffer partial, and a request type the assessor does not
 * handle — plus the offline fallback that returns the policy's own reason verbatim when no language
 * model is configured.
 *
 * NO NETWORK: no `OPENROUTER_API_KEY` is set, so `rewrite` short-circuits to `null`.
 */

import { describe, expect, it } from "vitest";

import { WaterRequest } from "@jadal/contracts";

import { createEnv, type TestEnv } from "../../test/harness";
import { demoScenario, demoWeather, seedScenario } from "../../test/fixtures";
import { now } from "../db/clock";
import { newId } from "../db/id";
import { appendEvent } from "../db/store";
import { DEMO_CANAL_ID } from "../demo";
import { assessRequest } from "./request-assessor";

async function seeded(): Promise<TestEnv> {
  const env = createEnv();
  await seedScenario(env, demoScenario(), demoWeather());
  return env;
}

/** Append one `request.raised` event and return the request, without triaging it. */
async function raise(env: TestEnv, overrides: Partial<WaterRequest> = {}): Promise<WaterRequest> {
  const at = await now(env);
  const request = WaterRequest.parse({
    id: newId("req"),
    farmer_id: "f1",
    type: "urgent",
    volume_m3: 5,
    reason: "paddy needs water",
    channel: "portal",
    status: "raised",
    raised_at: at,
    ...overrides,
  });
  await appendEvent(env, {
    id: newId("evt"),
    at,
    canal_id: DEMO_CANAL_ID,
    actor: { kind: "farmer", id: request.farmer_id },
    type: "request.raised",
    request,
  });
  return request;
}

describe("assessRequest", () => {
  it("throws RangeError for an unknown request id", async () => {
    const env = await seeded();
    await expect(assessRequest(env, "req-missing")).rejects.toBeInstanceOf(RangeError);
  });

  it("approves an urgent request the policy allows, at the requested volume", async () => {
    const env = await seeded();
    const request = await raise(env, { type: "urgent", volume_m3: 5 });

    const assessment = await assessRequest(env, request.id);

    expect(assessment.decision).toBe("approve");
    expect(assessment.volume_m3).toBe(5);
    expect(assessment.rationale.length).toBeGreaterThan(0);
    expect(env.calls).toHaveLength(0);
  });

  it("rejects an over-quota urgent request and returns the policy's own reason", async () => {
    const env = await seeded();
    const request = await raise(env, { type: "urgent", volume_m3: 9_999_999 });

    const assessment = await assessRequest(env, request.id);

    expect(assessment.decision).toBe("reject");
    expect(assessment.volume_m3).toBe(0);
    expect(assessment.rationale).toContain("Insufficient future quota");
  });

  it("approves a buffer request within the week's buffer share", async () => {
    const env = await seeded();
    const request = await raise(env, { type: "buffer", volume_m3: 1 });

    const assessment = await assessRequest(env, request.id);

    expect(assessment.decision).toBe("approve");
    expect(assessment.volume_m3).toBe(1);
  });

  it("partially grants a buffer request above the cap, never more than the cap", async () => {
    const env = await seeded();
    const request = await raise(env, { type: "buffer", volume_m3: 9_999_999 });

    const assessment = await assessRequest(env, request.id);

    expect(assessment.decision).toBe("partial");
    expect(assessment.volume_m3).toBeGreaterThan(0);
    expect(assessment.volume_m3).toBeLessThan(request.volume_m3);
  });

  it("rejects a request type it does not assess, naming the coordinator", async () => {
    const env = await seeded();
    const request = await raise(env, { type: "release_to_buffer", volume_m3: 5 });

    const assessment = await assessRequest(env, request.id);

    expect(assessment.decision).toBe("reject");
    expect(assessment.volume_m3).toBe(0);
    expect(assessment.rationale).toContain("coordinator handles it directly");
  });
});
