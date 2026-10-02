/**
 * Telugu (te-IN) message templates for the caller agent (`ADR-003`) and the WhatsApp/voice channels.
 *
 * These are **natural Telugu**, not transliterated English and not English word order with Telugu
 * nouns. A farmer on a night call has to hear a sentence a Telugu speaker would have said, so the
 * grammar is the imperative/oblique case Telugu actually uses for addressing a farmer
 * (`… గారు` vocative, `-కి` dative for "to you", `…లో` locative for "at the outlet"), and canal
 * vocabulary follows the Warabandi usage the research quotes: వంతు (turn/water allotment),
 * కాలువ (canal), విడుదల (release), కేటాయించిన పరిమాణం (allocated volume), కోటా (quota).
 *
 * Numbers and clock times stay in the digits a farmer reads on a ration card or a WhatsApp message
 * — `180 m³`, `10:30` — rather than being spelled out in Telugu words, because the phone UI, the
 * roster sheet and the ledger all show digits and a mismatched form is harder to verify than a
 * translated one.
 *
 * Every builder is pure, total and side-effect free, and every one of them accepts the *facts* the
 * caller already holds (window start/end, outlet, chainage, allocated volume, farmer name) rather
 * than prose, so the same template renders for a WhatsApp body, a voice script and a portal row.
 * There is one `Te`/`En` builder per message so `Contact.message_te` and `Contact.message_en` are
 * always the same message in two languages rather than two messages that drifted apart.
 */

import type { Contact } from "@jadal/contracts";

/* ------------------------------------------------------------------ facts */

/**
 * The concrete facts a farmer-facing message can carry.
 *
 * All fields are optional because no single message needs all of them, and because the contract's
 * `Contact` has no structured facts column — the caller agent holds them. A builder that is given
 * the fact it needs always renders it; a builder given a missing optional fact degrades to a
 * shorter, still-correct sentence rather than printing `undefined`.
 */
export interface MessageFacts {
  /** Farmer's name as held on `Farmer.name`, usually Telugu script. Drives the vocative. */
  readonly farmerName?: string;
  /** Release window start, ISO-8601 UTC. Rendered in IST (`HH:MM`). */
  readonly windowStart?: string;
  /** Release window end, ISO-8601 UTC. Rendered in IST (`HH:MM`). */
  readonly windowEnd?: string;
  /** `Outlet.name`, e.g. `Outlet 4B (Tail End)`. */
  readonly outletName?: string;
  /** `Outlet.chainage_m`, the distance from the canal head. */
  readonly chainageM?: number;
  /** Allocated volume at the field gate, m³. */
  readonly allocatedM3?: number;
  /** Rainfall behind a postponement, mm (§7.4). */
  readonly rainMm?: number;
  /** Hours until the postponed turn, for the rain message. */
  readonly leadHours?: number;
  /** `RequestStatus`, rendered verbatim so the farmer's own screen matches the call. */
  readonly requestStatus?: string;
  /** Volume on the request under discussion, m³. */
  readonly requestVolumeM3?: number;
  /** Free-text status shown to the farmer, e.g. `rejected` in their language. */
  readonly statusLabelTe?: string;
  /** True when this turn is sized longer than equal hours to compensate for seepage losses down the canal. */
  readonly isLongerTurn?: boolean;
  /** Alias for isLongerTurn. */
  readonly isLongerThanBaseline?: boolean;
}

/** A message in both languages. Matches the `message_te` / `message_en` pair on `Contact`. */
export interface MessagePair {
  readonly te: string;
  readonly en: string;
}

/* ------------------------------------------------------------------ IST formatting */

/**
 * Asia/Kolkata is UTC+05:30 with **no daylight saving, ever** — India has not observed DST since
 * 1945 and has no scheduled transition. The offset is therefore fixed arithmetic, not a timezone
 * database lookup.
 *
 * ASSUMED — and noted honestly in the report: `src/db/clock.ts` holds the same constant
 * (`IST_OFFSET_MINUTES`) for the night-release rule. It is duplicated here on purpose: this module
 * renders an *arbitrary* instant (a window start from a roster row) and is imported by tests that
 * must not drag the event store — and, through it, `@jadal/core` — into the module graph. A display
 * formatter must not depend on the store.
 */
const IST_OFFSET_MINUTES = 330;
const MS_PER_MINUTE = 60_000;

/** Shift a parsed instant into IST and return its `Date` fields. `null` if `iso` is not a date. */
function shiftedToIst(iso: string): Date | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

/**
 * An ISO-8601 instant as IST wall-clock time, `HH:MM` — e.g. `2026-09-15T05:00:00Z` → `10:30`.
 *
 * This is the form the WhatsApp example in §6 of the research doc uses, and the form a farmer reads
 * off the roster sheet. Returns `""` for an unparseable instant so a template never prints `Invalid
 * Date` into a message that is about to be spoken aloud.
 */
export function formatIstTime(iso: string | undefined): string {
  if (iso === undefined) return "";
  const shifted = shiftedToIst(iso);
  if (shifted === null) return "";
  const hh = shifted.getUTCHours().toString().padStart(2, "0");
  const mm = shifted.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * An ISO-8601 instant as IST calendar date `DD-MM-YYYY` — e.g. `2026-10-02T00:00:00Z` →
 * `02-10-2026`.
 *
 * Day-first with dashes, matching the WhatsApp payload in §6 of the research doc, which is how
 * Andhra Pradesh writes dates. Note this is deliberately *not* `WeatherDay.date`, which is ISO
 * `YYYY-MM-DD` and is never re-formatted: the contract stays machine-readable and only prose is
 * localised.
 */
export function formatIstDate(iso: string | undefined): string {
  if (iso === undefined) return "";
  const shifted = shiftedToIst(iso);
  if (shifted === null) return "";
  const yyyy = shifted.getUTCFullYear().toString().padStart(4, "0");
  const mm = (shifted.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = shifted.getUTCDate().toString().padStart(2, "0");
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * A millimetre depth: `180` → `180`, `12.5` → `12.5`. Whole numbers lose the decimal place; 1 dp is
 * more precision than a forecast or a roster sheet carries, and fewer digits is fewer syllables for
 * the TTS to get wrong.
 */
export function formatMillimetres(mm: number | undefined): string {
  if (mm === undefined || !Number.isFinite(mm)) return "";
  const rounded = Math.round(mm * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}

/** {@link formatMillimetres} named for the quantity it carries when it holds an allocated volume. */
export function formatVolumeM3(volume: number | undefined): string {
  return formatMillimetres(volume);
}

/** Chainage, whole metres: `4B`-style outlet labels are text, but chainage is always a number. */
export function formatChainageM(chainageM: number | undefined): string {
  if (chainageM === undefined || !Number.isFinite(chainageM)) return "";
  return Math.round(chainageM).toString();
}

/* ------------------------------------------------------------------ the vocative suffix */

/**
 * GENDER, HONESTLY.
 *
 * `Farmer` in `@jadal/contracts` has no gender field, so the vocative suffix has to be inferred from
 * the spelling of the name. `గారు` — the respectful honorific — is the default because it is
 * **gender-neutral** in Telugu and is what a farmer is actually addressed with, so a wrong guess
 * here produces ordinary Telugu rather than something wrong. The feminine form `గారి` is used only
 * when the name carries a suffix that is high-precision feminine.
 *
 * The heuristic is a small, deliberately conservative suffix list rather than a general rule,
 * because Telugu is written in logical order: a vowel sign or a virama is always the *last* code
 * point, so `endsWith` must be given the whole suffix including its signs (`మ్మ` = మ + ్ + మ, three
 * code points, matches `సీతమ్మ`).
 *
 * KNOWN LIMITS — it will get these wrong, and the only mitigation is that `గారు` is gender-neutral
 * so a *false negative* stays ordinary Telugu:
 *   * False negative: a woman called `లక్ష్మీ` or `సరస్వతి` ends in a vowel sign, not in any listed
 *     suffix, so she gets `గారు`. Harmless — `లక్ష్మీ గారు` is what she would be called anyway.
 *   * False positive: possible on a male name that happens to end in a listed suffix. `మ్మ`, `దేవి`
 *     and `బాయి` are near-exclusively feminine or are themselves women's honorifics, but there is
 *     no corpus behind this list — it is a judgement about the language, not a measurement.
 *   * Compounds and transliterated names (`బిట్టి`, `స్టారీ`, `హార్డ్`) carry no signal at all.
 *   * Surnames (`రెడ్డి`, `నాయుడు`) say nothing about the person, which is why only the given name
 *     is inspected; a stored name of "రెడ్డి" alone can never match.
 * The correct fix is a `gender` field on `Farmer`, which needs a contracts change; until then this is
 * a display heuristic and must not be used for anything a farmer is graded on.
 */
const FEMININE_NAME_ENDINGS: readonly string[] = ["మ్మ", "దేవి", "బాయి"];

/** Gender-neutral respectful honorific — the default, and correct for any farmer. */
export const NEUTRAL_VOCATIVE = "గారు";
/** Feminine respectful honorific, used only when {@link isLikelyFemaleName} is confident. `గుడి` is
 *  the Rayalaseema / Western-Andhra form of address, which is this canal's own command area. */
export const FEMININE_VOCATIVE = "గుడి";

/** Honorifics a stored name may already carry; stripped so one is not appended twice. */
const TRAILING_HONORIFICS: readonly string[] = ["అయ్యారు", "గారు", "గుడి", "నారి", "గారి"];

/** Is this given name very likely feminine? See {@link FEMININE_NAME_ENDINGS} for the limits. */
export function isLikelyFemaleName(name: string): boolean {
  return FEMININE_NAME_ENDINGS.some((ending) => name.endsWith(ending));
}

/** Drop a trailing honorific so `రమణ గారు` is treated as the stem `రమణ`. */
function nameStem(name: string): string {
  let trimmed = name.trim();
  for (const honorific of TRAILING_HONORIFICS) {
    // `>` rather than `>=`: a name that *is* just the honorific yields an empty stem, and the caller
    // then falls back to a bare greeting instead of addressing "గారు గారు".
    if (trimmed.length > honorific.length && trimmed.endsWith(honorific)) {
      trimmed = trimmed.slice(0, trimmed.length - honorific.length).trim();
      break;
    }
  }
  return trimmed;
}

/** `వెంకటేశ్వర్లు` + `గారు`, or `సీతమ్మ` + `గారి`. Falls back to an empty string for no name. */
function vocative(name: string | undefined): string {
  if (name === undefined) return "";
  const stem = nameStem(name);
  if (stem.length === 0) return "";
  return `${stem} ${isLikelyFemaleName(stem) ? FEMININE_VOCATIVE : NEUTRAL_VOCATIVE}`;
}

/* ------------------------------------------------------------------ shared fragments */

/**
 * Opening clause with the farmer addressed, falling back to a bare greeting when no name is held —
 * a message with no name in it still has to be sendable.
 */
function greetingTe(facts: MessageFacts): string {
  const addressed = vocative(facts.farmerName);
  return addressed.length === 0 ? "నమస్కారం." : `నమస్కారం ${addressed},`;
}

function greetingEn(facts: MessageFacts): string {
  const name = facts.farmerName?.trim();
  return name === undefined || name.length === 0 ? "Hello." : `Hello ${name},`;
}

/** `అవుట్‌లెట్ 4B (టైల్-ఎండ్)` — the outlet clause, or `""` when no outlet is held. */
function outletClauseTe(facts: MessageFacts): string {
  const chainage = formatChainageM(facts.chainageM);
  if (facts.outletName === undefined || facts.outletName.trim().length === 0) return "";
  return chainage.length === 0 ? `${facts.outletName} వద్ద` : `${facts.outletName} వద్ద (చెయినేజీ ${chainage} మీటర్లు)`;
}

function outletClauseEn(facts: MessageFacts): string {
  const chainage = formatChainageM(facts.chainageM);
  if (facts.outletName === undefined || facts.outletName.trim().length === 0) return "";
  return chainage.length === 0 ? `${facts.outletName}` : `${facts.outletName} (chainage ${chainage} m)`;
}

/** `రాత్రి 10:30 నుండి 01:00 IST వరకు` / `from 10:30 to 01:00 IST`, or `""` without a start. */
function windowClauseTe(facts: MessageFacts): string {
  const start = formatIstTime(facts.windowStart);
  if (start.length === 0) return "";
  const end = formatIstTime(facts.windowEnd);
  return end.length === 0 ? `${start} IST నుండి` : `${start} నుండి ${end} IST వరకు`;
}

function windowClauseEn(facts: MessageFacts): string {
  const start = formatIstTime(facts.windowStart);
  if (start.length === 0) return "";
  const end = formatIstTime(facts.windowEnd);
  return end.length === 0 ? `from ${start} IST` : `from ${start} to ${end} IST`;
}

/** `180 ఘన మీటర్లు` / `180 cubic metres`, or `""` without a volume. */
function volumeClauseTe(facts: MessageFacts): string {
  const volume = formatVolumeM3(facts.allocatedM3);
  return volume.length === 0 ? "" : `${volume} ఘన మీటర్లు`;
}

function volumeClauseEn(facts: MessageFacts): string {
  const volume = formatVolumeM3(facts.allocatedM3);
  return volume.length === 0 ? "" : `${volume} cubic metres`;
}

/** Does this turn carry longer duration to compensate for canal seepage loss? */
export function isLongerTurn(facts: MessageFacts): boolean {
  return Boolean(facts.isLongerTurn || facts.isLongerThanBaseline);
}

/**
 * Explanation of why tail turns are longer than equal-hours baseline on an unlined canal:
 * part of the water soaks into the canal on the way, so tail farms get a longer turn.
 */
export function whyLongerClauseTe(facts: MessageFacts): string {
  if (!isLongerTurn(facts)) return "";
  return "దారిలో కొంత నీరు కాలువలో ఇంకిపోతుంది, అందుకే ప్రతి పొలానికి న్యాయమైన వాటా అందేలా చివరి పొలాలకు ఎక్కువ సమయం వంతు ఇస్తారు.";
}

export function whyLongerClauseEn(facts: MessageFacts): string {
  if (!isLongerTurn(facts)) return "";
  return "Part of the water soaks into the canal on the way, so tail farms get a longer turn so every farm receives its fair share of water.";
}

/** Telugu translations for known request statuses. */
const STATUS_MAP_TE: Readonly<Record<string, string>> = {
  approved: "ఆమోదించబడింది",
  rejected: "తిరస్కరించబడింది",
  scheduled: "ఖరారైంది",
  released: "విడుదలయింది",
  delivered: "అందింది",
  confirmed: "ధృవీకరించబడింది",
  cancelled: "రద్దయింది",
  expired: "గడువు ముగిసింది",
  raised: "వేచి ఉంది",
  triaged: "వేచి ఉంది",
};

/** Join non-empty clauses with a single space, dropping the ones that are not there. */
function join(...parts: readonly string[]): string {
  return parts.filter((part) => part.trim().length > 0).join(" ").replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ templates */

/**
 * The roster for this farmer's turn has changed.
 *
 * Triggered by `Contact.purpose: "roster_change"` after a re-plan. Leads with what changed, then the
 * facts a farmer needs to act on: which outlet, how far down the canal, how much water, and when.
 */
export function rosterChangeTe(facts: MessageFacts): string {
  return join(
    "జడల్: మీరు పొందబోయే నీటి వంతులో మార్పు జరిగింది.",
    greetingTe(facts),
    outletClauseTe(facts),
    dayClauseTe(facts).length === 0 ? "" : `మీ విడుదల రోజు ${dayClauseTe(facts)}.`,
    windowClauseTe(facts).length === 0 ? "" : `మీరు పొందే విడుదల సమయం ${windowClauseTe(facts)}.`,
    volumeClauseTe(facts).length === 0 ? "" : `మీకు కేటాయించిన పరిమాణం ${volumeClauseTe(facts)}.`,
    whyLongerClauseTe(facts),
    "కొత్త సమయానికి సిద్ధంగా ఉండండి. నిర్ధారించడానికి 1 నొక్కండి లేదా మాట్లాడి చెప్పండి.",
  );
}

export function rosterChangeEn(facts: MessageFacts): string {
  return join(
    "Jadal: your water turn has been rescheduled.",
    greetingEn(facts),
    outletClauseEn(facts),
    dayClauseEn(facts).length === 0 ? "" : `Your release day is ${dayClauseEn(facts)}.`,
    windowClauseEn(facts).length === 0 ? "" : `Your release window is ${windowClauseEn(facts)}.`,
    volumeClauseEn(facts).length === 0 ? "" : `Your allocated volume is ${volumeClauseEn(facts)}.`,
    whyLongerClauseEn(facts),
    "Please be ready at the new time. Press 1 to confirm, or speak your reply.",
  );
}

/**
 * Night-release warning.
 *
 * Releases frequently run at 23:00 or 02:00, so this is the message that gets a farmer out of bed and
 * to the field gate. §4 of the research notes these are Service/Implicit water-utility alerts and are
 * permitted 24×7, which is why this template exists rather than a daylight-only one.
 */
export function nightReleaseWarningTe(facts: MessageFacts): string {
  return join(
    "జడల్: రాత్రి నీటి విడుదల హెచ్చరిక.",
    greetingTe(facts),
    outletClauseTe(facts),
    dayClauseTe(facts).length === 0 ? "" : `విడుదల రోజు ${dayClauseTe(facts)}.`,
    windowClauseTe(facts).length === 0 ? "" : `మీ విడుదల ${windowClauseTe(facts)} ప్రారంభమవుతుంది.`,
    volumeClauseTe(facts).length === 0 ? "" : `మీరు ${volumeClauseTe(facts)} పొందుతారు.`,
    whyLongerClauseTe(facts),
    "దయచేసి పొలం గేటు తెరవడానికి సిద్ధంగా ఉండండి. నిర్ధారించడానికి 1 నొక్కండి లేదా మాట్లాడి చెప్పండి. నీరు రాలేదంటే మా కాలువ కార్యాలయానికి వెంటనే తెలియజేయండి.",
  );
}

export function nightReleaseWarningEn(facts: MessageFacts): string {
  return join(
    "Jadal: night water-release alert.",
    greetingEn(facts),
    outletClauseEn(facts),
    dayClauseEn(facts).length === 0 ? "" : `The release day is ${dayClauseEn(facts)}.`,
    windowClauseEn(facts).length === 0 ? "" : `Your release starts ${windowClauseEn(facts)}.`,
    volumeClauseEn(facts).length === 0 ? "" : `You will receive ${volumeClauseEn(facts)}.`,
    whyLongerClauseEn(facts),
    "Please be ready to open your field gate. Press 1 to confirm, or speak your reply. Call the canal office at once if the water does not reach you.",
  );
}

/**
 * Release postponed because of rain.
 *
 * §7.4 item 4: a forecast `precipitation_sum >= 15.0 mm` triggers the rain re-plan — turns are
 * deferred and the saved volume moves into the common buffer pool. The reassuring half of the
 * message matters as much as the news: a farmer whose turn is deferred believes his quota is gone.
 */
export function rainPostponedTe(facts: MessageFacts): string {
  const rain = formatMillimetres(facts.rainMm);
  const lead = facts.leadHours === undefined || !Number.isFinite(facts.leadHours) ? "" : `రోజువారీ ${Math.round(facts.leadHours)} గంటల్లో `;
  const volume = volumeClauseTe(facts);
  const window = windowClauseTe(facts);
  return join(
    "జడల్: వర్షం కారణంగా మీ నీటి విడుదల వాయిదా వేయబడింది.",
    greetingTe(facts),
    rain.length === 0 ? "" : `రోజువారీ ${rain} మిమీ వర్షం నమోదైంది.`,
    outletClauseTe(facts),
    window.length === 0 ? "" : `${window} ప్రారంభమయ్యే విడుదల వాయిదా అయింది.`,
    `${lead}మీకు కేటాయించిన పరిమాణం ${volume.length === 0 ? "" : `${volume} `}ఉంచబడుతుంది.`,
    "మీ కోటా సురక్షితంగా ఉంది. కొత్త సమయం తెలిసిన వెంటనే తెలియజేస్తాము.",
  );
}

export function rainPostponedEn(facts: MessageFacts): string {
  const rain = formatMillimetres(facts.rainMm);
  const lead = facts.leadHours === undefined || !Number.isFinite(facts.leadHours) ? "" : `in about ${Math.round(facts.leadHours)} hours, `;
  const window = windowClauseEn(facts);
  return join(
    "Jadal: your water release has been postponed because of rain.",
    greetingEn(facts),
    rain.length === 0 ? "" : `${rain} mm of rain is forecast.`,
    outletClauseEn(facts),
    window.length === 0 ? "" : `the release starting ${window} has been postponed.`,
    `${lead}your allocated volume of ${volumeClauseEn(facts)} is carried forward unchanged.`,
    "Your quota is safe. We will tell you the new time as soon as it is fixed.",
  );
}

/**
 * Status of a raised water request (`Contact.purpose: "request_update"`).
 *
 * The status is rendered verbatim, because it is the same token the farmer reads in the portal and
 * on the WhatsApp thread; a translated status would make the call and the screen disagree.
 */
export function requestUpdateTe(facts: MessageFacts): string {
  const status = facts.statusLabelTe ?? (facts.requestStatus ? (STATUS_MAP_TE[facts.requestStatus] ?? facts.requestStatus) : "తెలియడం లేదు");
  return join(
    "జడల్: మీ నీటి అభ్యర్థన స్థితి.",
    greetingTe(facts),
    `స్థితి: ${status}.`,
    facts.requestVolumeM3 === undefined ? "" : `మీరు అభ్యర్థించిన పరిమాణం ${formatVolumeM3(facts.requestVolumeM3)} ఘన మీటర్లు.`,
    outletClauseTe(facts),
    windowClauseTe(facts).length === 0 ? "" : `ఎప్పుడు పొందుతారో అయితే: ${windowClauseTe(facts)}.`,
    whyLongerClauseTe(facts),
    "వివరాలకు మా కాలువ కార్యాలయాన్ని సంప్రదించండి.",
  );
}

export function requestUpdateEn(facts: MessageFacts): string {
  const status = facts.requestStatus ?? "unknown";
  return join(
    "Jadal: status of your water request.",
    greetingEn(facts),
    `Status: ${status}.`,
    facts.requestVolumeM3 === undefined ? "" : `You asked for ${formatVolumeM3(facts.requestVolumeM3)} cubic metres.`,
    outletClauseEn(facts),
    windowClauseEn(facts).length === 0 ? "" : `Expected release: ${windowClauseEn(facts)}.`,
    whyLongerClauseEn(facts),
    "Contact the canal office for details.",
  );
}

/**
 * Upcoming-turn reminder (`Contact.purpose: "reminder"`), sent a few hours ahead.
 *
 * Deliberately shorter than the warning: a reminder that repeats the whole message gets ignored,
 * which is the one outcome a reminder cannot have.
 */
export function reminderTe(facts: MessageFacts): string {
  return join(
    "జడల్: మీ నీటి వంతు గుర్తింపు.",
    greetingTe(facts),
    outletClauseTe(facts),
    dayClauseTe(facts).length === 0 ? "" : `విడుదల రోజు ${dayClauseTe(facts)}.`,
    windowClauseTe(facts).length === 0 ? "" : `రాబోయే విడుదల ${windowClauseTe(facts)} ప్రారంభమవుతుంది.`,
    volumeClauseTe(facts).length === 0 ? "" : `మీకు ${volumeClauseTe(facts)} నీరు అందుబాటులో ఉంటుంది.`,
    whyLongerClauseTe(facts),
    "దయచేసి సమయానికి పొలం గేటు తెరవండి. నిర్ధారించడానికి 1 నొక్కండి లేదా మాట్లాడి చెప్పండి.",
  );
}

export function reminderEn(facts: MessageFacts): string {
  return join(
    "Jadal: reminder about your water turn.",
    greetingEn(facts),
    outletClauseEn(facts),
    dayClauseEn(facts).length === 0 ? "" : `The release day is ${dayClauseEn(facts)}.`,
    windowClauseEn(facts).length === 0 ? "" : `Your release starts ${windowClauseEn(facts)}.`,
    volumeClauseEn(facts).length === 0 ? "" : `${volumeClauseEn(facts)} of water is available for you.`,
    whyLongerClauseEn(facts),
    "Please open your field gate on time. Press 1 to confirm, or speak your reply.",
  );
}

/**
 * The farmer's acknowledgement has been written to the event log.
 *
 * Closing the loop is the point: the transcript becomes the evidence that the farmer was told and
 * confirmed, so the message confirms what was recorded and what happens next.
 */
export function ackRecordedTe(facts: MessageFacts): string {
  return join(
    "జడల్: మీ ధృవీకరణ నమోదు అయింది.",
    greetingTe(facts),
    outletClauseTe(facts),
    windowClauseTe(facts).length === 0 ? "" : `${windowClauseTe(facts)} విడుదలకు మీ సమాధానం నమోదు చేయబడింది.`,
    volumeClauseTe(facts).length === 0 ? "" : `ఇచ్చిన పరిమాణం ${volumeClauseTe(facts)}.`,
    "ధన్యవాదాలు. నీరు రాలేదంటే మా కాలువ కార్యాలయానికి తెలియజేయండి.",
  );
}

export function ackRecordedEn(facts: MessageFacts): string {
  return join(
    "Jadal: your acknowledgement has been recorded.",
    greetingEn(facts),
    outletClauseEn(facts),
    windowClauseEn(facts).length === 0 ? "" : `It is recorded against the ${windowClauseEn(facts)} release.`,
    volumeClauseEn(facts).length === 0 ? "" : `Allocated volume: ${volumeClauseEn(facts)}.`,
    "Thank you. Tell the canal office if the water does not reach you.",
  );
}

/**
 * Greeting for the opening of a call or a WhatsApp thread.
 *
 * @param name `Farmer.name`. Empty, whitespace or a name that is only an honorific falls back to a
 *   bare greeting rather than addressing nobody.
 * @param lang Telugu by default, because the caller agent opens in the farmer's language and then
 *   switches.
 */
export function farmerGreeting(name: string | undefined, lang: "te" | "en" = "te"): string {
  if (lang === "en") {
    const trimmed = name?.trim();
    return trimmed === undefined || trimmed.length === 0 ? "Hello, this is Jadal canal calling." : `Hello ${trimmed}, this is Jadal canal calling.`;
  }
  const addressed = vocative(name);
  return addressed.length === 0
    ? "నమస్కారం, ఇది జడల్ కాలువ నుండి వచ్చిన కాల్."
    : `నమస్కారం ${addressed}, ఇది జడల్ కాలువ నుండి వచ్చిన కాల్.`;
}

/* ------------------------------------------------------------------ inbound call script */

/**
 * Opening line for a call the farmer *placed* to us.
 *
 * Distinct from {@link farmerGreeting}, which is the opening of a call the agent placed: that one says
 * "this is a call from Jadal canal", which is wrong when the farmer dialled in. Here the agent is
 * answering, so it names itself as the help desk and invites the problem.
 */
export function inboundGreetingTe(name?: string): string {
  const addressed = vocative(name);
  return addressed.length === 0
    ? "నమస్కారం, ఇది జడల్ కాలువ సహాయ కేంద్రం. మీ నీటి సమస్యను చెప్పండి."
    : `నమస్కారం ${addressed}, ఇది జడల్ కాలువ సహాయ కేంద్రం. మీ నీటి సమస్యను చెప్పండి.`;
}

export function inboundGreetingEn(name?: string): string {
  const trimmed = name?.trim();
  return trimmed === undefined || trimmed.length === 0
    ? "Hello, this is the Jadal canal help desk. Tell us your water problem."
    : `Hello ${trimmed}, this is the Jadal canal help desk. Tell us your water problem.`;
}

/**
 * The keypad/voice prompt after the greeting: the two DTMF actions plus the invitation to speak.
 *
 * Extends `PROMPT_TE` in `../telephony/twiml` (which only offers the two keys) with the spoken option,
 * because the inbound flow accepts a recorded reply as well as a keypress.
 */
export const INBOUND_PROMPT_TE =
  "1 నొక్కండి మీ నీటి వంతు నిర్ధారించడానికి, 2 నొక్కండి అత్యవసర అభ్యర్థన కోసం. లేదా మాట్లాడి మీ సమస్యను చెప్పండి.";
export const INBOUND_PROMPT_EN =
  "Press 1 to confirm your water turn, press 2 for an urgent request. Or speak and tell us your problem.";

/** Spoken immediately before `<Record>` so the farmer knows the beep starts the reply. */
export const LISTEN_CUE_TE = "బీప్ శబ్దం తర్వాత మాట్లాడండి.";
export const LISTEN_CUE_EN = "Please speak after the beep.";

/** `15-10-2026 రోజు` / `on 15-10-2026`, or `""` without a parseable window start. */
function dayClauseTe(facts: MessageFacts): string {
  const date = formatIstDate(facts.windowStart);
  return date.length === 0 ? "" : `${date} రోజు`;
}

function dayClauseEn(facts: MessageFacts): string {
  const date = formatIstDate(facts.windowStart);
  return date.length === 0 ? "" : `on ${date}`;
}

/**
 * The farmer's next turn: **day**, **time window** and **volume in m³**, at the outlet.
 *
 * This is the message the agent must be able to speak on its own (task 2). The other templates carry
 * the window and the volume but not the calendar day, which a farmer asking "when is my turn?" needs
 * first; {@link formatIstDate} is the same day-first form the roster sheet and the WhatsApp thread use.
 */
export function nextTurnTe(facts: MessageFacts): string {
  return join(
    "జడల్: మీ తదుపరి నీటి వంతు వివరాలు.",
    greetingTe(facts),
    dayClauseTe(facts).length === 0 ? "" : `మీ విడుదల రోజు ${dayClauseTe(facts)}.`,
    windowClauseTe(facts).length === 0 ? "" : `విడుదల సమయం ${windowClauseTe(facts)}.`,
    outletClauseTe(facts),
    volumeClauseTe(facts).length === 0 ? "" : `మీకు కేటాయించిన పరిమాణం ${volumeClauseTe(facts)}.`,
    "దయచేసి సమయానికి సిద్ధంగా ఉండండి.",
  );
}

export function nextTurnEn(facts: MessageFacts): string {
  return join(
    "Jadal: details of your next water turn.",
    greetingEn(facts),
    dayClauseEn(facts).length === 0 ? "" : `Your release day is ${dayClauseEn(facts)}.`,
    windowClauseEn(facts).length === 0 ? "" : `The release window is ${windowClauseEn(facts)}.`,
    outletClauseEn(facts),
    volumeClauseEn(facts).length === 0 ? "" : `Your allocated volume is ${volumeClauseEn(facts)}.`,
    "Please be ready on time.",
  );
}

/**
 * Confirmation that a raised urgent request has been **approved**, with the granted volume and, when
 * known, the release day/window. Task 2's "confirmation of an approved urgent request".
 */
export function requestApprovedTe(facts: MessageFacts): string {
  return join(
    "జడల్: మీ అత్యవసర అభ్యర్థన ఆమోదించబడింది.",
    greetingTe(facts),
    facts.requestVolumeM3 === undefined ? "" : `మీకు ${formatVolumeM3(facts.requestVolumeM3)} ఘన మీటర్లు మంజూరు చేయబడ్డాయి.`,
    dayClauseTe(facts).length === 0 ? "" : `విడుదల రోజు ${dayClauseTe(facts)}.`,
    windowClauseTe(facts).length === 0 ? "" : `విడుదల సమయం ${windowClauseTe(facts)}.`,
    outletClauseTe(facts),
    "దయచేసి సమయానికి సిద్ధంగా ఉండండి.",
  );
}

export function requestApprovedEn(facts: MessageFacts): string {
  return join(
    "Jadal: your urgent request has been approved.",
    greetingEn(facts),
    facts.requestVolumeM3 === undefined ? "" : `You have been granted ${formatVolumeM3(facts.requestVolumeM3)} cubic metres.`,
    dayClauseEn(facts).length === 0 ? "" : `The release day is ${dayClauseEn(facts)}.`,
    windowClauseEn(facts).length === 0 ? "" : `The release window is ${windowClauseEn(facts)}.`,
    outletClauseEn(facts),
    "Please be ready on time.",
  );
}

/**
 * Confirmation that an urgent request the farmer just raised (on this inbound call) is **recorded**.
 *
 * Deliberately weaker than {@link requestApprovedTe}: nothing has been decided yet, so it promises a
 * callback rather than a release.
 */
export function requestRecordedTe(facts: MessageFacts): string {
  return join(
    "జడల్: మీ అత్యవసర అభ్యర్థన నమోదు చేయబడింది.",
    greetingTe(facts),
    facts.requestVolumeM3 === undefined ? "" : `మీరు అడిగిన పరిమాణం ${formatVolumeM3(facts.requestVolumeM3)} ఘన మీటర్లు.`,
    outletClauseTe(facts),
    "మా కాలువ కార్యాలయం త్వరలో మిమ్మల్ని సంప్రదిస్తుంది. ధన్యవాదాలు.",
  );
}

export function requestRecordedEn(facts: MessageFacts): string {
  return join(
    "Jadal: your urgent request has been recorded.",
    greetingEn(facts),
    facts.requestVolumeM3 === undefined ? "" : `You asked for ${formatVolumeM3(facts.requestVolumeM3)} cubic metres.`,
    outletClauseEn(facts),
    "Our canal office will contact you shortly. Thank you.",
  );
}

/* ------------------------------------------------------------------ severity alerts */

/**
 * Alert severity (task 2). Ordered least to most severe; the spoken prefix changes with it, so an
 * "emergency" never sounds like an "info".
 *
 * `info` and `warning` close with "contact the canal office"; `urgent` and `emergency` close with the
 * stronger "tell the canal office immediately", and `emergency` also opens with "this is an emergency".
 */
export type AlertSeverity = "info" | "warning" | "urgent" | "emergency";

/** The severities, as a runtime array, in ascending severity. Used to validate and enumerate. */
export const ALERT_SEVERITIES: readonly AlertSeverity[] = ["info", "warning", "urgent", "emergency"];

/** Is this string one of {@link ALERT_SEVERITIES}? */
export function isAlertSeverity(value: string): value is AlertSeverity {
  return (ALERT_SEVERITIES as readonly string[]).includes(value);
}

const ALERT_LABEL_TE: Readonly<Record<AlertSeverity, string>> = {
  info: "సమాచారం",
  warning: "హెచ్చరిక",
  urgent: "అత్యవసర హెచ్చరిక",
  emergency: "అత్యవసరం",
};

const ALERT_LABEL_EN: Readonly<Record<AlertSeverity, string>> = {
  info: "Information",
  warning: "Warning",
  urgent: "Urgent alert",
  emergency: "Emergency",
};

/**
 * A warning/alert message with a severity, carrying whatever facts are known.
 *
 * The severity is spoken, not just tagged, because a farmer on a bad line hears the label first and it
 * is what tells them whether to walk to the field gate now.
 */
export function alertTe(severity: AlertSeverity, facts: MessageFacts): string {
  const closing =
    severity === "emergency"
      ? "ఇది అత్యవసరం. వెంటనే మా కాలువ కార్యాలయానికి తెలియజేయండి."
      : severity === "urgent"
        ? "వెంటనే మా కాలువ కార్యాలయానికి తెలియజేయండి."
        : "మా కాలువ కార్యాలయాన్ని సంప్రదించండి.";
  return join(
    `జడల్ ${ALERT_LABEL_TE[severity]}:`,
    greetingTe(facts),
    outletClauseTe(facts),
    dayClauseTe(facts).length === 0 ? "" : `విడుదల రోజు ${dayClauseTe(facts)}.`,
    windowClauseTe(facts).length === 0 ? "" : `విడుదల సమయం ${windowClauseTe(facts)}.`,
    volumeClauseTe(facts).length === 0 ? "" : `మీకు ${volumeClauseTe(facts)} నీరు.`,
    closing,
  );
}

export function alertEn(severity: AlertSeverity, facts: MessageFacts): string {
  const closing =
    severity === "emergency"
      ? "This is an emergency. Tell our canal office immediately."
      : severity === "urgent"
        ? "Tell our canal office immediately."
        : "Contact our canal office.";
  return join(
    `Jadal ${ALERT_LABEL_EN[severity]}:`,
    greetingEn(facts),
    outletClauseEn(facts),
    dayClauseEn(facts).length === 0 ? "" : `The release day is ${dayClauseEn(facts)}.`,
    windowClauseEn(facts).length === 0 ? "" : `The release window is ${windowClauseEn(facts)}.`,
    volumeClauseEn(facts).length === 0 ? "" : `${volumeClauseEn(facts)} of water for you.`,
    closing,
  );
}

/* ------------------------------------------------------------------ honest failures */

/** Nothing transcribable arrived: say so rather than pretending the agent heard the farmer. */
export const NOT_UNDERSTOOD_TE = "క్షమించండి, మీ మాటలు స్పష్టంగా వినిపించలేదు. దయచేసి మళ్లీ ప్రయత్నించండి.";
export const NOT_UNDERSTOOD_EN = "Sorry, we could not hear that clearly. Please try again.";

/** The caller's number is not on the roster, so no request can be attributed to a farmer. */
export const CALLER_UNKNOWN_TE = "క్షమించండి, ఈ ఫోన్ నంబర్ మా రికార్డులో లేదు. దయచేసి మా కాలువ కార్యాలయాన్ని సంప్రదించండి.";
export const CALLER_UNKNOWN_EN = "Sorry, this phone number is not in our records. Please contact our canal office.";

/** A release-time question with no turn facts to answer from: promise a callback, do not invent a time. */
export const SCHEDULE_HOLD_TE = "జడల్: మీ విడుదల సమయం గురించి మా కార్యాలయం త్వరలో మిమ్మల్ని సంప్రదిస్తుంది.";
export const SCHEDULE_HOLD_EN = "Jadal: our office will contact you shortly about your release time.";

/** The request could not be written: say so, rather than confirming a request that was never raised. */
export const REQUEST_FAILED_TE = "క్షమించండి, మీ అభ్యర్థనను నమోదు చేయలేకపోయాము. దయచేసి మళ్లీ ప్రయత్నించండి.";
export const REQUEST_FAILED_EN = "Sorry, we could not record your request. Please try again.";

/* ------------------------------------------------------------------ purpose dispatcher */

/** `Contact["purpose"]` — imported from the contract so this dispatcher cannot drift from it. */
type ContactPurpose = Contact["purpose"];

/**
 * The builders a `Contact.purpose` maps to. One direction only — purpose to template — because that
 * is the direction the caller agent needs; picking a purpose from a message is the LLM's job.
 *
 * Typed as a total `Record` over the contract's purpose union, so adding a purpose to
 * `packages/contracts` fails this file's typecheck instead of silently producing no message.
 */
const TEMPLATES_BY_PURPOSE: Readonly<Record<ContactPurpose, (facts: MessageFacts) => MessagePair>> = {
  roster_change: (facts) => ({ te: rosterChangeTe(facts), en: rosterChangeEn(facts) }),
  release_warning: (facts) => ({ te: nightReleaseWarningTe(facts), en: nightReleaseWarningEn(facts) }),
  request_update: (facts) => ({ te: requestUpdateTe(facts), en: requestUpdateEn(facts) }),
  reminder: (facts) => ({ te: reminderTe(facts), en: reminderEn(facts) }),
};

/** The `Contact.purpose` values, as a runtime array. Used by the caller agent to enumerate them. */
export const CONTACT_PURPOSES: readonly ContactPurpose[] = [
  "roster_change",
  "release_warning",
  "request_update",
  "reminder",
];

/**
 * Pick the message for a `Contact` and render it in both languages, ready to fill `message_te` and
 * `message_en`.
 *
 * `release_warning` maps to the night-release template because a release warning *is* a night-release
 * warning in this canal: §4 of the research doc records that releases run at 23:00 and 02:00, and
 * `src/db/clock.ts` treats 18:00–06:00 IST as the night band. The two messages with no purpose on
 * the contract — {@link rainPostponedTe}/{@link rainPostponedEn} and
 * {@link ackRecordedTe}/{@link ackRecordedEn} — are emitted by the cron re-plan and by the call
 * agent's own turn rather than queued as an outreach `Contact`, which is why they are not here.
 */
export function templateForPurpose(purpose: ContactPurpose, facts: MessageFacts): MessagePair {
  return TEMPLATES_BY_PURPOSE[purpose](facts);
}