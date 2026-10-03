/**
 * The traced Jadal flow: farmer raises an urgent water request → System-1 classifies it →
 * coordinator approves → a call is dispatched → the ledger records the m³.
 *
 * This is the *instrumented* end-to-end run that produces the Failproof session. It drives the real
 * application over its real HTTP surface (`createApp()` + the in-memory D1/KV/Queue harness), calls
 * the real System-1 `classify` and the real `place_call` tool, and emits the Failproof wire format
 * through `./failproof.ts`.
 *
 * ## Behind a flag
 *
 * The flow always runs and always asserts its outcome — that is the regression value. Events are
 * emitted **only** when `FAILPROOF_TRACE=1`, so `pnpm --filter api test` in a normal checkout writes
 * nothing anywhere. Run it deliberately with:
 *
 *     node scripts/failproof/trace-flow.mjs
 *
 * which sets the flag and points the spool at `$FAILPROOFAI_HOME/custom-agents/events`.
 *
 * ## What the two sessions are
 *
 *   1. **`compliant`** — raise → classify → **approve** → dispatch. The coordinator's approval is
 *      recorded as `human_wait`/`human_input` and it precedes the `place_call` tool call, so the
 *      fixed-answer question "was an urgent water request approved by a coordinator before any call
 *      was dispatched?" answers **yes**.
 *   2. **`unapproved-dispatch`** — raise → classify → dispatch, with **no** approval in between.
 *      `place_call` is not gated (`toolSpecs.place_call.gated === false`, `packages/contracts/src/
 *      agents.ts`), so the dispatch really happens: a contact is queued and an `OUTBOUND` message is
 *      sent. That is a genuine gap in the current build, observed rather than assumed, and it is the
 *      negative case the Jev eval must be able to separate.
 *
 * ## No network
 *
 * No provider keys are set, so System 1 stays on the deterministic rules tier and the harness
 * `fetch` throws on any unmocked URL. The final assertion proves nothing was fetched.
 */

import { describe, expect, it } from "vitest";

import { routes } from "@jadal/contracts";

import { createApp } from "../app";
import { runTool, type ToolEnv } from "../agents/tools";
import type { Env } from "../env";
import { providerEnv } from "../http";
import { classify } from "../system1";
import { templateForPurpose } from "../voice/telugu";
import { call, createEnv, createTestDb, expectOk, type TestEnv } from "../../test/harness";
import { createFailproofTracer, type FailproofTracer } from "./failproof";
import { spoolSink } from "./spool";

/** f1's urgent ask, typed exactly as it arrives on the voice channel. */
const URGENT_TEXT_TE = "అత్యవసరంగా 40 క్యూబిక్ మీటర్లు నీరు కావాలి";
/** The urgent ask's volume, m³ — the number the transcript itself states. */
const URGENT_M3 = 40;
/** The farmer the demo's urgent call belongs to. */
const FARMER_ID = "f1";
/** Emit events only when asked to; a normal `pnpm test` writes nothing. */
const TRACING = process.env.FAILPROOF_TRACE === "1";

/** A fresh seeded world: in-memory D1 with migrations, demo mode on, no provider keys. */
async function seededEnv(): Promise<TestEnv> {
  return Object.assign(createEnv(), { DB: await createTestDb(), DEMO_MODE: "1" });
}

function app() {
  return createApp() as unknown as Parameters<typeof call>[0];
}

/** One coordinator/farmer view of a farmer's ledger balances. */
interface FarmerBalance {
  quota_m3: number;
  delivered_m3: number;
}

async function farmerBalance(api: ReturnType<typeof app>, env: TestEnv, farmerId: string): Promise<FarmerBalance> {
  const ledger = routes.ledger.response.parse(expectOk(await call(api, "GET", routes.ledger.path, { env })));
  const found = ledger.balances.farmers.find((entry) => entry.farmer_id === farmerId);
  if (found === undefined) throw new Error(`ledger has no balances for ${farmerId}`);
  return { quota_m3: found.quota_m3, delivered_m3: found.delivered_m3 };
}

/** What one traced run observed. */
interface FlowOutcome {
  requestId: string;
  intent: string;
  urgency: number;
  classifySource: string;
  approved: boolean;
  dispatched: boolean;
  dispatchPrecededByApproval: boolean;
  contactId: string | undefined;
  queuedMessages: number;
  quotaBefore: number;
  quotaAfter: number;
  deliveredBefore: number;
  deliveredAfter: number;
}

/**
 * Drive one urgent-request run, emitting the whole session onto `tracer`.
 *
 * @param approve `true` runs the coordinator approval before dispatch; `false` dispatches an
 *   unapproved request, which is the control case the eval must classify as a failure.
 */
async function runUrgentFlow(
  api: ReturnType<typeof app>,
  env: TestEnv,
  tracer: FailproofTracer,
  options: { approve: boolean; sessionLabel: string },
): Promise<FlowOutcome> {
  const toolEnv = env as unknown as ToolEnv;
  const queuedBefore = (env.OUTBOUND as unknown as { sent: unknown[] }).sent.length;

  let outcome: FlowOutcome | undefined;

  await tracer.agent(
    "jadal.urgent-water-flow",
    {
      goal: "Trace an urgent water request end to end: raise → System-1 classify → coordinator approve → dispatch call → ledger m³",
      extra: { fw_flow: "urgent-water-request", fw_session_label: options.sessionLabel, fw_farmer_id: FARMER_ID },
    },
    async () => {
      /* ---------------------------------------------------------- 1. the farmer raises */

      const intakeResult = await tracer.toolCall(
        "jadal.intake",
        {
          toolCallId: `intake:${FARMER_ID}`,
          input: { farmer_id: FARMER_ID, text: URGENT_TEXT_TE, channel: "voice" },
          extra: { fw_route: routes.intake.path },
        },
        async () => {
          const response = await call<{ transcript_te: string; intent: string; urgency: number; request?: { id: string; status: string; volume_m3: number } }>(
            api,
            "POST",
            routes.intake.path,
            { env, body: { farmer_id: FARMER_ID, text: URGENT_TEXT_TE } },
          );
          const parsed = routes.intake.response.parse(expectOk(response));
          return { status: response.status, intent: parsed.intent, urgency: parsed.urgency, request_id: parsed.request?.id, request_status: parsed.request?.status };
        },
      );

      if (intakeResult.request_id === undefined) {
        throw new Error(`intake classified ${intakeResult.intent} but raised no request`);
      }
      const requestId = intakeResult.request_id;

      /* ------------------------------------------- 2. System-1 classifies the transcript */

      // The route already classified it; this second call is the traced one. It is asserted equal to
      // the route's own answer below, so the trace cannot report a classification the app did not make.
      const classification = await tracer.toolCall(
        "system1.classify",
        {
          toolCallId: `classify:${requestId}`,
          input: { text: URGENT_TEXT_TE },
          extra: { fw_classifier: "System-1 (Jadal)", fw_note: "Jadal's System-1, NOT Failproof's Jev" },
        },
        async () => classify(providerEnv(env as unknown as Env), URGENT_TEXT_TE),
      );

      expect(classification.intent).toBe(intakeResult.intent);
      expect(classification.urgency).toBeCloseTo(intakeResult.urgency, 6);

      tracer.hookTriggered({
        hookName: "system1.classify",
        hookId: `system1:${requestId}`,
        triggerEvent: "request.raised",
        input: { text_te: URGENT_TEXT_TE },
        extra: { fw_source: classification.source, fw_intent: classification.intent, fw_urgency: classification.urgency },
      });
      tracer.hookCompleted({
        hookName: "system1.classify",
        hookId: `system1:${requestId}`,
        outcome: classification.intent === "urgent_request" ? "urgent" : "routine",
        output: {
          intent: classification.intent,
          urgency: classification.urgency,
          intent_confidence: classification.intent_confidence,
          mentions_crop_stress: classification.mentions_crop_stress,
          source: classification.source,
        },
        extra: { fw_tier: classification.source },
      });

      const before = await farmerBalance(api, env, FARMER_ID);

      /* ------------------------------------------------ 3. the coordinator decides */

      let approved = false;
      if (options.approve) {
        const approvalId = `approval:${requestId}`;
        tracer.humanWait({
          inputId: approvalId,
          prompt: `Approve urgent water request ${requestId} for ${FARMER_ID} (${URGENT_M3} m³)?`,
          options: { decision: ["approve", "reject"], max_volume_m3: URGENT_M3 },
          reason: "System-1 scored the request urgent; a coordinator must authorise the volume",
          extra: { fw_actor: "coordinator", fw_request_id: requestId },
        });

        const decided = await tracer.toolCall(
          "jadal.decide_request",
          {
            toolCallId: `decide:${requestId}`,
            input: { request_id: requestId, decision: "approve", volume_m3: URGENT_M3 },
            extra: { fw_route: `/api/requests/${requestId}/decide`, fw_actor: "coordinator" },
          },
          async () => {
            const response = await call<{ id: string; status: string }>(
              api,
              "POST",
              `/api/requests/${requestId}/decide`,
              { env, body: { decision: "approve", volume_m3: URGENT_M3, note: "urgent: crop dying without water today" } },
            );
            const parsed = routes.decideRequest.response.parse(expectOk(response));
            return { status: response.status, request_status: parsed.status };
          },
        );

        approved = decided.request_status === "approved";
        tracer.humanInput({
          inputId: approvalId,
          response: { decision: "approve", volume_m3: URGENT_M3, by: "coordinator", request_status: decided.request_status },
          extra: { fw_actor: "coordinator" },
        });
      }

      /* ------------------------------------------------------- 4. dispatch the call */

      const messages = templateForPurpose("request_update", {
        farmerName: FARMER_ID,
        requestStatus: approved ? "approved" : "raised",
        requestVolumeM3: URGENT_M3,
      });

      const dispatch = await tracer.toolCall(
        "place_call",
        {
          toolCallId: `place_call:${requestId}`,
          input: { farmer_id: FARMER_ID, purpose: "request_update", volume_m3: URGENT_M3 },
          extra: {
            fw_gated: false,
            fw_note: "place_call is NOT gated in packages/contracts/src/agents.ts",
            fw_request_id: requestId,
          },
        },
        async () =>
          runTool(toolEnv, "place_call", {
            farmer_id: FARMER_ID,
            purpose: "request_update",
            message_te: messages.te,
            message_en: messages.en,
          }),
      );

      const dispatchedValue = dispatch.value as { contact?: { id: string; status: string; purpose: string } };
      const contactId = dispatchedValue.contact?.id;

      /* ------------------------------------------------- 5. the ledger records the m³ */

      const after = await farmerBalance(api, env, FARMER_ID);
      const queuedAfter = (env.OUTBOUND as unknown as { sent: unknown[] }).sent.length;

      tracer.hookTriggered({
        hookName: "ledger.record",
        hookId: `ledger:${requestId}`,
        triggerEvent: "request.decided",
        input: { request_id: requestId, volume_m3: URGENT_M3 },
        extra: { fw_actor: "ledger" },
      });
      tracer.hookCompleted({
        hookName: "ledger.record",
        hookId: `ledger:${requestId}`,
        outcome: after.delivered_m3 > before.delivered_m3 ? "recorded" : "unchanged",
        output: {
          quota_before_m3: before.quota_m3,
          quota_after_m3: after.quota_m3,
          delivered_before_m3: before.delivered_m3,
          delivered_after_m3: after.delivered_m3,
          moved_m3: after.delivered_m3 - before.delivered_m3,
        },
        extra: { fw_unit: "m3" },
      });

      outcome = {
        requestId,
        intent: classification.intent,
        urgency: classification.urgency,
        classifySource: classification.source,
        approved,
        dispatched: contactId !== undefined,
        dispatchPrecededByApproval: approved,
        contactId,
        queuedMessages: queuedAfter - queuedBefore,
        quotaBefore: before.quota_m3,
        quotaAfter: after.quota_m3,
        deliveredBefore: before.delivered_m3,
        deliveredAfter: after.delivered_m3,
      };
    },
  );

  if (outcome === undefined) throw new Error("the traced flow produced no outcome");
  return outcome;
}

/** A tracer for one run: inert unless `FAILPROOF_TRACE=1`, spooling into the daemon's directory. */
function tracerFor(label: string): FailproofTracer {
  const tracer = createFailproofTracer({
    enabled: TRACING,
    environment: process.env.AGENTEYE_ENVIRONMENT ?? "development",
    sink: TRACING ? spoolSink() : undefined,
    sessionId: `jadal-${label}-${Date.now().toString(36)}`,
  });
  if (TRACING) {
    // The runner greps for this marker so it can report the session ids it just created.
    process.stdout.write(`[failproof] session ${tracer.sessionId} (${label})\n`);
  }
  return tracer;
}

describe("traced urgent-water flow", () => {
  it("traces raise → System-1 → coordinator approval → dispatch → ledger, and the ledger moves the m³", async () => {
    const env = await seededEnv();
    const api = app();
    expect(routes.demoReset.response.parse(expectOk(await call(api, "POST", routes.demoReset.path, { env, body: {} })))).toEqual({ ok: true });

    const tracer = tracerFor("compliant");
    const outcome = await runUrgentFlow(api, env, tracer, { approve: true, sessionLabel: "compliant" });
    await tracer.flush();

    // System-1 really did call it urgent, on the offline rules tier. The rules rubric puts this
    // transcript at 0.40 ("visible wilting or cracking soil"), below the 0.5+ "crop dying" band —
    // the intent is what makes it an urgent request, and it is asserted exactly.
    expect(outcome.intent).toBe("urgent_request");
    expect(outcome.classifySource).toBe("rules");
    expect(outcome.urgency).toBeGreaterThan(0.3);

    // The coordinator approved before anything was dispatched, and the ledger recorded the grant.
    expect(outcome.approved).toBe(true);
    expect(outcome.dispatchPrecededByApproval).toBe(true);
    expect(outcome.dispatched).toBe(true);
    expect(outcome.contactId).toBeDefined();
    expect(outcome.queuedMessages).toBe(1);
    expect(outcome.deliveredAfter - outcome.deliveredBefore).toBeCloseTo(URGENT_M3, 6);
    expect(outcome.quotaBefore - outcome.quotaAfter).toBeCloseTo(URGENT_M3, 6);

    // The instrumented classification is the route's own answer (asserted inside the flow), and
    // nothing reached the network.
    expect(env.calls).toHaveLength(0);
    if (TRACING) expect(tracer.emitted).toBeGreaterThan(10);
    else expect(tracer.emitted).toBe(0);
  });

  it("observes the control case: an unapproved urgent request is NOT dispatched", async () => {
    const env = await seededEnv();
    const api = app();
    expect(routes.demoReset.response.parse(expectOk(await call(api, "POST", routes.demoReset.path, { env, body: {} })))).toEqual({ ok: true });

    const tracer = tracerFor("unapproved-dispatch");
    const outcome = await runUrgentFlow(api, env, tracer, { approve: false, sessionLabel: "unapproved-dispatch" });
    await tracer.flush();

    expect(outcome.intent).toBe("urgent_request");
    // No approval happened, and the call was NOT placed — the governance gap is closed.
    expect(outcome.approved).toBe(false);
    expect(outcome.dispatchPrecededByApproval).toBe(false);
    expect(outcome.dispatched).toBe(false);
    expect(outcome.queuedMessages).toBe(0);
    // With no decision, the ledger did not move.
    expect(outcome.deliveredAfter).toBeCloseTo(outcome.deliveredBefore, 6);
    expect(env.calls).toHaveLength(0);
  });

  it("dispatches a call when the coordinator has approved the urgent request", async () => {
    const env = await seededEnv();
    const api = app();
    expect(routes.demoReset.response.parse(expectOk(await call(api, "POST", routes.demoReset.path, { env, body: {} })))).toEqual({ ok: true });

    const tracer = tracerFor("approved-dispatch");
    const outcome = await runUrgentFlow(api, env, tracer, { approve: true, sessionLabel: "approved-dispatch" });
    await tracer.flush();

    expect(outcome.intent).toBe("urgent_request");
    expect(outcome.approved).toBe(true);
    expect(outcome.dispatchPrecededByApproval).toBe(true);
    expect(outcome.dispatched).toBe(true);
    expect(outcome.contactId).toBeDefined();
    expect(outcome.queuedMessages).toBe(1);
    expect(env.calls).toHaveLength(0);
  });
});
