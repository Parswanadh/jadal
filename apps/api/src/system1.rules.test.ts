/**
 * Tests for the deterministic Telugu rule classifier — the recorded fallback under Jev.
 *
 * Pure and offline: no fetch, no clock, no environment. These pin the behaviour that the Jev path
 * degrades to, including the Telugu-combining-mark normalisation fixed in c41b379: dropping `\p{M}`
 * made every Telugu keyword (and `క్యూబిక్ మీటర్లు`) unmatchable, so an urgent Telugu transcript
 * classified as `other` and raised no request.
 */

import { System1Result } from "@jadal/contracts";
import { describe, expect, it } from "vitest";

import { classifyByRules, extractRequestedHours, extractVolumeM3, isUnscored, normalizeText } from "./system1.rules";

describe("normalizeText", () => {
  it("keeps Telugu combining marks (Mn/Mc) instead of treating them as punctuation", () => {
    // "ఎండిపోతుంది" = the crop will dry up. Every vowel sign, anusvara and virama here is \p{M}.
    expect(normalizeText("ఎండిపోతుంది")).toBe("ఎండిపోతుంది");

    const marks = [...normalizeText("నీళ్లు")].filter((char) => /\p{M}/u.test(char));
    expect(marks.length).toBeGreaterThan(0);
    expect(normalizeText("నీళ్లు")).toContain("ళ");
  });

  it("keeps the marks in a volume unit so extractVolumeM3 can match", () => {
    expect(normalizeText("క్యూబిక్ మీటర్లు")).toBe("క్యూబిక్ మీటర్లు");
  });

  it("lowercases, folds Telugu digits and strips punctuation to spaces", () => {
    expect(normalizeText("  Hello,   WORLD!  ")).toBe("hello world");
    expect(normalizeText("౧౨౩")).toBe("123");
    expect(normalizeText("100, క్యూబిక్-మీటర్లు")).toBe("100 క్యూబిక్ మీటర్లు");
  });

  it("drops zero-width and bidi controls that break substring matching", () => {
    expect(normalizeText("a\u200bb")).toBe("ab");
    expect(normalizeText("నీ\u200cళ్లు")).toBe("నీళ్లు");
    expect(normalizeText("\ufeffధన్యవాదాలు")).toBe("ధన్యవాదాలు");
  });

  it("collapses whitespace and returns an empty string for blank input", () => {
    expect(normalizeText("   ")).toBe("");
    expect(normalizeText("\n\t")).toBe("");
  });
});

describe("classifyByRules", () => {
  it("classifies a Telugu crop-stress ask as urgent_request with crop stress", () => {
    const result = classifyByRules("పంట ఎండిపోతుంది, నీళ్లు లేవు, వెంటనే నీరు కావాలి");
    expect(result.intent).toBe("urgent_request");
    expect(result.source).toBe("rules");
    expect(result.mentions_crop_stress).toBe(true);
    expect(result.urgency).toBeGreaterThan(0.5);
    expect(result.intent_confidence).toBeGreaterThan(0);
    expect(result.intent_confidence).toBeLessThanOrEqual(0.95);
  });

  it("treats 'నీళ్లు లేవు' alone as crop stress", () => {
    const result = classifyByRules("మా పొలంలో నీళ్లు లేవు");
    expect(result.mentions_crop_stress).toBe(true);
    expect(result.intent).toBe("urgent_request");
  });

  it("classifies a thank-you as acknowledge with low urgency", () => {
    const result = classifyByRules("ధన్యవాదాలు, అవగాహన");
    expect(result.intent).toBe("acknowledge");
    expect(result.mentions_crop_stress).toBe(false);
    expect(result.urgency).toBeLessThan(0.2);
  });

  it("classifies a decline as not_needed_this_week, not as a request", () => {
    const result = classifyByRules("ఈ వారం అవసరం లేదు, తర్వాత చేయండి");
    expect(result.intent).toBe("not_needed_this_week");
    expect(result.mentions_crop_stress).toBe(false);
  });

  it("classifies a schedule question", () => {
    const result = classifyByRules("మా వంతు ఎప్పుడు విడుదల అవుతుంది?");
    expect(result.intent).toBe("schedule_question");
  });

  it("returns a schema-valid 'other' for blank input", () => {
    const result = classifyByRules("   ");
    expect(result.intent).toBe("other");
    expect(result.source).toBe("rules");
    expect(result.urgency).toBe(0);
    expect(result.mentions_crop_stress).toBe(false);
  });

  it("is deterministic: the same input always yields the same result", () => {
    const text = "వరి పంటకు అత్యవసరంగా నీరు కావాలి";
    expect(classifyByRules(text)).toEqual(classifyByRules(text));
  });

  it("does not double-count an overlapping keyword span", () => {
    // "నీరు వద్దు" (strength 2) contains "వద్దు" (strength 1); the shorter term must not add again.
    const result = classifyByRules("నీరు వద్దు");
    expect(result.intent).toBe("not_needed_this_week");
    expect(result.mentions_crop_stress).toBe(false);
  });
});

describe("unscored marker", () => {
  it("marks a message that matches no term as unscored instead of returning the 0.15 floor", () => {
    const result = classifyByRules("hello there, how are you today");

    expect(isUnscored(result)).toBe(true);
    expect(result.intent).toBe("other");
    expect(result.intent_confidence).toBe(0);
    expect(result.urgency).toBe(0);
    expect(result.mentions_crop_stress).toBe(false);
    // The numeric field stays schema-valid for `triage_score`; it is 0, never URGENCY_BASE.
    expect(result.urgency).not.toBe(0.15);
  });

  it("treats blank input as unscored", () => {
    expect(isUnscored(classifyByRules("   "))).toBe(true);
  });

  it("does not mark a matched message as unscored, even when urgency is low", () => {
    const result = classifyByRules("ధన్యవాదాలు");
    expect(result.intent).toBe("acknowledge");
    expect(isUnscored(result)).toBe(false);
  });

  it("never marks a model-sourced result as unscored, even if the numbers match", () => {
    const modelResult = System1Result.parse({
      intent: "other",
      intent_confidence: 0,
      urgency: 0,
      mentions_crop_stress: false,
      source: "laya",
    });
    expect(isUnscored(modelResult)).toBe(false);
  });
});

describe("English demo reasons", () => {
  it("classifies each reason the demo seeds with the expected intent", () => {
    expect(classifyByRules("My maize is tasseling and the leaves are rolling in the heat.").intent).toBe(
      "urgent_request",
    );
    expect(classifyByRules("My field at the tail end got a short turn.").intent).toBe("buffer_request");
    expect(classifyByRules("Water needed for my crop.").intent).toBe("urgent_request");
    expect(classifyByRules("I need water urgently, my paddy is flowering.").intent).toBe("urgent_request");
  });

  it("scores every seeded English reason above the old constant floor", () => {
    const reasons = [
      "My maize is tasseling and the leaves are rolling in the heat.",
      "My field at the tail end got a short turn.",
      "Water needed for my crop.",
      "I need water urgently, my paddy is flowering.",
    ];

    for (const reason of reasons) {
      const result = classifyByRules(reason);
      expect(isUnscored(result)).toBe(false);
      expect(result.urgency).toBeGreaterThan(0.15);
    }
  });

  it("reads the seeded maize reason as crop stress and the plain ask as a request only", () => {
    expect(classifyByRules("My maize is tasseling and the leaves are rolling in the heat.").mentions_crop_stress).toBe(
      true,
    );
    expect(classifyByRules("Water needed for my crop.").mentions_crop_stress).toBe(false);
  });
});

describe("slot extraction", () => {
  it("reads an explicit m³ volume written with Telugu combining marks", () => {
    expect(extractVolumeM3("100 క్యూబిక్ మీటర్లు పంపండి")).toBe(100);
    expect(extractVolumeM3("2.5 cubic metres")).toBe(2.5);
    expect(extractVolumeM3("రెండు క్యూబిక్ మీటర్లు")).toBe(2);
  });

  it("returns null when no plausible volume is stated", () => {
    expect(extractVolumeM3("కొంచెం నీరు కావాలి")).toBeNull();
    expect(extractVolumeM3("")).toBeNull();
  });

  it("reads a requested duration in hours", () => {
    expect(extractRequestedHours("రెండు గంటలు")).toBe(2);
    expect(extractRequestedHours("3 hours")).toBe(3);
    expect(extractRequestedHours("అర్ధగంట చాలు")).toBe(0.5);
    expect(extractRequestedHours("ఈ వారం అవసరం లేదు")).toBeNull();
  });
});
