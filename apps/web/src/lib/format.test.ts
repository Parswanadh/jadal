import { describe, expect, it } from "vitest";
import { formatDateOnly, formatDateTime, formatDay, formatList, formatNumber, formatRange, formatTimeOfDay, hoursBetween, splitHours } from "./format";

// 2026-09-14 06:00 India time is 00:30 UTC.
const MON_6AM = "2026-09-14T00:30:00Z";

describe("formatDateTime", () => {
  it("writes a human date and time in English", () => {
    expect(formatDateTime(MON_6AM, "en")).toBe("Mon 14 Sep, 6:00 am");
    expect(formatDateTime("2026-09-17T13:30:00Z", "en")).toBe("Thu 17 Sep, 7:00 pm");
  });

  it("writes a human date and time in Telugu", () => {
    expect(formatDateTime(MON_6AM, "te")).toBe("సోమ 14 సెప్టెం, ఉదయం 6:00");
  });

  it("never shows an ISO timestamp", () => {
    for (const lang of ["en", "te"] as const) {
      expect(formatDateTime(MON_6AM, lang)).not.toMatch(/\d{4}-\d{2}-\d{2}|T\d{2}:|Z$/);
    }
  });

  it("returns the input when it is not a date", () => {
    expect(formatDateTime("soon", "en")).toBe("soon");
  });
});

describe("formatRange", () => {
  it("collapses the am/pm marker inside one day", () => {
    expect(formatRange("2026-09-15T00:30:00Z", "2026-09-15T03:30:00Z", "en")).toBe("Tue 15 Sep, 6:00–9:00 am");
  });

  it("keeps both markers when the turn crosses noon", () => {
    expect(formatRange("2026-09-15T04:30:00Z", "2026-09-15T09:30:00Z", "en")).toBe("Tue 15 Sep, 10:00 am – 3:00 pm");
  });

  it("writes both ends in full when the turn crosses midnight", () => {
    expect(formatRange("2026-09-15T17:30:00Z", "2026-09-15T20:30:00Z", "en")).toBe("Tue 15 Sep, 11:00 pm – Wed 16 Sep, 2:00 am");
  });

  it("writes Telugu ranges with the part of the day first", () => {
    expect(formatRange("2026-09-15T00:30:00Z", "2026-09-15T03:30:00Z", "te")).toBe("మంగళ 15 సెప్టెం, ఉదయం 6:00–9:00");
  });
});

describe("other formats", () => {
  it("formats day, time of day and plain dates", () => {
    expect(formatDay(MON_6AM, "en")).toBe("Mon 14 Sep");
    expect(formatTimeOfDay(MON_6AM, "en")).toBe("6:00 am");
    expect(formatDateOnly("2026-07-10", "en")).toBe("Fri 10 Jul");
  });

  it("groups numbers the Indian way", () => {
    expect(formatNumber(24000)).toBe("24,000");
    expect(formatNumber(150000)).toBe("1,50,000");
    expect(formatNumber(0.05, 2)).toBe("0.05");
  });

  it("joins names", () => {
    expect(formatList(["A", "B"], "en")).toBe("A and B");
  });

  it("splits hours into hours and minutes", () => {
    expect(splitHours(3)).toEqual({ hours: 3, minutes: 0 });
    expect(splitHours(2.5)).toEqual({ hours: 2, minutes: 30 });
    expect(splitHours(1.999)).toEqual({ hours: 2, minutes: 0 });
  });

  it("measures the clock length of a span, and nothing for a bad one", () => {
    expect(hoursBetween("2026-09-15T00:30:00Z", "2026-09-15T03:30:00Z")).toBe(3);
    expect(hoursBetween("2026-09-15T00:30:00Z", "soon")).toBeNull();
  });
});
