/**
 * A Node-only Failproof sink that writes JSONL batches into the daemon's spool.
 *
 * `failproofaid` collects every `*.jsonl` file under
 * `$FAILPROOFAI_HOME/custom-agents/events` (default `~/.failproofai/custom-agents/events`) and
 * uploads it. This sink writes that format byte-compatibly with `@failproofai/sdk`'s
 * `dist/esm/writer.js`:
 *
 *   * batch file `event-<ISO with : and . → ->-<pid>-<seq>.jsonl`, so two batches in the same
 *     millisecond — or two processes sharing a spool root — cannot overwrite each other;
 *   * written to `<stem>.tmp` first and `rename`d into place, so the collector can never read a
 *     half-written batch;
 *   * directory `0700`, file `0600`: these files carry prompts, tool arguments and tool output.
 *
 * **This module imports `node:fs` and must never be imported from the Worker.** `failproof.ts` is
 * the dependency-free half; this is the Node half. `scripts/failproof/trace-flow.mjs` is the only
 * caller, and `docs/ops/failproof.md` says so.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { FailproofSink } from "./failproof";

/** Per-process batch counter — the pid plus this is what makes a batch stem unique. */
let batchSeq = 0;

/**
 * The spool directory the daemon watches.
 *
 * Mirrors `failproofaiCustomAgentsDir()` in the SDK's `resolver.js` and `customAgentsEventsDir()`
 * in the CLI's `src/hooks/fp-home.ts`. `FAILPROOFAI_HOME` MOVES the umbrella; it cannot take the
 * spool outside it, because the `custom-agents/events` segments are appended unconditionally.
 */
function resolveSpoolDir(home?: string): string {
  const override = home ?? process.env.FAILPROOFAI_HOME?.trim();
  const base = override !== undefined && override.length > 0 ? override : join(homedir(), ".failproofai");
  return join(base, "custom-agents", "events");
}

export interface SpoolSinkOptions {
  /** Defaults to `resolveSpoolDir()`. */
  dir?: string;
  /** Injectable for tests; defaults to `process.pid`. */
  pid?: number;
}

/** `2026-09-23T12-34-56-789Z` — orders batches for a human reading the directory. */
function batchStem(pid: number): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  batchSeq += 1;
  return `event-${stamp}-${pid}-${batchSeq - 1}`;
}

/**
 * A sink that appends one batch file per `write()` call.
 *
 * `write()` is synchronous and never throws: the SDK's own contract is that a telemetry outage
 * must not take the agent down, and a full disk or a read-only mount must degrade to "events
 * dropped", not "water request failed".
 */
export function spoolSink(options: SpoolSinkOptions = {}): FailproofSink {
  const dir = options.dir ?? resolveSpoolDir();
  const pid = options.pid ?? process.pid;

  return {
    write(lines: readonly string[]): void {
      if (lines.length === 0) return;
      const body = `${lines.join("\n")}\n`;
      const stem = batchStem(pid);
      const tmpPath = join(dir, `${stem}.tmp`);
      const finalPath = join(dir, `${stem}.jsonl`);
      let fd: number | undefined;
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        fd = openSync(tmpPath, "w", 0o600);
        writeSync(fd, body);
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        renameSync(tmpPath, finalPath);
      } catch (error) {
        if (fd !== undefined) {
          try {
            closeSync(fd);
          } catch {
            /* already closed or never opened */
          }
        }
        try {
          rmSync(tmpPath, { force: true });
        } catch {
          /* nothing to clean up */
        }
        process.stderr.write(
          `[failproof] spool write failed (${error instanceof Error ? error.message : String(error)}); ${lines.length} event(s) dropped\n`,
        );
      }
    },
  };
}
