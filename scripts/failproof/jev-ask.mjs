#!/usr/bin/env node
/**
 * Ask Jev (Failproof AI Cloud) the fixed-answer question about one or more traced sessions.
 *
 *   node scripts/failproof/jev-ask.mjs jadal-compliant-abc123 jadal-unapproved-dispatch-def456
 *   node scripts/failproof/jev-ask.mjs --jsonl ~/.failproofai/custom-agents/events/event-....jsonl
 *
 * ## What this is
 *
 * Failproof's **Jev** is a classifier-backed eval/policy engine reached with a Failproof API key.
 * A *Jev eval* is "one fixed-answer question, scored by a classifier". Authoring one is currently
 * a dashboard flow (`Analyze → eval authoring → new eval`), and the Cloud API exposes only
 * `GET /evaluations` — there is no create endpoint and this key has no `evaluations:write`. So this
 * script does the part that can be done from here: it puts the real session in front of the real
 * Jev classifier with the exact question the eval would carry, and reports the probability.
 *
 * The request is the same one `failproofai jev test` sends — `POST <cloud>/enforcement/v1/jev/
 * systemone` with `{ model, state, questions }` and the `noul` (calibrated yes/no) primitive — so
 * an answer here is an answer from Jev, not a local heuristic.
 *
 * **Jev here is Failproof's Jev. It is NOT Jadal's System-1 "Jev"** (`typesafe/jev-router` over
 * OpenRouter, reached by `apps/api/src/system1.ts`), which does Jadal's urgent/routine triage. The
 * two share a name and nothing else.
 *
 * The question, its id and the decision threshold live in `jev-eval.json` next to this file, so the
 * script and the dashboard-authored eval cannot drift apart.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describeKey, loadKey } from "./key-file.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLOUD_URL = "https://app.befailproof.ai";
/** The Cloud Jev route's model id, as `failproofai jev status` reports it. */
const CLOUD_JEV_MODEL = "jev-1.13.0";

function parseArgs(argv) {
  const out = { sessionIds: [], jsonl: null, url: DEFAULT_CLOUD_URL, keyFile: null, showState: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--jsonl") out.jsonl = argv[++i];
    else if (arg === "--url") out.url = argv[++i];
    else if (arg === "--key-file") out.keyFile = argv[++i];
    else if (arg === "--show-state") out.showState = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (!arg.startsWith("--")) out.sessionIds.push(arg);
    else throw new Error(`unknown option: ${arg}`);
  }
  return out;
}

const spec = JSON.parse(readFileSync(join(HERE, "jev-eval.json"), "utf8"));

/** GET one session's events from Cloud, in order. */
async function fetchSession(url, token, sessionId) {
  const endpoint = new URL(`${url.replace(/\/$/, "")}/v1/events`);
  endpoint.searchParams.set("session_id", sessionId);
  endpoint.searchParams.set("order", "asc");
  endpoint.searchParams.set("limit", "200");
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GET /v1/events?session_id=${sessionId} → HTTP ${response.status}`);
  const body = await response.json();
  return Array.isArray(body) ? body : (body.events ?? []);
}

/** Read a local spool batch and keep one session's lines, in file order. */
function readJsonlSession(path, sessionId) {
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  return sessionId === null ? lines : lines.filter((event) => event.session_id === sessionId);
}

/** The evidence Jev reads: the ordered events, trimmed to the fields that carry the decision. */
function stateFor(sessionId, events) {
  return {
    session_id: sessionId,
    application: "Jadal — an irrigation-canal water allocation service for Andhra Pradesh farmers",
    vocabulary: {
      "human_wait / human_input": "a human coordinator being asked, and answering, about a request",
      "jadal.decide_request": "the coordinator's decision being applied (its output carries request_status)",
      "place_call": "the caller agent dispatching a phone call to the farmer — this IS the call dispatch",
      "system1.classify": "Jadal's own System-1 triage of the farmer's transcript",
      "ledger.record": "the double-entry ledger recording the cubic metres",
      "request_status=approved": "the coordinator approved the request",
      "request_status=raised": "the request exists but no coordinator has decided it",
    },
    events: events.map((event) => {
      const payload = event.payload ?? event;
      const out = {
        timestamp: event.ts ?? payload.timestamp,
        type: event.event_type ?? payload.type,
        agent_id: event.agent_id ?? payload.agent_id,
      };
      for (const key of [
        "tool_name",
        "tool_call_id",
        "hook_name",
        "hook_id",
        "outcome",
        "error",
        "summary",
        "goal",
        "input",
        "output",
        "response",
        "prompt",
        "reason",
        "intent",
        "urgency",
        "source",
        "fw_request_id",
        "fw_flow",
      ]) {
        if (payload[key] !== undefined && payload[key] !== null) out[key] = payload[key];
      }
      return out;
    }),
  };
}

async function askJev(url, token, questionId, question, state) {
  const endpoint = `${url.replace(/\/$/, "")}/enforcement/v1/jev/systemone`;
  const started = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ model: CLOUD_JEV_MODEL, state, questions: { [questionId]: question } }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST /enforcement/v1/jev/systemone → HTTP ${response.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  const answer = body?.answers?.[questionId]?.noul;
  if (typeof answer !== "number") throw new Error(`Jev returned no numeric answer for ${questionId}: ${text.slice(0, 300)}`);
  return { probability: answer, model: body.model, usage: body.usage, latencyMs: Date.now() - started };
}

const args = parseArgs(process.argv.slice(2));
if (args.help || (args.sessionIds.length === 0 && args.jsonl === null)) {
  process.stdout.write(
    "usage: node scripts/failproof/jev-ask.mjs <session-id> [<session-id> ...] [--show-state]\n" +
      "       node scripts/failproof/jev-ask.mjs --jsonl <path> [<session-id>] [--show-state]\n",
  );
  process.exit(args.help ? 0 : 64);
}

let key;
try {
  key = loadKey(args.keyFile);
} catch (error) {
  process.stderr.write(`jev-ask: ${error.message}\n`);
  process.exit(66);
}
process.stdout.write(`jev-ask: ${describeKey(key)}\n`);
process.stdout.write(`jev-ask: question id ${spec.question_id} — "${spec.question}"\n`);
process.stdout.write(`jev-ask: provider FailproofAI Cloud, model ${CLOUD_JEV_MODEL}, threshold ${spec.threshold}\n\n`);

let failures = 0;

if (args.jsonl !== null) {
  const events = readJsonlSession(args.jsonl, args.sessionIds[0] ?? null);
  const sessionId = args.sessionIds[0] ?? events[0]?.session_id ?? "(unknown)";
  const state = stateFor(sessionId, events);
  if (args.showState) process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  const result = await askJev(args.url, key.value, spec.question_id, spec.question_spec, state);
  const verdict = result.probability >= spec.threshold ? spec.answer_true : spec.answer_false;
  process.stdout.write(
    `${sessionId}: p = ${result.probability.toFixed(3)} → ${verdict} (${result.latencyMs}ms, ${result.usage?.input_tokens ?? "?"} input tokens)\n`,
  );
} else {
  for (const sessionId of args.sessionIds) {
    try {
      const events = await fetchSession(args.url, key.value, sessionId);
      if (events.length === 0) {
        process.stdout.write(`${sessionId}: no events in Cloud\n`);
        failures += 1;
        continue;
      }
      const state = stateFor(sessionId, events);
      if (args.showState) process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
      const result = await askJev(args.url, key.value, spec.question_id, spec.question_spec, state);
      const verdict = result.probability >= spec.threshold ? spec.answer_true : spec.answer_false;
      process.stdout.write(
        `${sessionId}: p = ${result.probability.toFixed(3)} → ${verdict} (${events.length} events, ${result.latencyMs}ms, ${result.usage?.input_tokens ?? "?"} input tokens)\n`,
      );
    } catch (error) {
      failures += 1;
      process.stdout.write(`${sessionId}: FAILED — ${error.message}\n`);
    }
  }
}

process.exit(failures === 0 ? 0 : 1);
