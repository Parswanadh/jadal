#!/usr/bin/env node
/**
 * build_pack.mjs — build the Telugu native-speaker review pack.
 *
 * Handoff P10: "Telugu copy is machine-written — needs a native speaker for
 * apps/web/src/i18n/te.json and apps/api/src/voice/telugu.ts."
 *
 * This script EXTRACTS the Telugu copy. It does not edit it. It is pure,
 * deterministic and offline (COMPUTED, no network). Re-run:
 *
 *     node docs/review/build_pack.mjs
 *
 * Inputs  (read-only):
 *   apps/web/src/i18n/te.json          web UI copy, {key: string} pairs
 *   apps/web/src/i18n/en.json          the English source for those keys
 *   apps/api/src/voice/telugu.ts       Te/En message builders for voice/WhatsApp
 *
 * Output:
 *   docs/review/telugu-native-review.csv
 *     key,file,en,te,context,auto_flag,reviewer_ok,reviewer_fix
 *
 * `auto_flag` is a semicolon-separated list of mechanical suspicions:
 *   empty_te            te is empty/whitespace
 *   te_equals_en        te is character-identical to en
 *   latin_not_brand_unit  Latin letters outside the brand/unit allow-list
 *   placeholder_mismatch  {placeholders} (i18n) / interpolation slots (voice) differ
 *   no_en_pair          no English source exists for this Telugu string
 *   literal_index_mismatch  voice builder had a different literal count in Te vs En
 *
 * The flag is a triage aid, not a verdict: "EN"/"English" and identical
 * fixture-format strings are legitimate and are flagged so the reviewer can
 * confirm them rather than so the reviewer can "fix" them.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const TE_JSON = resolve(REPO, "apps/web/src/i18n/te.json");
const EN_JSON = resolve(REPO, "apps/web/src/i18n/en.json");
const VOICE_TS = resolve(REPO, "apps/api/src/voice/telugu.ts");
const OUT_CSV = resolve(HERE, "telugu-native-review.csv");

const TELUGU = /[\u0C00-\u0C7F]/;

/* Latin runs that are brands or physical/technical units, not transliteration. */
const ALLOWED_LATIN = new Set(["Jadal", "IST", "m", "mm", "cm", "km", "m3", "HH", "MM"]);

/* ------------------------------------------------------------------ helpers */

/** Replace `//` and `/* *\/` comments with spaces, preserving string contents. */
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      out += "  ";
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c;
      i++;
      let depth = 0;
      while (i < src.length) {
        const ch = src[i];
        if (ch === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += ch;
        if (q === "`" && ch === "$" && src[i + 1] === "{") {
          depth++;
          out += "{";
          i += 2;
          continue;
        }
        if (q === "`" && ch === "}" && depth > 0) {
          depth--;
          i++;
          continue;
        }
        if (ch === q && depth === 0) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** All string literals in a code fragment, with their raw (unescaped) text. */
function scanLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const start = i;
      i++;
      let text = "";
      let depth = 0;
      while (i < src.length) {
        const ch = src[i];
        if (ch === "\\") {
          text += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (c === "`" && ch === "$" && src[i + 1] === "{") {
          text += "${";
          depth++;
          i += 2;
          continue;
        }
        if (c === "`" && ch === "}" && depth > 0) {
          text += "}";
          depth--;
          i++;
          continue;
        }
        if (ch === c && depth === 0) break;
        text += ch;
        i++;
      }
      out.push({ text, quote: c, start });
      i++;
      continue;
    }
    i++;
  }
  return out;
}

/** Index just past the `;` that ends the statement starting at `from`, at depth 0. */
function statementEnd(src, from) {
  let i = from;
  let round = 0;
  let square = 0;
  let curly = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === q) break;
        i++;
      }
      i++;
      continue;
    }
    if (c === "(") round++;
    else if (c === ")") round--;
    else if (c === "[") square++;
    else if (c === "]") square--;
    else if (c === "{") curly++;
    else if (c === "}") curly--;
    else if (c === ";" && round === 0 && square === 0 && curly === 0) return i + 1;
    i++;
  }
  return src.length;
}

/** Index just past the `}` matching the `{` at `open`. */
function braceMatch(src, open) {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === q) break;
        i++;
      }
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return src.length;
}

/** Remove balanced `${...}` interpolation expressions, replacing each with `{}`. */
function stripInterpolations(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "$" && s[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < s.length && depth > 0) {
        if (s[i] === "{") depth++;
        else if (s[i] === "}") depth--;
        i++;
      }
      out += "{}";
      continue;
    }
    out += s[i];
    i++;
  }
  return out;
}

/** Count only top-level `${...}` slots (nested ternaries are not extra slots). */
function topLevelSlots(s) {
  let n = 0;
  let i = 0;
  let depth = 0;
  while (i < s.length) {
    if (s[i] === "$" && s[i + 1] === "{") {
      if (depth === 0) n++;
      depth++;
      i += 2;
      continue;
    }
    if (s[i] === "{" && depth > 0) depth++;
    else if (s[i] === "}" && depth > 0) depth--;
    i++;
  }
  return n;
}

/** Placeholder tokens to compare between Te and En. */
function placeholderTokens(text, isVoice) {
  if (isVoice) {
    return Array.from({ length: topLevelSlots(text) }, () => "{}");
  }
  return (text.match(/\{[^{}]*\}/g) ?? []).slice().sort();
}

/** Latin runs in user-facing text, ignoring placeholders and interpolations. */
function latinRuns(text) {
  const stripped = stripInterpolations(text).replace(/\{[^{}]*\}/g, " ");
  return stripped.match(/[A-Za-z]+/g) ?? [];
}

function autoFlag(te, en, isVoice) {
  const flags = [];
  if (!te || te.trim().length === 0) flags.push("empty_te");
  if (te && en && te === en) flags.push("te_equals_en");
  const bad = latinRuns(te).filter((run) => !ALLOWED_LATIN.has(run));
  if (bad.length > 0) flags.push(`latin_not_brand_unit(${[...new Set(bad)].join("|")})`);
  const a = placeholderTokens(te, isVoice);
  const b = placeholderTokens(en ?? "", isVoice);
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) flags.push("placeholder_mismatch");
  if (!en || en.length === 0) flags.push("no_en_pair");
  return flags.join(";");
}

/* ------------------------------------------------------------------ CSV */

function csvCell(value) {
  const s = value === undefined || value === null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(",");
}

/* ------------------------------------------------------------------ i18n */

const NS_CONTEXT = {
  app: "web shell: app name and tagline",
  a11y: "web shell: accessibility labels",
  nav: "web shell: primary navigation",
  auth: "web shell: signed-in state / sign-out",
  login: "web login screen",
  controls: "web shell: language and theme controls",
  units: "web: unit labels",
  common: "web: shared UI strings",
  fixture: "web demo fixture: seeded request reasons",
  crop: "web vocabulary: crop names",
  soil: "web vocabulary: soil types",
  channel: "web vocabulary: contact channels",
  reqType: "web vocabulary: request types",
  reqStatus: "web vocabulary: request statuses",
  footer: "web footer",
  home: "web home page",
  page: "web: page titles",
  farmer: "web farmer portal: shared",
  mywater: "web farmer portal: My Water",
  register: "web farmer portal: registration form",
  ask: "web farmer portal: ask for water",
  pool: "web farmer portal: shared pool",
  coord: "web coordinator console",
  canal: "web canal visualisation",
  phone: "web simulated phone",
  demo: "web demo mode",
};

function flatten(obj, prefix, out) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, full, out);
    } else {
      out.push([full, value]);
    }
  }
}

function i18nRows() {
  const te = JSON.parse(readFileSync(TE_JSON, "utf8"));
  const en = JSON.parse(readFileSync(EN_JSON, "utf8"));
  const teLeaves = [];
  const enLeaves = [];
  flatten(te, "", teLeaves);
  flatten(en, "", enLeaves);
  const enMap = new Map(enLeaves);

  const missing = [];
  const rows = [];
  for (const [key, teValue] of teLeaves) {
    const enValue = enMap.get(key);
    if (enValue === undefined) missing.push(key);
    const ns = key.split(".")[0];
    rows.push({
      key,
      file: "apps/web/src/i18n/te.json",
      en: typeof enValue === "string" ? enValue : "",
      te: typeof teValue === "string" ? teValue : "",
      context: NS_CONTEXT[ns] ?? `web UI: i18n namespace "${ns}"`,
      auto_flag: autoFlag(String(teValue), enValue, false),
    });
  }
  return { rows, teCount: teLeaves.length, enCount: enLeaves.length, missing };
}

/* ------------------------------------------------------------------ voice (telugu.ts) */

const VOICE_FN_CONTEXT = {
  rosterChange: "voice (outbound call): roster_change — turn rescheduled",
  nightReleaseWarning: "voice (outbound call): release_warning — night release alert",
  rainPostponed: "voice: rain postponement (cron re-plan)",
  requestUpdate: "voice (outbound call): request_update — request status",
  reminder: "voice (outbound call): reminder",
  ackRecorded: "voice: acknowledgement recorded",
  farmerGreeting: "voice: outbound call opening",
  inboundGreeting: "voice: inbound call opening",
  nextTurn: "voice: next-turn details (self-serve/inbound)",
  requestApproved: "voice: inbound — urgent request approved",
  requestRecorded: "voice: inbound — urgent request recorded",
  alert: "voice: severity alert (info/warning/urgent/emergency)",
  greeting: "voice: shared fragment — greeting",
  outletClause: "voice: shared fragment — outlet and chainage",
  windowClause: "voice: shared fragment — release window",
  volumeClause: "voice: shared fragment — volume in m³",
  dayClause: "voice: shared fragment — calendar day",
};

const VOICE_CONST_CONTEXT = {
  INBOUND_PROMPT: "voice: inbound DTMF / spoken prompt",
  LISTEN_CUE: "voice: cue before record",
  NOT_UNDERSTOOD: "voice: honest failure — speech not understood",
  CALLER_UNKNOWN: "voice: honest failure — caller number unknown",
  SCHEDULE_HOLD: "voice: honest failure — no turn facts to answer from",
  REQUEST_FAILED: "voice: honest failure — request not recorded",
  ALERT_LABEL: "voice: spoken severity label",
  NEUTRAL_VOCATIVE: "voice: honorific (gender-neutral default)",
  FEMININE_VOCATIVE: "voice: honorific (feminine)",
  FEMININE_NAME_ENDINGS: "voice: honorific heuristic — feminine name endings",
  TRAILING_HONORIFICS: "voice: honorific heuristic — suffixes stripped from names",
};

/** Trim a `Te`/`En` suffix from a builder name. */
function stem(name) {
  if (/[A-Za-z]Te$/.test(name)) return name.slice(0, -2);
  if (/[A-Za-z]En$/.test(name)) return name.slice(0, -2);
  return name;
}

function collectScopes(src) {
  const scopes = new Map();
  const fnRe = /export\s+function\s+([A-Za-z0-9_]+)\s*\(/g;
  let m;
  while ((m = fnRe.exec(src)) !== null) {
    const open = src.indexOf("{", m.index);
    const end = braceMatch(src, open);
    scopes.set(m[1], { kind: "function", name: m[1], text: src.slice(open, end) });
  }
  // Module-level only (column 0). Indented `const` inside a function body is a local
  // variable, not a message; counting it produced a duplicate `voice.status` row.
  const constRe = /^(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*(?::[^=]*)?=\s*/gm;
  while ((m = constRe.exec(src)) !== null) {
    if (scopes.has(m[1])) continue;
    const end = statementEnd(src, constRe.lastIndex);
    scopes.set(m[1], { kind: "const", name: m[1], text: src.slice(constRe.lastIndex, end) });
  }
  return scopes;
}

function objectEntries(objectText) {
  const entries = [];
  const re = /([A-Za-z0-9_]+)\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(objectText)) !== null) entries.push([m[1], m[2]]);
  return entries;
}

function voiceRows() {
  const raw = readFileSync(VOICE_TS, "utf8");
  const src = stripComments(raw);
  const scopes = collectScopes(src);
  const rows = [];
  const used = new Set();

  const push = (key, en, te, context, isVoice) => {
    rows.push({
      key,
      file: "apps/api/src/voice/telugu.ts",
      en,
      te,
      context,
      auto_flag: autoFlag(te, en, isVoice),
    });
  };

  // 1. function pairs (XTe / XEn) and single functions that hold both languages.
  for (const [name, scope] of scopes) {
    if (scope.kind !== "function") continue;
    if (used.has(name)) continue;
    const lits = scanLiterals(scope.text);
    // Drop empty literals (`""` from the "omit when unknown" ternaries) and language
    // switch tokens (`"en"` in farmerGreeting) so Te/En indices line up.
    const visible = (l) => l.text.trim().length > 0 && l.text !== "en" && l.text !== "te";
    const teLits = lits.filter((l) => TELUGU.test(l.text) && visible(l));
    if (teLits.length === 0) continue;

    let enLits;
    let mismatch = false;
    const twin = scopes.get(`${stem(name)}En`) && scopes.get(`${stem(name)}Te`) ? `${stem(name)}En` : null;
    if (twin && name === `${stem(name)}Te`) {
      const enScope = scopes.get(twin);
      enLits = scanLiterals(enScope.text).filter((l) => !TELUGU.test(l.text) && visible(l));
      used.add(twin);
    } else {
      enLits = lits.filter((l) => !TELUGU.test(l.text) && visible(l));
    }
    if (enLits.length !== teLits.length) mismatch = true;
    used.add(name);

    const base = stem(name);
    const context = VOICE_FN_CONTEXT[base] ?? `voice builder: ${base}`;
    teLits.forEach((lit, i) => {
      const en = enLits[i] ? enLits[i].text : "";
      let flag = autoFlag(lit.text, en, true);
      if (mismatch) flag = flag ? `${flag};literal_index_mismatch` : "literal_index_mismatch";
      push(`voice.${base}[${i}]`, en, lit.text, context, true);
    });
  }

  // 2. single-string consts: NAME_TE / NAME_EN. Objects and arrays are handled below.
  for (const [name, scope] of scopes) {
    if (scope.kind !== "const") continue;
    if (used.has(name)) continue;
    const body = scope.text.trimStart();
    if (body.startsWith("{") || body.startsWith("[")) continue;
    const base = name.replace(/_(TE|EN)$/, "");
    const isTe = name.endsWith("_TE");
    const isEn = name.endsWith("_EN");
    if (!isTe && !isEn) continue;

    const text = (scope.text.match(/"((?:[^"\\]|\\.)*)"/) ?? [])[1] ?? "";
    if (!isTe) continue; // emit from the _TE side only
    const enScope = scopes.get(`${base}_EN`);
    const enText = enScope ? ((enScope.text.match(/"((?:[^"\\]|\\.)*)"/) ?? [])[1] ?? "") : "";
    const context = VOICE_CONST_CONTEXT[base] ?? `voice constant: ${base}`;
    push(`voice.${base}`, enText, text, context, true);
    used.add(name);
  }

  // 3. object consts: ALERT_LABEL_TE / ALERT_LABEL_EN.
  for (const [name, scope] of scopes) {
    if (scope.kind !== "const" || used.has(name)) continue;
    if (!name.endsWith("_TE") || !scope.text.trimStart().startsWith("{")) continue;
    const base = name.replace(/_TE$/, "");
    const enScope = scopes.get(`${base}_EN`);
    const enEntries = new Map(enScope ? objectEntries(enScope.text) : []);
    for (const [prop, te] of objectEntries(scope.text)) {
      const context = VOICE_CONST_CONTEXT[base] ?? `voice constant: ${base}`;
      push(`voice.${base}.${prop}`, enEntries.get(prop) ?? "", te, context, true);
    }
    used.add(name);
  }

  // 4. array consts (honorific heuristics) — Telugu morphology, no English source.
  for (const [name, scope] of scopes) {
    if (scope.kind !== "const" || used.has(name)) continue;
    if (!scope.text.trimStart().startsWith("[")) continue;
    const lits = scanLiterals(scope.text).filter((l) => TELUGU.test(l.text));
    if (lits.length === 0) continue;
    const context = VOICE_CONST_CONTEXT[name] ?? `voice constant: ${name}`;
    lits.forEach((lit, i) => push(`voice.${name}[${i}]`, "", lit.text, context, true));
    used.add(name);
  }

  // 5. suffix-suffixed consts (NEUTRAL_VOCATIVE / FEMININE_VOCATIVE) with no EN pair.
  for (const [name, scope] of scopes) {
    if (scope.kind !== "const" || used.has(name)) continue;
    const text = (scope.text.match(/"((?:[^"\\]|\\.)*)"/) ?? [])[1];
    if (!text || !TELUGU.test(text)) continue;
    const context = VOICE_CONST_CONTEXT[name] ?? `voice constant: ${name}`;
    push(`voice.${name}`, "", text, context, true);
  }

  return rows;
}

/* ------------------------------------------------------------------ main */

const { rows: webRows, teCount, enCount, missing } = i18nRows();
const vRows = voiceRows();
const rows = [...webRows, ...vRows];

const header = ["key", "file", "en", "te", "context", "auto_flag", "reviewer_ok", "reviewer_fix"];
const csv = [header.join(","), ...rows.map((r) => csvRow([r.key, r.file, r.en, r.te, r.context, r.auto_flag, "", ""]))];
writeFileSync(OUT_CSV, csv.join("\n") + "\n", "utf8");

const flagged = rows.filter((r) => r.auto_flag.length > 0);
const byFlag = {};
for (const r of flagged) {
  for (const f of r.auto_flag.split(";")) {
    const name = f.split("(")[0];
    byFlag[name] = (byFlag[name] ?? 0) + 1;
  }
}

console.log(`te.json leaves: ${teCount}  en.json leaves: ${enCount}  key parity: ${teCount === enCount && missing.length === 0}`);
if (missing.length) console.log(`missing en keys: ${missing.join(", ")}`);
console.log(`voice rows: ${vRows.length}`);
console.log(`total rows: ${rows.length}`);
console.log(`flagged rows: ${flagged.length}`);
console.log(`flags: ${JSON.stringify(byFlag)}`);
console.log(`wrote ${OUT_CSV}`);
