#!/usr/bin/env node
/**
 * Ship the local Failproof spool to Failproof AI Cloud through the documented ingest API.
 *
 *   node scripts/failproof/ship-spool.mjs            # ship every batch, then move it aside
 *   node scripts/failproof/ship-spool.mjs --dry-run  # list what would be shipped, send nothing
 *   node scripts/failproof/ship-spool.mjs --keep     # ship, leave the batch files in place
 *
 * ## Why this exists
 *
 * Normally `failproofaid` does this: it watches `$FAILPROOFAI_HOME/custom-agents/events`, POSTs
 * each `*.jsonl` batch to `<cloud>/v1/events`, and deletes the file once the server accepts it.
 * On this laptop the daemon cannot be installed — `failproofai config` installs it as a root-owned
 * systemd service as its first step, and `sudo` needs a password a non-interactive agent cannot
 * supply — so nothing collects the spool.
 *
 * This script is the daemon's uploader, done by hand. It is the *same* endpoint, the *same*
 * `application/x-ndjson` body and the *same* `events:add` key the daemon would use, so a session
 * verified here is verified in Cloud for real. It is a workaround for the missing service, not a
 * replacement for it: it has no retry loop, no backoff and no scheduling, and it must be run by
 * hand. See `docs/ops/failproof.md`.
 *
 * Batches the server accepts are moved to `$FAILPROOFAI_HOME/custom-agents/shipped/` so a later
 * `failproofaid` cannot upload them twice. The ingest endpoint collapses duplicates server-side
 * anyway, so a re-send is safe rather than merely tolerable.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describeKey, loadKey } from "./key-file.mjs";

const DEFAULT_CLOUD_URL = "https://app.befailproof.ai";
const INGEST_PATH = "/v1/events";

function parseArgs(argv) {
  const out = { dryRun: false, keep: false, keyFile: null, url: DEFAULT_CLOUD_URL };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--keep") out.keep = true;
    else if (arg === "--key-file") out.keyFile = argv[++i];
    else if (arg === "--url") out.url = argv[++i];
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return out;
}

function failproofHome() {
  const override = process.env.FAILPROOFAI_HOME?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".failproofai");
}

function spoolDir(home) {
  return join(home, "custom-agents", "events");
}

/** POST one batch. Never logs the key; the body is the batch file verbatim. */
async function ship(endpoint, token, body) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-ndjson",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    return { ok: false, transport: true, error: String(error?.message ?? error), latencyMs: Date.now() - started };
  }
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.slice(0, 300);
  }
  return { ok: response.ok, status: response.status, body: parsed, latencyMs: Date.now() - started };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(
    "usage: node scripts/failproof/ship-spool.mjs [--dry-run] [--keep] [--url <base>] [--key-file <path>]\n",
  );
  process.exit(0);
}

const home = failproofHome();
const dir = spoolDir(home);
if (!existsSync(dir)) {
  process.stdout.write(`ship-spool: nothing to ship — ${dir} does not exist\n`);
  process.exit(0);
}

const batches = readdirSync(dir)
  .filter((name) => name.endsWith(".jsonl"))
  .sort();
if (batches.length === 0) {
  process.stdout.write(`ship-spool: nothing to ship — no *.jsonl in ${dir}\n`);
  process.exit(0);
}

const endpoint = `${args.url.replace(/\/$/, "")}${INGEST_PATH}`;
process.stdout.write(`ship-spool: spool   ${dir}\n`);
process.stdout.write(`ship-spool: ingest  ${endpoint}\n`);
process.stdout.write(`ship-spool: batches ${batches.length}\n`);

if (args.dryRun) {
  for (const name of batches) {
    const { size } = statSync(join(dir, name));
    const lines = readFileSync(join(dir, name), "utf8").split("\n").filter((line) => line.trim().length > 0).length;
    process.stdout.write(`  would ship ${name} (${size} bytes, ${lines} events)\n`);
  }
  process.exit(0);
}

let key;
try {
  key = loadKey(args.keyFile);
} catch (error) {
  process.stderr.write(`ship-spool: ${error.message}\n`);
  process.exit(66);
}
process.stdout.write(`ship-spool: key     ${describeKey(key)}\n\n`);

const shippedDir = join(home, "custom-agents", "shipped");
let accepted = 0;
let skipped = 0;
let failures = 0;

for (const name of batches) {
  const path = join(dir, name);
  const body = readFileSync(path);
  const result = await ship(endpoint, key.value, body);
  if (result.transport) {
    failures += 1;
    process.stdout.write(`  FAIL ${name}: transport error: ${result.error}\n`);
    continue;
  }
  const counts = result.body && typeof result.body === "object" ? result.body : {};
  const batchAccepted = typeof counts.accepted === "number" ? counts.accepted : 0;
  const batchSkipped = typeof counts.skipped === "number" ? counts.skipped : 0;
  accepted += batchAccepted;
  skipped += batchSkipped;
  process.stdout.write(
    `  ${result.ok ? "ok  " : "FAIL"} ${name}: HTTP ${result.status} in ${result.latencyMs}ms — accepted ${batchAccepted}, skipped ${batchSkipped}\n`,
  );
  if (!result.ok) {
    failures += 1;
    if (typeof result.body === "string") process.stdout.write(`        ${result.body}\n`);
    continue;
  }
  if (!args.keep) {
    mkdirSync(shippedDir, { recursive: true, mode: 0o700 });
    renameSync(path, join(shippedDir, name));
  }
}

process.stdout.write(`\nship-spool: accepted ${accepted}, skipped ${skipped}, batch failures ${failures}\n`);
if (!args.keep && failures === 0) {
  process.stdout.write(`ship-spool: batches moved to ${shippedDir}\n`);
}
process.exit(failures === 0 ? 0 : 1);
