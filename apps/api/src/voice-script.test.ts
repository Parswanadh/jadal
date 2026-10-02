/**
 * The call script: every meaningful thing the agent can say, in Telugu.
 *
 * These tests pin the *content* contract of task 2 — every `SpokenMessage` kind renders Telugu script
 * (never transliteration, never `undefined`), the four alert severities are distinguishable, and the
 * audio URL round-trips back to the same message so the sentence the agent decided to say is the
 * sentence Sarvam is asked for.
 */

import { describe, expect, it } from "vitest";

import {
  ALERT_SEVERITIES,
  SPOKEN_MESSAGE_KINDS,
  factsFromParams,
  isAlertSeverity,
  isSpokenMessageKind,
  messageFromParams,
  scriptAudioUrl,
  spokenEnglish,
  spokenTelugu,
  type SpokenMessage,
} from "./voice/script";
import type { MessageFacts } from "./voice/telugu";

/** Any Telugu code point; a message without one is not Telugu. */
const TELUGU = /[\u0C00-\u0C7F]/;

const FACTS: MessageFacts = {
  farmerName: "రమణ",
  windowStart: "2026-10-15T05:00:00Z", // 10:30 IST on 15-10-2026
  windowEnd: "2026-10-15T07:30:00Z", // 13:00 IST
  outletName: "Outlet 4B (Tail End)",
  chainageM: 12480,
  allocatedM3: 180,
  requestVolumeM3: 120,
};

/** One sample of every kind, so the table below is exhaustive by construction. */
const SAMPLES: readonly SpokenMessage[] = [
  { kind: "inbound_greeting" },
  { kind: "inbound_greeting", farmerName: "రమణ" },
  { kind: "inbound_prompt" },
  { kind: "listen_cue" },
  { kind: "next_turn", facts: FACTS },
  { kind: "request_approved", facts: FACTS },
  { kind: "request_recorded", facts: FACTS },
  ...ALERT_SEVERITIES.map((severity): SpokenMessage => ({ kind: "alert", severity, facts: FACTS })),
  { kind: "schedule_hold" },
  { kind: "acknowledge" },
  { kind: "not_understood" },
  { kind: "caller_unknown" },
  { kind: "request_failed" },
];

describe("spokenTelugu", () => {
  it("covers every SpokenMessage kind in the runtime enumeration", () => {
    const covered = new Set(SAMPLES.map((message) => message.kind));
    expect([...covered].sort()).toEqual([...SPOKEN_MESSAGE_KINDS].sort());
  });

  it.each(SAMPLES)("renders $kind in Telugu script with no undefined and no double spaces", (message) => {
    const te = spokenTelugu(message);
    expect(te.length).toBeGreaterThan(0);
    expect(TELUGU.test(te)).toBe(true);
    expect(te).not.toContain("undefined");
    expect(te).not.toMatch(/\s{2,}/);
    // A romanised "namaskaram" would mean someone fell back to transliteration.
    expect(te).not.toMatch(/namaskaram/i);
  });

  it.each(SAMPLES)("renders $kind in English too, for the thread beside the call", (message) => {
    const en = spokenEnglish(message);
    expect(en.length).toBeGreaterThan(0);
    expect(en).toMatch(/[A-Za-z]/);
    expect(en).not.toContain("undefined");
    // The English line may carry a Telugu *name*, but none of the Telugu prose.
    expect(en).not.toContain("నమస్కారం");
    expect(en).not.toContain("జడల్");
    expect(en).not.toMatch(/namaskaram/i);
  });

  it("addresses a known caller with the respectful honorific in the inbound greeting", () => {
    expect(spokenTelugu({ kind: "inbound_greeting", farmerName: "రమణ" })).toContain("రమణ గారు");
    expect(spokenTelugu({ kind: "inbound_greeting" })).toContain("జడల్ కాలువ సహాయ కేంద్రం");
  });

  it("says the next turn's day, window and volume — the three facts a farmer asks for", () => {
    const te = spokenTelugu({ kind: "next_turn", facts: FACTS });
    expect(te).toContain("15-10-2026"); // the day, IST, day-first
    expect(te).toContain("10:30");
    expect(te).toContain("13:00");
    expect(te).toContain("180");
    expect(te).toContain("ఘన మీటర్లు");
  });

  it("confirms an approved request with the granted volume", () => {
    const te = spokenTelugu({ kind: "request_approved", facts: FACTS });
    expect(te).toContain("ఆమోదించబడింది");
    expect(te).toContain("120");
  });

  it("promises a callback when an inbound request is only recorded, not approved", () => {
    const te = spokenTelugu({ kind: "request_recorded", facts: FACTS });
    expect(te).toContain("నమోదు చేయబడింది");
    expect(te).toContain("సంప్రదిస్తుంది");
  });
});

describe("alert severity", () => {
  it("validates and enumerates the four severities in ascending order", () => {
    expect([...ALERT_SEVERITIES]).toEqual(["info", "warning", "urgent", "emergency"]);
    expect(isAlertSeverity("emergency")).toBe(true);
    expect(isAlertSeverity("critical")).toBe(false);
  });

  it("speaks a different, escalating label for each severity", () => {
    const lines = ALERT_SEVERITIES.map((severity) => spokenTelugu({ kind: "alert", severity, facts: FACTS }));
    expect(new Set(lines).size).toBe(ALERT_SEVERITIES.length);
    expect(lines[0]).toContain("సమాచారం"); // info
    expect(lines[1]).toContain("హెచ్చరిక"); // warning
    expect(lines[2]).toContain("అత్యవసర హెచ్చరిక"); // urgent
    expect(lines[3]).toContain("అత్యవసరం"); // emergency
    // Only the top two tell the farmer to act immediately.
    expect(lines[3]).toContain("వెంటనే");
    expect(lines[2]).toContain("వెంటనే");
    expect(lines[0]).not.toContain("వెంటనే");
  });

  it("carries the window and volume it was given, and still speaks with no facts at all", () => {
    const withFacts = spokenTelugu({ kind: "alert", severity: "warning", facts: FACTS });
    expect(withFacts).toContain("10:30");
    expect(withFacts).toContain("180");
    const bare = spokenTelugu({ kind: "alert", severity: "emergency", facts: {} });
    expect(TELUGU.test(bare)).toBe(true);
    expect(bare).not.toContain("undefined");
  });
});

describe("script audio URL round-trip", () => {
  const ROOT = "https://jadal.example.dev/api/telephony";

  it.each(SAMPLES)("$kind survives scriptAudioUrl -> messageFromParams", (message) => {
    const url = scriptAudioUrl(ROOT, message);
    expect(url.startsWith(`${ROOT}/script/audio?`)).toBe(true);
    const parsed = messageFromParams(new URL(url).searchParams);
    expect(parsed).toEqual(message);
  });

  it("encodes facts into the query and parses numbers back as numbers", () => {
    const url = scriptAudioUrl(ROOT, { kind: "next_turn", facts: FACTS });
    expect(url).toContain("kind=next_turn");
    expect(url).toContain("allocatedM3=180");
    const facts = factsFromParams(new URL(url).searchParams);
    expect(facts.allocatedM3).toBe(180);
    expect(facts.chainageM).toBe(12480);
    expect(facts.windowStart).toBe(FACTS.windowStart);
  });

  it("rejects an unknown kind and a missing or invalid severity", () => {
    expect(messageFromParams(new URLSearchParams("kind=sing"))).toBeNull();
    expect(messageFromParams(new URLSearchParams("kind=alert"))).toBeNull();
    expect(messageFromParams(new URLSearchParams("kind=alert&severity=critical"))).toBeNull();
    expect(isSpokenMessageKind("alert")).toBe(true);
    expect(isSpokenMessageKind("sing")).toBe(false);
  });

  it("drops unparseable numbers rather than speaking NaN", () => {
    const facts = factsFromParams(new URLSearchParams("allocatedM3=abc&chainageM=12&outletName="));
    expect(facts.allocatedM3).toBeUndefined();
    expect(facts.chainageM).toBe(12);
    expect(facts.outletName).toBeUndefined();
  });
});
