import { describe, expect, it } from "vitest";
import { OVER_ALLOCATED_PCT, barWidthPct, isOverAllocated, needMetBand } from "./needMetDisplay";

// The API's planned need-met for equal_hours is un-capped and can exceed 100
// (seed: head 280.8%, tail 205.5%). These four values pin the presentation.
const CASES = [
  { pct: 98, width: 98, over: false, band: "high" },
  { pct: 100, width: 100, over: false, band: "high" },
  { pct: 205.5, width: 100, over: true, band: "over" },
  { pct: 280.8, width: 100, over: true, band: "over" },
] as const;

describe("need-met display helpers", () => {
  it.each(CASES)("clamps the bar width for pct=$pct", ({ pct, width }) => {
    expect(barWidthPct(pct)).toBe(width);
  });

  it.each(CASES)("classifies over-allocation for pct=$pct", ({ pct, over }) => {
    expect(isOverAllocated(pct)).toBe(over);
  });

  it.each(CASES)("picks the bar band for pct=$pct", ({ pct, band }) => {
    expect(needMetBand(pct)).toBe(band);
  });

  it("treats exactly 100 as not over-allocated and anything above as over", () => {
    expect(isOverAllocated(OVER_ALLOCATED_PCT)).toBe(false);
    expect(isOverAllocated(100.0001)).toBe(true);
  });

  it("clamps non-finite and negative input to a safe width", () => {
    expect(barWidthPct(-5)).toBe(0);
    expect(barWidthPct(Number.NaN)).toBe(0);
    expect(barWidthPct(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
