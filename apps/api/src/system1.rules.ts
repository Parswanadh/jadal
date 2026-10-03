/**
 * System-1 deterministic rule classifier — the last-resort fallback and the reference
 * implementation for the whole System-1 layer.
 *
 * Pure and synchronous: no network, no clock, no database, no randomness. The same input always
 * produces the same `System1Result`, which is what makes it safe to use as the floor under Jev and
 * Laya. Every test and the offline demo run through this function when no model key is present.
 *
 * Keyword provenance: the distress stems (`ఎండిపో`, `నీళ్లు లేవు`, `చనిపో`) come from the failure
 * fallback in `docs/research/deterministic-and-system1.md` §5.4; the intent taxonomy is the one in
 * `@jadal/contracts` `System1Intent`, not the six-way list in §5.5 (the contract wins). Everything
 * else is ordinary Rayalaseema/Krishna-delta farmer phrasing, written as Telugu script rather than
 * transliteration so it matches what the Sarvam `saaras` transcript actually returns.
 *
 * Design rules that the tests pin down:
 *  * Matching is substring-based on a normalised string, with span de-duplication so a longer term
 *    that contains a shorter one ("నీరు వద్దు" vs "వద్దు") is only counted once.
 *  * `urgency` is a weighted score in [0,1], never a boolean.
 *  * `urgent_request` is deliberately hard to trigger by accident: a request verb on its own is weak
 *    ("నీరు కావాలి" is strength 2 but every other request needs a stress or urgency marker too,
 *    because a negation like "ఈ వారం అవసరం లేదు" also contains the verb).
 */

import { System1Result } from "@jadal/contracts";

type Intent = System1Result["intent"];

/** A keyword and how much it counts for. `2` is a strong signal, `1` is a weak corroborating one. */
interface Rule {
  readonly term: string;
  readonly strength: 1 | 2;
}

const rule = (term: string, strength: 1 | 2 = 1): Rule => ({ term, strength });

/* ------------------------------------------------------------------ normalisation */

const TELUGU_DIGITS: Readonly<Record<string, string>> = {
  "౦": "0",
  "౧": "1",
  "౨": "2",
  "౩": "3",
  "౪": "4",
  "౫": "5",
  "౬": "6",
  "౭": "7",
  "౮": "8",
  "౯": "9",
};

/** Zero-width and bidi control characters: invisible, and they break substring matching. */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;

/**
 * Lowercase, drop invisibles, fold Telugu digits to Latin, strip punctuation to spaces.
 * Aggressive on purpose: the goal is a stable haystack for substring search, not pretty text.
 *
 * Combining marks (`\p{M}`) are kept, not stripped: Telugu vowel signs, anusvara and virama are
 * Mn/Mc code points that carry real phonetic information, and every Telugu keyword and volume unit
 * in the tables below is written with them. Treating them as punctuation would render the whole
 * Telugu-script side of the classifier (and `extractVolumeM3`'s `క్యూబిక్ మీటర్లు`) unmatchable.
 */
export function normalizeText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(/[౦-౯]/g, (d) => TELUGU_DIGITS[d] ?? d)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ keyword tables */

/**
 * Severe crop-stress stems. Presence of any of these means the crop is under real water stress
 * (`deterministic-and-system1.md` §5.4 names the first three).
 */
const STRESS_TERMS: readonly Rule[] = [
  rule("ఎండిపో", 2),
  rule("చనిపో", 2),
  rule("ఆకలిగోల్లు", 2),
  rule("తరగతిపో", 2),
  rule("మరణి", 2),
  rule("డగ్గుబా", 2),
  rule("నీళ్లు లేవు", 2),
  rule("నీరు లేదు", 2),
  rule("నీటి లేదు", 2),
  // English/transliterated severe-stress phrasing. The demo seeds "the leaves are rolling in the
  // heat" (maize at tasseling), which is visible wilting: severe, not mild.
  rule("leaves are rolling", 2),
  rule("leaves rolling", 2),
  rule("rolling in the heat", 2),
];

/** Mild distress: enough to matter, not enough on its own to raise urgency to the top band. */
const DISTRESS_TERMS: readonly Rule[] = [
  ...STRESS_TERMS,
  rule("పగుళ్లు"),
  rule("పగుల్లు"),
  rule("ఉల్లిపా"),
  rule("వడిపో"),
  rule("మట్టి పట్ట"),
  rule("మట్టి గట్ట"),
  rule("పత్తిపో"),
  rule("cracked"),
  rule("wilt"),
  rule("dying"),
  rule("wilting"),
  // Growth-stage stress the demo seeds. Flowering/tasseling are the stages where a missed turn
  // costs yield, but they are not by themselves a crop-death claim, so they stay mild.
  rule("tasseling"),
  rule("tasselling"),
  rule("flowering"),
  rule("drying out"),
  rule("drying up"),
];

/** Crop nouns, Telugu script and the English/transliterated forms farmers actually mix in. */
const CROP_TERMS: readonly Rule[] = [
  rule("వరి"),
  rule("మొక్కజొన్న"),
  rule("వేరుశనగ"),
  rule("పత్తి"),
  rule("మిరప"),
  rule("చెరకు"),
  rule("పెసరు"),
  rule("శనగ"),
  rule("rice"),
  rule("paddy"),
  rule("maize"),
  rule("corn"),
  rule("cotton"),
  rule("chilli"),
  rule("chili"),
  rule("groundnut"),
  rule("sugarcane"),
  rule("green gram"),
  rule("black gram"),
  rule("chickpea"),
];

/** Adverbs of desperation. Cheap to match, and never appear in calm messages. */
const URGENCY_TERMS: readonly Rule[] = [
  rule("అత్యవసర", 2),
  rule("వెంటనే", 2),
  rule("ఇప్పుడే", 2),
  rule("తక్షణమే", 2),
  rule("ఉద్వేగ", 2),
  rule("అడ్డంగా", 2),
  rule("ఇప్పుడే చేయండి"),
  rule("ఎప్పుడైనా", 1),
  rule("urgent", 2),
  rule("asap", 2),
  rule("immediately", 2),
  rule("emergency", 2),
  rule("right away", 2),
  rule("as soon as possible", 2),
];

/** Asking-for-water verbs. Weak on their own; strong only next to a stress or urgency marker. */
const REQUEST_TERMS: readonly Rule[] = [
  rule("నీరు కావాలి", 2),
  rule("నీటి కావాలి", 2),
  rule("నీటి వంతు కావాలి", 2),
  rule("విడుదల కావాలి", 2),
  rule("నీరు పంపండి", 2),
  rule("need water", 2),
  rule("water kavali", 2),
  rule("పంపండి"),
  rule("ఇవ్వండి"),
  rule("అర్జించుకో"),
  rule("అర్జవైనా"),
  rule("దయచేసి"),
  rule("తెప్పించండి"),
  rule("ఎండిపోతుంది"),
  rule("give water"),
  rule("send water"),
  rule("release water"),
  // English request shapes the demo seeds. "Water needed for my crop." is a request with the
  // verb after the noun, so "need water" alone does not catch it.
  rule("water needed", 2),
  rule("water is needed", 2),
  rule("short of water", 2),
  rule("short turn", 2),
];

/** Wording that lowers urgency: thanks, confirmation, deference, "whenever possible". */
const CALM_TERMS: readonly Rule[] = [
  rule("ధన్యవాదాలు", 2),
  rule("ధర్వించాను", 2),
  rule("హాజరవుతాను", 2),
  rule("హాజరు అవుతాను", 2),
  rule("అవగాహన", 2),
  rule("ఆశ్వర్యం", 2),
  rule("సరే", 2),
  rule("ఓకే", 2),
  rule("వీలైనప్పుడు", 2),
  rule("తర్వాత చేయండి", 2),
  rule("thanks", 2),
  rule("thank you", 2),
  rule("understood", 2),
  rule("no problem", 2),
  rule("ok", 2),
  rule("okay", 2),
  rule("sure", 1),
  rule("never mind", 2),
];

/**
 * Per-intent keyword tables. Terms are written so that the most specific / longest phrasings carry
 * the strength and the shorter stems carry the rest; `matchTerms` de-duplicates overlapping spans.
 */
const INTENT_RULES: Readonly<Record<Exclude<Intent, "other">, readonly Rule[]>> = {
  urgent_request: [
    ...STRESS_TERMS,
    ...URGENCY_TERMS,
    ...REQUEST_TERMS,
    rule("రాత్రి విడుదల"),
    rule("అర్జవైనా"),
    rule("ఇప్పుడే వాడాలి"),
    rule("రోజువారీగా అవసరం"),
    rule("తాగాగా"),
    rule("ఎప్పుడైనా పంపండి"),
    // English growth-stage stress: "my maize is tasseling", "my paddy is flowering".
    rule("tasseling", 2),
    rule("tasselling", 2),
    rule("flowering", 2),
  ],
  buffer_request: [
    rule("బఫర్", 2),
    rule("బఫరు", 2),
    rule("ఉమ్మడి బఫర్", 2),
    rule("అదనపు నీరు", 2),
    rule("కొంచెం ఎక్కువ", 2),
    rule("buffer", 2),
    rule("extra water", 2),
    rule("short turn", 2),
    rule("short of water", 2),
    rule("tail end", 1),
    rule("ఇంకావసరం"),
    rule("తక్కువ ఉంది"),
    rule("వేపరి"),
  ],
  not_needed_this_week: [
    rule("అవసరం లేదు", 2),
    rule("కావలసదులేదు", 2),
    rule("కావద్దనివ్వు", 2),
    rule("నీరు వద్దు", 2),
    rule("ఈ వారం కాదు", 2),
    rule("ఇప్పుడు కాదు", 2),
    rule("వద్దు", 1),
    rule("తర్వాత"),
    rule("not needed", 2),
    rule("no need", 2),
    rule("don't need", 2),
    rule("dont need", 2),
    rule("not required", 2),
  ],
  harvested: [
    rule("పంట కోత", 2),
    rule("కోత చేసేశాను", 2),
    rule("కోసేశాను", 2),
    rule("తీసేశాను", 2),
    rule("పంట తీస", 2),
    rule("కోత దిగుమతి", 2),
    rule("హార్వెస్ట్", 2),
    rule("harvest", 2),
    rule("harvested", 2),
    rule("కోత"),
    rule("పంట పూడింది"),
    rule("కోసి వచ్చాను"),
  ],
  schedule_question: [
    rule("ఎప్పుడు", 2),
    rule("ఏ సమయంలో", 2),
    rule("ఏ గంట", 2),
    rule("ఎంపి", 2),
    rule("షెడ్యూల్", 2),
    rule("రోస్టర్", 2),
    rule("క్రమం", 1),
    rule("schedule", 2),
    rule("roster", 2),
    rule("what time", 2),
    rule("ఎప్పుడు విడుదల", 2),
    rule("విడుదల ఎప్పుడు", 2),
  ],
  acknowledge: [
    rule("ధృవీకరిస్తున్నాను", 2),
    rule("ధృవీకరిస్తాను", 2),
    rule("ధృవీకరించు", 2),
    rule("హాజరవుతాను", 2),
    rule("హాజరు అవుతాను", 2),
    rule("ధన్యవాదాలు", 2),
    rule("అర్జవైనా", 1),
    rule("సరే", 2),
    rule("ఓకే", 2),
    rule("అవును", 1),
    rule("అవగాహన", 2),
    rule("సరైనది"),
    rule("ఇలా చేయండి"),
    rule("ok", 2),
    rule("okay", 2),
    rule("yes", 1),
    rule("acknowledge", 2),
    rule("acknowledged", 2),
    rule("i will be there", 2),
    rule("thanks", 2),
  ],
};

/**
 * Tie-break order. When two intents score equally the earlier one wins. `urgent_request` leads
 * because a missed emergency costs a crop, while a false `urgent_request` only costs a coordinator
 * thirty seconds — the asymmetry is deliberate. `not_needed_this_week` sits below `harvested`
 * because "crop is done, quota back to buffer" is the more specific statement of the two.
 */
const INTENT_PRIORITY: readonly Exclude<Intent, "other">[] = [
  "urgent_request",
  "harvested",
  "schedule_question",
  "buffer_request",
  "not_needed_this_week",
  "acknowledge",
];

/* ------------------------------------------------------------------ matching */

interface Match {
  readonly strength: number;
  readonly hits: readonly string[];
}

function spansOverlap(spans: readonly (readonly [number, number])[], from: number, to: number): boolean {
  return spans.some(([a, b]) => from < b && a < to);
}

/**
 * Counts rule strength for one term list, counting each span of text at most once. Without this,
 * "నీరు వద్దు" would score both "నీరు వద్దు" (2) and "వద్దు" (1).
 */
function matchTerms(text: string, rules: readonly Rule[]): Match {
  const ordered = [...rules].sort((a, b) => b.term.length - a.term.length);
  const covered: (readonly [number, number])[] = [];
  let strength = 0;
  const hits: string[] = [];

  for (const { term, strength: weight } of ordered) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(term, from);
      if (at < 0) break;
      const end = at + term.length;
      if (!spansOverlap(covered, at, end)) {
        covered.push([at, end] as const);
        strength += weight;
        hits.push(term);
      }
      from = at + 1;
    }
  }
  return { strength, hits };
}

function matches(text: string, rules: readonly Rule[]): boolean {
  return rules.some((r) => text.includes(r.term));
}

/* ------------------------------------------------------------------ urgency scoring */

const URGENCY_BASE = 0.15;
const STRESS_WEIGHT = 0.4;
const MILD_DISTRESS_WEIGHT = 0.2;
const URGENCY_ADVERB_WEIGHT = 0.15;
const REQUEST_WEIGHT = 0.1;
const CALM_WEIGHT = 0.15;
const CALM_CAP = 0.45;
const NEGATION_CAP = 0.3;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Weighted urgency for a message that matched **something**. Each band is capped so a farmer who
 * says the same distressed word three times cannot outrank a farmer who is both distressed *and*
 * asking for an immediate release. Negations and acknowledgements push the score down.
 *
 * `URGENCY_BASE` is only added here, never for a message that matched no term at all: an unmatched
 * message is returned as explicitly unscored by {@link classifyByRules} instead of being handed the
 * floor as if it were a measurement. See {@link isUnscored}.
 */
function scoreUrgency(text: string, negationStrength: number): number {
  let score = URGENCY_BASE;

  if (matches(text, STRESS_TERMS)) score += STRESS_WEIGHT;
  else if (matches(text, DISTRESS_TERMS)) score += MILD_DISTRESS_WEIGHT;

  if (matches(text, URGENCY_TERMS)) score += URGENCY_ADVERB_WEIGHT;
  if (matches(text, REQUEST_TERMS)) score += REQUEST_WEIGHT;

  const calmHits = matchTerms(text, CALM_TERMS).hits.length;
  score -= Math.min(CALM_CAP, calmHits * CALM_WEIGHT);

  score -= Math.min(NEGATION_CAP, negationStrength * NEGATION_CAP);

  return clamp01(score);
}

/* ------------------------------------------------------------------ classification */

/**
 * The explicit "nothing matched" state.
 *
 * `System1Result` has no `unscored` / `reasons` field and the contract is immutable, so the state is
 * encoded in the fields that do exist: `intent: "other"`, `intent_confidence: 0` (no confidence at
 * all, not a low one), `urgency: 0` as the schema-valid numeric placeholder, and no crop stress.
 * The numeric field stays valid for `triage_score`; {@link isUnscored} is the reader that turns the
 * combination back into the marker, so no caller has to re-derive it.
 */
function unscored(): System1Result {
  return build("other", 0, 0, false);
}

function build(intent: Intent, confidence: number, urgency: number, stress: boolean): System1Result {
  return System1Result.parse({
    intent,
    intent_confidence: clamp01(confidence),
    urgency: clamp01(urgency),
    mentions_crop_stress: stress,
    source: "rules",
  });
}

/**
 * True when the deterministic rules matched no signal at all — no intent, stress, distress, urgency,
 * request or calm term — so `urgency` is a placeholder rather than a measurement.
 *
 * The contract cannot express "unscored" directly (no contract change is allowed), so the marker is
 * the only combination {@link unscored} emits: `source: "rules"`, `intent: "other"`,
 * `intent_confidence: 0`, `urgency: 0`, no crop stress. A model result is never unscored even if it
 * happens to carry those values under `source: "laya" | "jev"`.
 */
export function isUnscored(result: System1Result): boolean {
  return (
    result.source === "rules" &&
    result.intent === "other" &&
    result.intent_confidence === 0 &&
    result.urgency === 0 &&
    !result.mentions_crop_stress
  );
}

/** Confidence rises with the number and strength of matches: one weak hit ≈ 0.35, many ≈ 0.95. */
function confidenceFor(strength: number): number {
  return Math.min(0.95, 0.25 + 0.1 * strength);
}

/**
 * The last-resort System-1 classifier. Never throws, never returns null.
 *
 * @param text raw transcript or typed message, Telugu script or English/Tenglish.
 */
export function classifyByRules(text: string): System1Result {
  const normalized = normalizeText(text);

  if (normalized.length === 0) {
    return unscored();
  }

  const scores = new Map<Exclude<Intent, "other">, Match>();
  for (const intent of INTENT_PRIORITY) {
    scores.set(intent, matchTerms(normalized, INTENT_RULES[intent]));
  }

  let best: Exclude<Intent, "other"> | null = null;
  let bestStrength = 0;
  for (const intent of INTENT_PRIORITY) {
    const match = scores.get(intent);
    const strength = match?.strength ?? 0;
    if (strength > bestStrength) {
      best = intent;
      bestStrength = strength;
    }
  }

  const stress = matches(normalized, STRESS_TERMS);
  const distress = matches(normalized, DISTRESS_TERMS);
  const crop = matches(normalized, CROP_TERMS);
  const mentionsCropStress = stress || (crop && distress);

  const urgencyMarker = matches(normalized, URGENCY_TERMS);
  const requestMarker = matches(normalized, REQUEST_TERMS);
  const calmHits = matchTerms(normalized, CALM_TERMS).hits.length;

  const negationStrength = scores.get("not_needed_this_week")?.strength ?? 0;

  // No term in any table fired: there is nothing to score, so return the explicit unscored marker
  // rather than dressing `URGENCY_BASE` up as a measurement. `crop` alone is deliberately not a
  // signal — naming a crop is not asking for water.
  const hasSignal = best !== null || distress || urgencyMarker || requestMarker || calmHits > 0;
  if (!hasSignal) {
    return unscored();
  }

  return build(
    best ?? "other",
    best === null ? 0.15 : confidenceFor(bestStrength),
    scoreUrgency(normalized, negationStrength),
    mentionsCropStress,
  );
}

/* ------------------------------------------------------------------ slot extraction */

/** Volume units in m³, longest first so `క్యూబిక్ మీటర్లు` wins over a hypothetical `మీటర్`. */
const VOLUME_UNITS: readonly string[] = [
  "క్యూబిక్ మీటర్లు",
  "క్యూబిక్ మీటర్",
  "క్యూబిక మీటర్లు",
  "క్యూబిక మీటర్",
  "ఘన మీటర్లు",
  "ఘన మీటర్",
  "ఘనమేటరు",
  "క్యు మీ",
  "క్యు.మీ",
  "cubic metres",
  "cubic metre",
  "cubic meters",
  "cubic meter",
  "cbm",
  "మీ3",
  "m3",
  "m³",
];

const HOUR_UNITS: readonly string[] = [
  "గంటలు",
  "గంటల",
  "గంట",
  "hours",
  "hour",
  "hrs",
  "hr",
];

/** Telugu (and English) number words a farmer uses out loud. Deliberately short of a full agglutinative parser. */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  "ఒక": 1,
  "ఒకటి": 1,
  "రెండు": 2,
  "మూడు": 3,
  "నాలుగు": 4,
  "ఐదు": 5,
  "ఆరు": 6,
  "ఎడు": 7,
  "ఎనిమిది": 8,
  "నెనిమిది": 8,
  "తొమ్మిది": 9,
  "పది": 10,
  "పదకొండు": 11,
  "పన్నెండు": 12,
  "పదమూడు": 13,
  "పద్నాలుగు": 14,
  "పదిహేను": 15,
  "పదహారు": 16,
  "పదిహేడు": 17,
  "పద్దెనిమిది": 18,
  "పంతొమ్మిది": 19,
  "ఇరవై": 20,
  "ముప్పై": 30,
  "నలభై": 40,
  "యాభై": 50,
  "అరవై": 60,
  "డెబ్బై": 70,
  "ఎనభై": 80,
  "తొంభై": 90,
  "వంద": 100,
  "వేయ": 1000,
  "one": 1,
  "two": 2,
  "three": 3,
  "four": 4,
  "five": 5,
  "six": 6,
  "seven": 7,
  "eight": 8,
  "nine": 9,
  "ten": 10,
  "half": 0.5,
};

const MAX_PLAUSIBLE_M3 = 1_000_000;
const MAX_PLAUSIBLE_HOURS = 24 * 31;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reads a Telugu or English number immediately before `unit`: either digits (`100`, `2.5`) or one of
 * the spoken number words (`రెండు`, `వంద`). Returns null when neither is present or the value is
 * not plausible for irrigation, so callers can ask the farmer rather than guess.
 */
function numberBefore(text: string, unit: string): number | null {
  const escaped = escapeRegExp(unit);
  const digits = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${escaped})`);
  const digitMatch = digits.exec(text);
  if (digitMatch?.[1] !== undefined) {
    const value = Number.parseFloat(digitMatch[1]);
    if (Number.isFinite(value)) return value;
  }

  const words = Object.keys(NUMBER_WORDS)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const spelled = new RegExp(`(${words})\\s*(?:${escaped})`);
  const spelledMatch = spelled.exec(text);
  const word = spelledMatch?.[1];
  if (word !== undefined) {
    return NUMBER_WORDS[word] ?? null;
  }
  return null;
}

/**
 * Volume in m³ explicitly requested in the message, or null when the message does not state one.
 *
 * Deliberately conservative: it reads only an explicit quantity ("100 cubic metres",
 * "100 క్యూబిక్ మీటర్"). It never converts litres, acres or hours into m³, because discharge and
 * plot area belong to the deterministic core (`@jadal/core`) — see `extractRequestedHours` for the
 * hour-shaped request, and let the core turn hours into a volume.
 */
export function extractVolumeM3(text: string): number | null {
  const normalized = normalizeText(text);
  for (const unit of VOLUME_UNITS) {
    const value = numberBefore(normalized, unit);
    if (value === null) continue;
    if (value < 0 || !Number.isFinite(value)) continue;
    if (value > MAX_PLAUSIBLE_M3) return null;
    return value;
  }
  return null;
}

/**
 * Duration in hours explicitly requested ("రెండు గంటలు", "3 hours", "అర్ధగంట"), else null.
 * Not folded into `extractVolumeM3`: hours are a scheduling input, not a volume, and the
 * discharge needed to convert them lives in `@jadal/core`'s roster engine.
 */
export function extractRequestedHours(text: string): number | null {
  const normalized = normalizeText(text);

  if (normalized.includes("అర్ధగంట") || normalized.includes("అర్ధ గంట") || normalized.includes("half an hour")) {
    return 0.5;
  }

  for (const unit of HOUR_UNITS) {
    const value = numberBefore(normalized, unit);
    if (value === null) continue;
    if (value <= 0 || value > MAX_PLAUSIBLE_HOURS) return null;
    return value;
  }
  return null;
}
