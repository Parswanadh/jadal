/**
 * Spool-sink tests.
 *
 * `spoolSink` is the Node-only half of the Failproof layer: it writes JSONL batch files into the
 * directory `failproofaid` watches. These tests pin the on-disk contract the daemon depends on —
 * one file per `write()`, a unique stem, a trailing newline, `.tmp`-then-rename so a half-written
 * batch is never collected, and `0700`/`0600` permissions because the files carry prompts and tool
 * output — plus the rule that a telemetry failure is dropped rather than thrown into the caller.
 *
 * NO NETWORK and no real `~/.failproofai`: every sink is pointed at a fresh `mkdtemp` directory.
 */

import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { spoolSink } from "./spool";

const dirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "jadal-spool-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("spoolSink", () => {
  it("writes one JSONL batch file per write with a trailing newline", () => {
    const dir = join(freshDir(), "events");
    const sink = spoolSink({ dir, pid: 4242 });

    sink.write(['{"a":1}', '{"b":2}']);

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const name = files[0] as string;
    expect(name).toMatch(/^event-.*-4242-0\.jsonl$/);
    expect(readFileSync(join(dir, name), "utf8")).toBe('{"a":1}\n{"b":2}\n');
  });

  it("creates the spool directory with 0700 and the file with 0600", () => {
    const dir = join(freshDir(), "events");
    const sink = spoolSink({ dir, pid: 1 });

    sink.write(["{}"]);

    const name = readdirSync(dir)[0] as string;
    const dirMode = statSync(dir).mode & 0o777;
    const fileMode = statSync(join(dir, name)).mode & 0o777;
    // The security property is that group and other have no access at all; umask may only tighten.
    expect(dirMode & 0o077).toBe(0);
    expect(fileMode & 0o077).toBe(0);
  });

  it("uses a unique stem for every batch, so two writes cannot overwrite each other", () => {
    const dir = join(freshDir(), "events");
    const sink = spoolSink({ dir, pid: 7 });

    sink.write(["first"]);
    sink.write(["second"]);

    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(2);
    expect(new Set(files).size).toBe(2);
    for (const name of files) expect(name.endsWith(".jsonl")).toBe(true);
  });

  it("leaves no .tmp file behind after a successful rename", () => {
    const dir = join(freshDir(), "events");
    const sink = spoolSink({ dir, pid: 1 });

    sink.write(["{}"]);

    expect(readdirSync(dir).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("does nothing for an empty batch", () => {
    const dir = join(freshDir(), "events");
    const sink = spoolSink({ dir, pid: 1 });

    sink.write([]);

    expect(() => readdirSync(dir)).toThrow();
  });

  it("never throws when the directory cannot be created, and reports the drop", () => {
    const filePath = join(freshDir(), "not-a-dir");
    writeFileSync(filePath, "occupies the path");
    const sink = spoolSink({ dir: filePath, pid: 1 });

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(() => sink.write(["{}"])).not.toThrow();
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(String(stderr.mock.calls[0]?.[0])).toContain("1 event(s) dropped");
    } finally {
      stderr.mockRestore();
    }
  });
});
