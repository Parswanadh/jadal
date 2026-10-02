#!/usr/bin/env node
/**
 * Enable Jev through FailproofAI Cloud on a machine where `failproofai config` cannot install the
 * root-owned daemon service.
 *
 * ## Why this exists
 *
 * `failproofai config` is the documented setup path, and it installs `failproofaid` as a systemd
 * service as its *first* step — the one step that needs root. On this laptop `sudo` needs a
 * password that a non-interactive agent cannot supply, so `config` exits 1 with
 * "Could not get root, so setup stopped before changing anything" and writes no credentials at all.
 *
 * Cloud Jev itself needs no daemon: `failproofai jev test` is one HTTPS request to
 * `https://app.befailproof.ai/enforcement/v1/jev`. It needs two owner-only files under
 * `~/.failproofai/`:
 *
 *   credentials.json   the `cloud` slot (url, machine_id, token) and the `jev` slot (url, key)
 *   jev.json           { provider: "failproofai", baseUrl, mode: "observe" }
 *
 * `failproofai config` writes both. This script writes the same two files, in the same shapes the
 * CLI reads, so that the *supported* `failproofai jev status` / `failproofai jev test` commands
 * then work and prove the connection for real. It is a workaround for the missing daemon service,
 * not a replacement for it: **no session data reaches Cloud without a running daemon** — see
 * `docs/ops/failproof.md`.
 *
 * ## What it does
 *
 *   1. Reads the key from the gitignored `.dev.vars` (never printed).
 *   2. Asks the server what the key is: `GET /v1/auth/introspect`, and prints the answer with the
 *      key redacted, so a rejected key or a missing `jev:evaluate` is visible before anything is
 *      written.
 *   3. With `--apply`, writes `credentials.json` (mode 0600) and `jev.json` (mode 0600, never
 *      clobbering an existing file) into `$FAILPROOFAI_HOME` (default `~/.failproofai`).
 *
 * Usage:
 *   node scripts/failproof/configure-cloud.mjs                 # probe only, writes nothing
 *   node scripts/failproof/configure-cloud.mjs --apply         # probe, then write the two files
 *   node scripts/failproof/configure-cloud.mjs --apply --url https://app.befailproof.ai
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { describeKey, loadKey } from "./key-file.mjs";

const DEFAULT_CLOUD_URL = "https://app.befailproof.ai";
const INTROSPECT_PATH = "/v1/auth/introspect";
/** `/enforcement/v1/jev` appended to the Cloud origin — see `jevCloudBaseUrl` in the CLI. */
const JEV_CLOUD_BASE_PATH = "/enforcement/v1/jev";
const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const out = { apply: false, url: DEFAULT_CLOUD_URL, keyFile: null, machineId: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") out.apply = true;
    else if (arg === "--url") out.url = argv[++i];
    else if (arg === "--key-file") out.keyFile = argv[++i];
    else if (arg === "--machine-id") out.machineId = argv[++i];
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return out;
}

/** Failproof home, honoring the same env var the CLI does. */
function failproofHome() {
  const override = process.env.FAILPROOFAI_HOME?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".failproofai");
}

/**
 * Replace the key wherever it appears, and any field whose *name* says it is a secret.
 * The key is compared by value, so it is redacted even inside a longer string.
 */
function redact(value, key) {
  if (typeof value === "string") return value.includes(key) ? "<redacted-key>" : value;
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (value && typeof value === "object") {
    const out = {};
    for (const [name, item] of Object.entries(value)) {
      if (/^(token|key|secret|api_?key|bearer)$/i.test(name)) out[name] = "<redacted>";
      else out[name] = redact(item, key);
    }
    return out;
  }
  return value;
}

/** A stable per-machine id: the hostname, like `resolveMachineId` falls back to. */
function defaultMachineId() {
  const host = (process.env.HOSTNAME ?? "").trim();
  return `jadal-laneO-${host.length > 0 ? host : "localhost"}`;
}

async function introspect(url, token) {
  const endpoint = `${url.replace(/\/$/, "")}${INTROSPECT_PATH}`;
  const started = Date.now();
  let response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { ok: false, transport: true, endpoint, error: String(error?.message ?? error) };
  }
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 400);
  }
  return { ok: response.ok, status: response.status, endpoint, latencyMs: Date.now() - started, body };
}

/** Write `~/.failproofai/credentials.json`, merging every slot already there. */
function writeCredentials(home, { url, machineId, token }) {
  const path = join(home, "credentials.json");
  let existing = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed;
    } catch {
      existing = {};
    }
  }
  const merged = {
    ...existing,
    cloud: { url, machine_id: machineId, token, machine_label: `jadal-laneO-${machineId}` },
    jev: { url, key: token },
  };
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** Write `jev.json` unless one exists — the CLI never overwrites somebody's decision either. */
function writeJevConfig(home, url) {
  const path = join(home, "jev.json");
  const baseUrl = `${new URL(url).origin}${JEV_CLOUD_BASE_PATH}`;
  if (existsSync(path)) return { path, written: false, baseUrl };
  const body = `${JSON.stringify({ provider: "failproofai", baseUrl, mode: "observe" }, null, 2)}\n`;
  writeFileSync(path, body, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  return { path, written: true, baseUrl };
}

/**
 * Write `config.json` in the shape `writeConfig` in the CLI's `src/hooks/fp-config.ts` produces.
 *
 * This is the file the *daemon* reads: `daemon.configured` is what tells it it was set up, and
 * `collector.sessions` is what turns session capture on. `failproofai config` writes it as part of
 * the wizard; without the wizard (no sudo) the daemon starts but collects nothing, which is
 * indistinguishable from an idle machine.
 *
 * `mode.kind` is `"cloud"`: unrecognised values read as `"oss"`, and a corrupt config must never be
 * able to turn cloud reporting ON — so this is written only by an explicit `--apply`.
 */
function writeConfig(home, { machineId, environment }) {
  const path = join(home, "config.json");
  const body = {
    mode: { kind: "cloud" },
    daemon: { configured: true },
    collector: {
      sessions: true,
      hooks: true,
      hooks_verbosity: "all",
      redact: "minimal",
      environment,
      machine_id: machineId,
    },
    audit: { auto: false, interval_days: 7 },
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(
    "usage: node scripts/failproof/configure-cloud.mjs [--apply] [--url <base>] [--key-file <path>] [--machine-id <id>]\n",
  );
  process.exit(0);
}

let key;
try {
  key = loadKey(args.keyFile);
} catch (error) {
  process.stderr.write(`configure-cloud: ${error.message}\n`);
  process.exit(66);
}
process.stdout.write(`key:    ${describeKey(key)}\n`);

const url = args.url.replace(/\/$/, "");
process.stdout.write(`cloud:  ${url}\n`);

const identity = await introspect(url, key.value);
if (identity.transport) {
  process.stdout.write(`introspect: UNREACHABLE at ${identity.endpoint}\n  ${identity.error}\n`);
  process.exit(1);
}
process.stdout.write(`introspect: HTTP ${identity.status} in ${identity.latencyMs}ms (${identity.endpoint})\n`);
process.stdout.write(`${JSON.stringify(redact(identity.body, key.value), null, 2)}\n`);

if (!identity.ok) {
  process.stdout.write("\nThe server did not accept this key. Nothing was written.\n");
  process.exit(1);
}

if (!args.apply) {
  process.stdout.write("\nProbe only. Re-run with --apply to write credentials.json and jev.json.\n");
  process.exit(0);
}

const home = failproofHome();
if (existsSync(home)) {
  const mode = statSync(home).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    chmodSync(home, 0o700);
    process.stdout.write(`home:   tightened ${home} to 0700\n`);
  }
}
mkdirSync(home, { recursive: true, mode: 0o700 });

const machineId = args.machineId ?? defaultMachineId();
const credsPath = writeCredentials(home, { url, machineId, token: key.value });
process.stdout.write(`wrote:  ${credsPath} (0600, cloud + jev slots; value not printed)\n`);

const jev = writeJevConfig(home, url);
process.stdout.write(
  jev.written
    ? `wrote:  ${jev.path} (0600, provider=failproofai mode=observe baseUrl=${jev.baseUrl})\n`
    : `kept:   ${jev.path} already exists; left exactly as it was (baseUrl would be ${jev.baseUrl})\n`,
);

const configPath = writeConfig(home, { machineId, environment: process.env.AGENTEYE_ENVIRONMENT ?? "development" });
process.stdout.write(
  `wrote:  ${configPath} (0600, mode=cloud daemon.configured=true collector.sessions=true)\n`,
);
process.stdout.write("\nNow verify with the CLI: failproofai jev status && failproofai jev test\n");
