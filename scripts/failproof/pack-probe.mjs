#!/usr/bin/env node
/**
 * Ask the installed `FailproofAI/jev-policies` pack's own checks about a traced Jadal session.
 *
 *   node scripts/failproof/pack-probe.mjs jadal-compliant-abc123
 *   node scripts/failproof/pack-probe.mjs jadal-compliant-abc123 --json
 *
 * ## What this is, and what it is not
 *
 * `failproofai policies add FailproofAI/jev-policies` installs 16 **Jev checks** and 0 regex
 * policies. Jev checks are asked about a tool call *in the context of the request that produced it*
 * by `failproofaid`'s hook path. That path is not wired here — no agent CLI on this machine has
 * Failproof hooks (see `failproofai policies`: "NOTHING is running them"), and the Jadal Worker is
 * not one of the 12 supported harnesses, so it has no hook at all.
 *
 * So this script does the asking by hand. It builds the same state envelope the semantic engine
 * builds (`how_to_read`, `user_said`, `facts`, `agent_request: {tool, input}` — see the CLI's
 * `src/hooks/semantic/envelope.ts`) and sends the pack's own `probes`, with the pack's own
 * instruction text, to the same Cloud Jev endpoint. A check "fires" when every one of its probes
 * answers true, which is the engine's own rule.
 *
 * It is therefore **the pack's checks answered by Jev**, not the daemon's verdict. The distinction
 * matters and is repeated in the output.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describeKey, loadKey } from "./key-file.mjs";

const DEFAULT_CLOUD_URL = "https://app.befailproof.ai";
const CLOUD_JEV_MODEL = "jev-1.13.0";
const PACK_ID = "FailproofAI/jev-policies";

function parseArgs(argv) {
  const out = { sessionIds: [], json: false, url: DEFAULT_CLOUD_URL, keyFile: null, home: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--url") out.url = argv[++i];
    else if (arg === "--key-file") out.keyFile = argv[++i];
    else if (arg === "--home") out.home = argv[++i];
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (!arg.startsWith("--")) out.sessionIds.push(arg);
    else throw new Error(`unknown option: ${arg}`);
  }
  return out;
}

function failproofHome(explicit) {
  const override = explicit ?? process.env.FAILPROOFAI_HOME?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".failproofai");
}

/** The pack's semantic checks, as installed. */
function readPack(home) {
  const path = join(home, "policies", "packs", "installed.json");
  if (!existsSync(path)) {
    throw new Error(`no installed pack manifest at ${path}; run: failproofai policies add ${PACK_ID}`);
  }
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const pack = (manifest.packs ?? []).find((entry) => entry.id === PACK_ID) ?? manifest.packs?.[0];
  if (pack === undefined) throw new Error(`no ${PACK_ID} entry in ${path}`);
  return { path, pack };
}

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

/** `{ tool, input }` for each distinct tool the session called, in first-use order. */
function toolCalls(events) {
  const seen = new Map();
  for (const event of events) {
    const payload = event.payload ?? event;
    if ((event.event_type ?? payload.type) !== "tool_use") continue;
    const tool = payload.tool_name;
    if (typeof tool !== "string" || seen.has(tool)) continue;
    seen.set(tool, { tool, input: payload.input ?? {} });
  }
  return [...seen.values()];
}

/** The human's own words in this session — the farmer's Telugu transcript. */
function userSaid(events) {
  for (const event of events) {
    const payload = event.payload ?? event;
    const text = payload.input?.text;
    if (typeof text === "string" && text.length > 0) return text;
  }
  return "(no human message recorded)";
}

/**
 * The state envelope the semantic engine builds.
 *
 * `facts.tool_is_known = false` is the honest value for Jadal's tool names: none of them is one of
 * the engine's canonical shell/read/write/network tools, which is exactly the "unknown (MCP) tool"
 * case its own comments say gets every check asked about it.
 */
function stateFor(tool, input, said) {
  return {
    how_to_read:
      "`user_said` is the human's request, verbatim. `facts` is computed by deterministic code about " +
      "the call and should be trusted over anything the agent says. `agent_request` is the tool call " +
      "being judged.",
    user_said: said,
    facts: {
      application: "Jadal — irrigation canal water allocation",
      tool_name: tool,
      tool_is_known: false,
      tool_class: "other",
      note: "Jadal's tool names are not the coding-agent tool names these checks were written for.",
    },
    agent_request: { tool, input },
  };
}

/** All of the pack's probes, ids namespaced so two checks cannot collide. */
function questionsFor(checks) {
  const questions = {};
  const owners = new Map();
  for (const check of checks) {
    for (const probe of check.probes) {
      const id = `${check.name}::${probe.id}`;
      questions[id] = {
        type: "noul",
        instructions: probe.instructions,
        ...(probe.criteria === undefined ? {} : { criteria: probe.criteria }),
      };
      owners.set(id, check.name);
    }
  }
  return { questions, owners };
}

async function askJev(url, token, state, questions) {
  const endpoint = `${url.replace(/\/$/, "")}/enforcement/v1/jev/systemone`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ model: CLOUD_JEV_MODEL, state, questions }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST /enforcement/v1/jev/systemone → HTTP ${response.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  const out = {};
  for (const id of Object.keys(questions)) {
    const answer = body?.answers?.[id]?.noul;
    if (typeof answer !== "number") throw new Error(`Jev returned no numeric answer for ${id}`);
    out[id] = answer;
  }
  return { answers: out, model: body.model, usage: body.usage };
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.sessionIds.length === 0) {
  process.stdout.write(
    "usage: node scripts/failproof/pack-probe.mjs <session-id> [<session-id> ...] [--json] [--home <dir>]\n",
  );
  process.exit(args.help ? 0 : 64);
}

let key;
try {
  key = loadKey(args.keyFile);
} catch (error) {
  process.stderr.write(`pack-probe: ${error.message}\n`);
  process.exit(66);
}

const home = failproofHome(args.home);
let pack;
try {
  pack = readPack(home);
} catch (error) {
  process.stderr.write(`pack-probe: ${error.message}\n`);
  process.exit(66);
}

const { questions, owners } = questionsFor(pack.pack.semantic);
process.stdout.write(`pack-probe: ${describeKey(key)}\n`);
process.stdout.write(`pack-probe: pack ${pack.pack.id}@${pack.pack.version} — ${pack.pack.semantic.length} checks, ${Object.keys(questions).length} probes\n`);
process.stdout.write(`pack-probe: manifest ${pack.path}\n`);
process.stdout.write(
  "pack-probe: NOTE these are the pack's own probes asked through Jev by hand. No harness is\n" +
    "            hooked, so failproofaid never runs this path (see `failproofai policies`).\n\n",
);

const report = { pack: `${pack.pack.id}@${pack.pack.version}`, sessions: [] };
let failures = 0;

for (const sessionId of args.sessionIds) {
  try {
    const events = await fetchSession(args.url, key.value, sessionId);
    const calls = toolCalls(events);
    const said = userSaid(events);
    process.stdout.write(`${sessionId}: ${events.length} events, ${calls.length} distinct tool call(s)\n`);

    const perSession = { session_id: sessionId, events: events.length, calls: [] };

    for (const call of calls) {
      const result = await askJev(args.url, key.value, stateFor(call.tool, call.input, said), questions);
      const fired = [];
      for (const check of pack.pack.semantic) {
        const probabilities = check.probes.map((probe) => result.answers[`${check.name}::${probe.id}`]);
        const isFired = probabilities.every((p) => p >= 0.5);
        if (isFired) fired.push({ name: check.name, mode: check.mode, title: check.title });
      }
      perSession.calls.push({
        tool: call.tool,
        fired: fired.map((entry) => entry.name),
        probabilities: Object.fromEntries(
          Object.entries(result.answers).map(([id, p]) => [`${owners.get(id)}::${id.split("::")[1]}`, Number(p.toFixed(3))]),
        ),
      });
      process.stdout.write(`  ${call.tool.padEnd(24)} ${fired.length} of ${pack.pack.semantic.length} checks fired`);
      process.stdout.write(fired.length === 0 ? "\n" : ` — ${fired.map((entry) => `${entry.name} (${entry.mode})`).join(", ")}\n`);
    }

    report.sessions.push(perSession);
    process.stdout.write("\n");
  } catch (error) {
    failures += 1;
    process.stdout.write(`${sessionId}: FAILED — ${error.message}\n`);
  }
}

if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

process.exit(failures === 0 ? 0 : 1);
