import { describe, expect, it } from "vitest";
import { fromLocalInputValue, toLocalInputValue } from "./localTime";

describe("datetime-local conversion", () => {
  it("round-trips an ISO instant through the input value", () => {
    const iso = "2026-09-15T00:30:00.000Z";
    const value = toLocalInputValue(iso);
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromLocalInputValue(value)).toBe(iso);
  });

  it("returns nothing readable for bad input", () => {
    expect(toLocalInputValue("nonsense")).toBe("");
    expect(fromLocalInputValue("")).toBeNull();
    expect(fromLocalInputValue("nonsense")).toBeNull();
  });
});
