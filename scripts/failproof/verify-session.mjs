#!/usr/bin/env node
/**
 * Read one session back out of Failproof AI Cloud and print its ordered timeline.
 *
 *   node scripts/failproof/verify-session.mjs jadal-compliant-abc123
 *   node scripts/failproof/verify-session.mjs jadal-compliant-abc123 --json
 *
 * This is the "did the session actually arrive" check. It calls `GET /v1/events` on the Cloud API —
 * the same endpoint the dashboard's session view reads — with the `events:add` key, so a session
 * printed here is a session Cloud stored, not a session a local file claims was emitted.
 *
 * The key is read from the gitignored `.dev.vars` and never printed.
 */

import { describeKey, loadKey } from "./key-file.mjs";

const DEFAULT_CLOUD_URL = "https://app.befailproof.ai";

function parseArgs(argv) {
  const out = { sessionId: null, json: false, url: DEFAULT_CLOUD_URL, keyFile: null, limit: 200 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--url") out.url = argv[++i];
    else if (arg === "--key-file") out.keyFile = argv[++i];
    else if (arg === "--limit") out.limit = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (!arg.startsWith("--")) out.sessionId = arg;
    else throw new Error(`unknown option: ${arg}`);
  }
  return out;
}

/** One readable line per event, without dumping whole payloads. */
function describe(event) {
  const payload = event.payload ?? event;
  const bits = [];
  for (const key of ["tool_name", "hook_name", "model", "outcome", "error_type", "stop_reason", "intent", "urgency", "fw_source", "fw_request_id", "fw_flow"]) {
    const value = payload[key];
    if (value !== undefined && value !== null) bits.push(`${key}=${typeof value === "object" ? JSON.stringify(value) : value}`);
  }
  return bits.join(" ");
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.sessionId === null) {
  process.stdout.write(
    "usage: node scripts/failproof/verify-session.mjs <session-id> [--json] [--limit N] [--url <base>] [--key-file <path>]\n",
  );
  process.exit(args.help ? 0 : 64);
}

let key;
try {
  key = loadKey(args.keyFile);
} catch (error) {
  process.stderr.write(`verify-session: ${error.message}\n`);
  process.exit(66);
}

const endpoint = new URL(`${args.url.replace(/\/$/, "")}/v1/events`);
endpoint.searchParams.set("session_id", args.sessionId);
endpoint.searchParams.set("order", "asc");
endpoint.searchParams.set("limit", String(args.limit));

let response;
try {
  response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${key.value}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
} catch (error) {
  process.stderr.write(`verify-session: unreachable ${endpoint.origin}: ${error?.message ?? error}\n`);
  process.exit(1);
}

const text = await response.text();
if (!response.ok) {
  process.stderr.write(`verify-session: HTTP ${response.status} from ${endpoint.pathname}\n${text.slice(0, 400)}\n`);
  process.exit(1);
}

let body;
try {
  body = JSON.parse(text);
} catch {
  process.stderr.write(`verify-session: response was not JSON\n${text.slice(0, 400)}\n`);
  process.exit(1);
}

const events = Array.isArray(body) ? body : (body.events ?? []);
process.stdout.write(`verify-session: ${describeKey(key)}\n`);
process.stdout.write(`verify-session: session ${args.sessionId} — ${events.length} event(s) in Cloud\n\n`);

if (args.json) {
  process.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
} else {
  const counts = new Map();
  for (const event of events) {
    const type = event.type ?? event.payload?.type ?? "unknown";
    counts.set(type, (counts.get(type) ?? 0) + 1);
    const at = event.timestamp ?? event.ts ?? "";
    const agent = event.agent_id ?? event.payload?.agent_id ?? "";
    process.stdout.write(`${at}  ${String(type).padEnd(16)} ${String(agent).padEnd(26)} ${describe(event)}\n`);
  }
  process.stdout.write("\n");
  for (const [type, count] of [...counts.entries()].sort()) {
    process.stdout.write(`  ${String(count).padStart(3)}  ${type}\n`);
  }
}

process.exit(events.length === 0 ? 1 : 0);
