/**
 * Static guard: every outbound call goes through the one legal route.
 *
 * Handoff P8 (`docs/HANDOFF-ENGINEERING.md` §5): `place_call` is declared `gated: false` even though
 * the real dispatch path is approval-gated, because contacts — a call's prerequisite — are created
 * only inside `approveRoster`. The contracts correction is proposed in
 * `docs/decisions/ADR-place-call-gated.md` and cannot be applied from this lane. This test pins the
 * *code* half of the claim so it cannot silently drift while the contracts half waits:
 *
 *  1. `placeCall(` (the raw Twilio primitive) is invoked in exactly one place —
 *     `placeCallFromCampaign` in `telephony-deps.ts` — and nowhere else in `apps/api/src`.
 *  2. The only call sites of the legal route `placeCallIfAllowed(` are `coordinator-alert.ts` and
 *     `campaigns/escalation.ts`. A new dialler that bypasses the guard fails this test.
 *  3. `placeCallFromCampaign(` (the unguarded wrapper) is only called from inside
 *     `placeCallIfAllowed`, so the wrapper is not a public bypass.
 *
 * The scan is deliberately source-text based and needs no runtime: it reads the non-test `.ts`
 * files under `apps/api/src` and strips comments and string/template literals before matching, so a
 * mention in prose or a test fixture does not count. `violations()` is exported and unit-tested
 * below on synthetic sources, which is what makes a green run mean "the rule holds" rather than
 * "the regex happened to match nothing".
 *
 * NO NETWORK: this file reads the filesystem only. It places no call.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** The directory this test lives in: `apps/api/src`. */
const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

/** The raw primitive that puts a call on the wire. */
const PLACE_CALL = "placeCall";
/** The one file allowed to invoke {@link PLACE_CALL} directly, and the function that must contain it. */
const PLACE_CALL_FILE = "telephony-deps.ts";
const PLACE_CALL_WRAPPER = "placeCallFromCampaign";
/** The guarded route every real caller must use. */
const GUARDED = "placeCallIfAllowed";
/** The only two files allowed to call {@link GUARDED}. */
const GUARDED_CALL_FILES = ["campaigns/escalation.ts", "coordinator-alert.ts"] as const;

export interface SourceFile {
  /** Path relative to `apps/api/src`, with `/` separators. */
  readonly path: string;
  readonly source: string;
}

export interface CallSite {
  readonly file: string;
  readonly line: number;
  /** The nearest preceding `function` declaration, or `null` at module top level. */
  readonly fn: string | null;
}

/**
 * Replace comments and string/template literals with spaces, preserving newlines so line numbers
 * survive. A mention of `placeCall(` in a docstring or a test fixture string is not a call.
 */
export function stripNonCode(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += " ";
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      out += " ";
      i += 1;
      continue;
    }

    out += c;
    i += 1;
  }
  return out;
}

/** The last `function <name>(` declaration beginning before `index`, if any. */
export function enclosingFunction(code: string, index: number): string | null {
  const before = code.slice(0, index);
  const declaration = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let name: string | null = null;
  for (let match = declaration.exec(before); match !== null; match = declaration.exec(before)) {
    name = match[1] ?? null;
  }
  return name;
}

/** Every call (not declaration) of `name` in `source`, with its line and enclosing function. */
export function callSites(file: SourceFile, name: string): CallSite[] {
  const code = stripNonCode(file.source);
  const pattern = new RegExp(`\\b${name}\\s*\\(`, "g");
  const sites: CallSite[] = [];
  for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
    const lineStart = code.lastIndexOf("\n", match.index) + 1;
    // `export async function placeCall(` etc. is a declaration, not a call.
    if (/\bfunction\s+$/.test(code.slice(lineStart, match.index))) continue;
    sites.push({
      file: file.path,
      line: code.slice(0, match.index).split("\n").length,
      fn: enclosingFunction(code, match.index),
    });
  }
  return sites;
}

/** The guard's whole rule as a pure function over sources. Empty array means "legal". */
export function violations(files: readonly SourceFile[]): string[] {
  const problems: string[] = [];

  for (const file of files) {
    for (const site of callSites(file, PLACE_CALL)) {
      if (site.file !== PLACE_CALL_FILE) {
        problems.push(`direct ${PLACE_CALL}() call outside ${PLACE_CALL_FILE}: ${site.file}:${site.line} (in ${site.fn ?? "<top level>"})`);
      } else if (site.fn !== PLACE_CALL_WRAPPER) {
        problems.push(`direct ${PLACE_CALL}() call not inside ${PLACE_CALL_WRAPPER}: ${site.file}:${site.line} (in ${site.fn ?? "<top level>"})`);
      }
    }

    for (const site of callSites(file, GUARDED)) {
      if (!(GUARDED_CALL_FILES as readonly string[]).includes(site.file)) {
        problems.push(`illegal ${GUARDED}() call site: ${site.file}:${site.line} (legal: ${GUARDED_CALL_FILES.join(", ")})`);
      }
    }

    for (const site of callSites(file, PLACE_CALL_WRAPPER)) {
      if (site.file !== PLACE_CALL_FILE || site.fn !== GUARDED) {
        problems.push(`unguarded ${PLACE_CALL_WRAPPER}() call: ${site.file}:${site.line} (in ${site.fn ?? "<top level>"}; only ${GUARDED} in ${PLACE_CALL_FILE} may call it)`);
      }
    }
  }

  return problems;
}

/** Test files are excluded: the rule constrains shipped non-test code. */
function isTestFile(name: string): boolean {
  return name.endsWith(".test.ts") || name.endsWith(".spec.ts");
}

/** Recursively read every non-test `.ts` file under `src`, as `SourceFile`s. */
export function loadSources(dir: string, base = dir): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...loadSources(absolute, base));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !isTestFile(entry.name)) {
      files.push({ path: relative(base, absolute).split(sep).join("/"), source: readFileSync(absolute, "utf8") });
    }
  }
  return files;
}

describe("place-call static guard", () => {
  const sources = loadSources(SRC_DIR);

  it("scans the shipped source tree (not vacuously)", () => {
    expect(sources.length).toBeGreaterThan(30);
    expect(sources.some((file) => file.path === PLACE_CALL_FILE)).toBe(true);
  });

  it("invokes the raw placeCall() in exactly one place, inside the guarded wrapper", () => {
    const calls = sources
      .flatMap((file) => callSites(file, PLACE_CALL))
      .map((site) => `${site.file}:${site.fn}`)
      .sort();
    expect(calls).toEqual([`${PLACE_CALL_FILE}:${PLACE_CALL_WRAPPER}`]);
  });

  it("has exactly the two intended placeCallIfAllowed() call sites", () => {
    const calls = sources
      .flatMap((file) => callSites(file, GUARDED))
      .map((site) => site.file)
      .sort();
    expect(calls).toEqual([...GUARDED_CALL_FILES].sort());
  });

  it("finds no illegal call site anywhere under apps/api/src", () => {
    expect(violations(sources)).toEqual([]);
  });

  it("bites on synthetic violations", () => {
    const stray: SourceFile = {
      path: "routes/somewhere.ts",
      source: "export async function go() {\n  await placeCall(deps, input);\n}\n",
    };
    const bypass: SourceFile = {
      path: "agents/caller.ts",
      source: "export async function go() {\n  await placeCallFromCampaign(env, input);\n}\n",
    };
    const rogueGuarded: SourceFile = {
      path: "routes/anything.ts",
      source: "export async function go() {\n  await placeCallIfAllowed(env, input);\n}\n",
    };
    const legal: SourceFile = {
      path: PLACE_CALL_FILE,
      source: "export async function placeCallIfAllowed() {\n  return placeCallFromCampaign(env, input);\n}\nexport function placeCallFromCampaign() {\n  return placeCall(deps, input);\n}\n",
    };

    expect(violations([stray])[0]).toContain("direct placeCall() call outside");
    expect(violations([bypass])[0]).toContain("unguarded placeCallFromCampaign()");
    expect(violations([rogueGuarded])[0]).toContain("illegal placeCallIfAllowed() call site");
    expect(violations([legal])).toEqual([]);

    // A declaration is not a call, and a call mentioned in prose is not a call.
    const prose = 'const doc = "call placeCall(deps, input) to dial";\n// placeCall(deps, input)\n';
    expect(callSites({ path: "x.ts", source: prose }, PLACE_CALL)).toEqual([]);
  });
});
