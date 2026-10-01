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
  it("exist in the language files", () => {
    const root = join(__dirname, "..");
    const missing: string[] = [];
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bt\(\s*["'`]([\w.]+)["'`]/g)) {
        const key = match[1] ?? "";
        if (!(key in enFlat)) missing.push(`${file.slice(root.length + 1)}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("cover every crop, soil, channel and request value", () => {
    for (const crop of CropName.options) expect(enFlat[`crop.${crop}`], crop).toBeTruthy();
    for (const soil of SoilType.options) expect(enFlat[`soil.${soil}`], soil).toBeTruthy();
    for (const channel of Channel.options) expect(enFlat[`channel.${channel}`], channel).toBeTruthy();
    for (const type of RequestType.options) expect(enFlat[`reqType.${type}`], type).toBeTruthy();
    for (const status of RequestStatus.options) expect(enFlat[`reqStatus.${status}`], status).toBeTruthy();
  });
});
