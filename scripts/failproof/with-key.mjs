#!/usr/bin/env node
/**
 * Run a command with the Failproof AI key loaded into the child environment — without ever
 * printing, echoing or logging the key.
 *
 *   node scripts/failproof/with-key.mjs failproofai jev status
 *   node scripts/failproof/with-key.mjs --key-file apps/api/.dev.vars failproofai config
 *
 * Why this exists: `FAILPROOF_API_KEY` lives in the gitignored `apps/api/.dev.vars` (the name the
 * Jadal Worker reads). The Failproof CLI and daemon read `FAILPROOFAI_CLOUD_TOKEN` /
 * `FAILPROOFAI_KEY`. This shim bridges the two names and keeps the value out of argv, out of shell
 * history and out of the terminal.
 *
 * It prints one line to stderr naming the source file and the key length, and nothing else about
 * the key. The child inherits stdout/stderr and its exit code is this process's exit code.
 */

import { spawn } from "node:child_process";

import { describeKey, envWithKey, loadKey } from "./key-file.mjs";

function parseArgs(argv) {
  const rest = [];
  let keyFile = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--key-file") {
      keyFile = argv[i + 1];
      i += 1;
    } else {
      rest.push(arg);
    }
  }
  return { keyFile, command: rest };
}

const { keyFile, command } = parseArgs(process.argv.slice(2));

if (command.length === 0) {
  process.stderr.write(
    "usage: node scripts/failproof/with-key.mjs [--key-file <path>] <command> [args...]\n",
  );
  process.exit(64);
}

let key;
try {
  key = loadKey(keyFile);
} catch (error) {
  process.stderr.write(`with-key: ${error.message}\n`);
  process.exit(66);
}

process.stderr.write(`with-key: ${describeKey(key)}\n`);

const child = spawn(command[0], command.slice(1), { stdio: "inherit", env: envWithKey(key) });
child.on("error", (error) => {
  process.stderr.write(`with-key: failed to run ${command[0]}: ${error.message}\n`);
  process.exit(127);
});
child.on("exit", (code, signal) => {
  if (signal !== null) process.exit(128);
  process.exit(code ?? 1);
});
