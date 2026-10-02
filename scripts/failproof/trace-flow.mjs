#!/usr/bin/env node
/**
 * Run the traced urgent-water flow and spool one Failproof session per case.
 *
 *   node scripts/failproof/trace-flow.mjs
 *   FAILPROOFAI_HOME=~/.failproofai node scripts/failproof/trace-flow.mjs
 *
 * What it does:
 *
 *   1. runs `apps/api/src/observability/urgent-water-flow.trace.test.ts` under vitest with
 *      `FAILPROOF_TRACE=1`, so the flow emits the Failproof wire format;
 *   2. the emitter's spool sink writes JSONL batches into
 *      `$FAILPROOFAI_HOME/custom-agents/events` (default `~/.failproofai/custom-agents/events`),
 *      which is the directory `failproofaid` collects;
 *   3. prints the spool directory, the batch files this run produced, and the two session ids.
 *
 * It does not start, stop or need the daemon. With `failproofaid` running the batches are uploaded
 * within a few seconds; without it they simply accumulate. `docs/ops/failproof.md` covers both.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const API_DIR = join(REPO_ROOT, "apps", "api");
const VITEST = join(API_DIR, "node_modules", ".bin", "vitest");
const TEST_FILE = "src/observability/urgent-water-flow.trace.test.ts";

function spoolDir() {
  const override = process.env.FAILPROOFAI_HOME?.trim();
  const base = override && override.length > 0 ? override : join(homedir(), ".failproofai");
  return join(base, "custom-agents", "events");
}

if (!existsSync(VITEST)) {
  process.stderr.write(
    `trace-flow: no vitest at ${VITEST}\n` +
      "  Install workspace dependencies first (pnpm install), or link node_modules from a checkout that has them.\n",
  );
  process.exit(66);
}

const dir = spoolDir();
const before = new Set(existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".jsonl")) : []);

const started = Date.now();
const result = spawnSync(VITEST, ["run", TEST_FILE, "--reporter=basic"], {
  cwd: API_DIR,
  stdio: ["inherit", "pipe", "inherit"],
  encoding: "utf8",
  env: {
    ...process.env,
    FAILPROOF_TRACE: "1",
    FAILPROOF_ENABLED: "1",
    AGENTEYE_ENVIRONMENT: process.env.AGENTEYE_ENVIRONMENT ?? "development",
    FAILPROOFAI_HOME: process.env.FAILPROOFAI_HOME ?? join(homedir(), ".failproofai"),
  },
});

const output = result.stdout ?? "";
process.stdout.write(output);
const sessions = [...output.matchAll(/\[failproof\] session (\S+) \((\S+)\)/g)].map((match) => ({
  id: match[1],
  label: match[2],
}));

const after = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".jsonl")) : [];
const fresh = after.filter((name) => !before.has(name));

process.stdout.write(`\ntrace-flow: vitest exited ${result.status ?? "?"} in ${Date.now() - started}ms\n`);
process.stdout.write(`trace-flow: spool ${dir}\n`);
if (sessions.length > 0) {
  for (const session of sessions) process.stdout.write(`trace-flow: session ${session.id} (${session.label})\n`);
} else {
  process.stdout.write("trace-flow: no session ids found in the vitest output\n");
}
if (fresh.length === 0) {
  process.stdout.write(
    "trace-flow: no new batch files left in the spool — either the run failed, or a running daemon\n" +
      "            already collected them (it deletes each batch within milliseconds).\n",
  );
} else {
  for (const name of fresh) {
    const path = join(dir, name);
    const { size } = statSync(path);
    process.stdout.write(`trace-flow: wrote ${name} (${size} bytes, ${countLines(path)} events)\n`);
  }
}
process.stdout.write(
  "trace-flow: verify delivery with `failproofai flush --wait` then `failproofai events --since 1h --session-id <id> --full`.\n",
);

process.exit(result.status ?? 1);

/** Count JSONL lines in a batch file. */
function countLines(path) {
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0).length;
}
