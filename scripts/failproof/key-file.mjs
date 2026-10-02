/**
 * Read the Failproof AI key out of a gitignored `.dev.vars` file without ever echoing it.
 *
 * Shared by `with-key.mjs` (runs a command with the key in its environment) and
 * `configure-cloud.mjs` (enables Cloud Jev through the CLI's own credential file).
 *
 * The Jadal Worker reads the key as `FAILPROOF_API_KEY`; the Failproof CLI, daemon and Jev
 * client read `FAILPROOFAI_CLOUD_TOKEN` / `FAILPROOFAI_KEY`. This module knows both names and
 * returns the value only to the caller — nothing here writes it to stdout, stderr, argv or disk.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..", "..");

/** Every name that can carry the key in a `.dev.vars` file. */
export const KEY_NAMES = ["FAILPROOF_API_KEY", "FAILPROOFAI_CLOUD_TOKEN", "FAILPROOFAI_KEY"];

/** Environment names the Failproof CLI/daemon read. Both are set so either works. */
export const TARGET_VARS = ["FAILPROOFAI_CLOUD_TOKEN", "FAILPROOFAI_KEY"];

/**
 * The `.dev.vars` to read, in priority order.
 *
 * `apps/api/.dev.vars` is gitignored, so a fresh `git worktree` does not carry it; the main
 * checkout's copy is the fallback and is what the Jadal Worker actually loads.
 */
export function resolveKeyFile(explicit) {
  const candidates = [];
  if (explicit) candidates.push(resolve(process.cwd(), explicit));
  if (process.env.FAILPROOF_KEY_FILE) candidates.push(resolve(process.cwd(), process.env.FAILPROOF_KEY_FILE));
  candidates.push(resolve(REPO_ROOT, "apps", "api", ".dev.vars"));
  candidates.push("/home/parshu/projects/cis/jadal/apps/api/.dev.vars");
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Read the first non-empty `NAME=value` line for one of `KEY_NAMES`, without echoing it. */
export function readKeyFromFile(path) {
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const name = line.slice(0, eq).trim();
    if (!KEY_NAMES.includes(name)) continue;
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value.length > 0) return { name, value };
  }
  return null;
}

/**
 * Resolve `{ path, name, value }` for the key, or throw a message that names only the file.
 *
 * @throws {Error} when no candidate file exists, or it holds no non-empty key.
 */
export function loadKey(explicit) {
  const path = resolveKeyFile(explicit);
  if (path === null) {
    throw new Error("no .dev.vars found; pass --key-file <path> or set FAILPROOF_KEY_FILE");
  }
  const found = readKeyFromFile(path);
  if (found === null) {
    throw new Error(`no non-empty Failproof key (${KEY_NAMES.join(", ")}) in ${path}`);
  }
  return { path, name: found.name, value: found.value };
}

/** One line, no value: enough to prove the variable is populated. */
export function describeKey({ path, name, value }) {
  return `loaded ${name} from ${path} (${value.length} chars, value not printed)`;
}

/** A copy of `process.env` with both CLI-facing key names populated. */
export function envWithKey(key) {
  const env = { ...process.env };
  for (const name of TARGET_VARS) env[name] = key.value;
  return env;
}
