import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CropName, SoilType, RequestType, RequestStatus, Channel } from "@jadal/contracts";
import en from "./en.json";
import te from "./te.json";

function flatten(node: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof node === "string") {
    out[prefix] = node;
    return out;
  }
  if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      Object.assign(out, flatten(value, prefix ? `${prefix}.${key}` : key));
    }
  }
  return out;
}

const enFlat = flatten(en);
const teFlat = flatten(te);

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("language files", () => {
  it("have the same keys in English and Telugu", () => {
    expect(Object.keys(teFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it("have no empty strings", () => {
    for (const [key, value] of [...Object.entries(enFlat), ...Object.entries(teFlat)]) {
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("use the same {placeholders} in both languages", () => {
    for (const [key, value] of Object.entries(enFlat)) {
      expect(placeholders(teFlat[key] ?? ""), key).toEqual(placeholders(value));
    }
  });

  it("write Telugu strings in Telugu", () => {
    // Language names and unit-free codes may stay as they are.
    const allowed = new Set(["controls.languageEnglish", "controls.langOptionEn"]);
    for (const [key, value] of Object.entries(teFlat)) {
      if (allowed.has(key)) continue;
      // Either it has Telugu text, or it is only placeholders and punctuation (no English words).
      const withoutPlaceholders = value.replace(/\{\w+\}/g, "");
      const ok = /[ఀ-౿]/.test(value) || !/[A-Za-z]/.test(withoutPlaceholders);
      expect(ok, `${key}: ${value}`).toBe(true);
    }
  });

  it("keep developer words and filler out of every string", () => {
    const banned = [/\/api\b/i, /\b(POST|GET)\b/, /\bmock\b/i, /\brw\d\b/i, /\bseed\b/i, /deterministic/i, /—/, /seamless/i, /empower/i, /leverage/i, /\bAPI\b/];
    for (const [key, value] of [...Object.entries(enFlat), ...Object.entries(teFlat)]) {
      for (const pattern of banned) {
        expect(pattern.test(value), `${key}: ${value} matches ${String(pattern)}`).toBe(false);
      }
    }
  });
});

describe("translation keys used in the code", () => {
  // Every literal key a component asks for must resolve in BOTH dictionaries.
  // A key that resolves to nothing renders as its own name, so this must fail
  // the suite rather than let a raw "login.title" reach the screen.
  it("exist in both language files", () => {
    const root = join(__dirname, "..");
    const missing: string[] = [];
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bt\(\s*["']([\w.]+)["']/g)) {
        const key = match[1] ?? "";
        for (const [lang, dict] of [["en", enFlat], ["te", teFlat]] as const) {
          if (!(key in dict)) missing.push(`${lang} ${file.slice(root.length + 1)}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  // Template keys such as t(`coord.alert.severity.${level}`) cannot be checked
  // member by member, but the family prefix must exist in both dictionaries.
  it("only reference template key families that exist", () => {
    const root = join(__dirname, "..");
    const missing: string[] = [];
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bt\(\s*`([^`]*)`/g)) {
        const raw = match[1] ?? "";
        const prefix = raw.split("${")[0] ?? "";
        if (!prefix.endsWith(".")) continue;
        const inEn = Object.keys(enFlat).some((key) => key.startsWith(prefix));
        const inTe = Object.keys(teFlat).some((key) => key.startsWith(prefix));
        if (!inEn || !inTe) missing.push(`${file.slice(root.length + 1)}: ${prefix}*`);
      }
    }
    expect(missing).toEqual([]);
  });

  // Regression pin for the surfaces that were broken by a bulk dictionary edit:
  // the sign-in screen, the schedule editor and the alert control with severity.
  it("keep the sign-in screen and coordinator tools fully translated", () => {
    const required = [
      "login.eyebrow",
      "login.title",
      "login.lead",
      "login.roleLabel",
      "login.role.farmer",
      "login.role.coordinator",
      "login.passwordLabel",
      "login.submit",
      "login.error",
      "login.noteTitle",
      "login.rolesHint",
      "login.noteBody",
      "auth.signedInAs",
      "auth.signOut",
      "coord.roster.edit.action",
      "coord.roster.edit.forTurn",
      "coord.roster.edit.save",
      "coord.roster.edit.backwards",
      "coord.roster.edit.saved",
      "coord.roster.edit.changed",
      "coord.alert.title",
      "coord.alert.channel.call",
      "coord.alert.channel.sms",
      "coord.alert.channel.whatsapp",
      "coord.alert.severity.info",
      "coord.alert.severity.warning",
      "coord.alert.severity.urgent",
      "coord.alert.severity.emergency",
      "coord.alert.simulated",
      "phone.agentCallTitle",
      "phone.agentCallPlay",
      "phone.agentCallSimulated",
      "ask.urgentCallNote",
    ];
    for (const key of required) {
      expect(enFlat[key], `en ${key}`).toBeTruthy();
      expect(teFlat[key], `te ${key}`).toBeTruthy();
    }
  });

  it("cover every crop, soil, channel and request value", () => {
    for (const crop of CropName.options) expect(enFlat[`crop.${crop}`], crop).toBeTruthy();
    for (const soil of SoilType.options) expect(enFlat[`soil.${soil}`], soil).toBeTruthy();
    for (const channel of Channel.options) expect(enFlat[`channel.${channel}`], channel).toBeTruthy();
    for (const type of RequestType.options) expect(enFlat[`reqType.${type}`], type).toBeTruthy();
    for (const status of RequestStatus.options) expect(enFlat[`reqStatus.${status}`], status).toBeTruthy();
  });
});
