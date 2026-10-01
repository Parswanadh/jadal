import { describe, expect, it } from "vitest";
import type { CropEngine, Hydraulics, Ledger, Policy, RosterEngine } from "@jadal/contracts";
import { cropEngine, cropParams, hydraulics, ledger, policy, rosterEngine } from "./index";

describe("@jadal/core public API", () => {
  it("exports one object per contract interface", () => {
    // Compile-time check: each export must be assignable to its contract interface.
    const api: [CropEngine, Hydraulics, RosterEngine, Ledger, Policy] = [cropEngine, hydraulics, rosterEngine, ledger, policy];
    expect(api.every(Boolean)).toBe(true);
  });

  it("ships crop parameters for every crop", () => {
    expect(Array.isArray(cropParams) ? cropParams.length : Object.keys(cropParams).length).toBeGreaterThanOrEqual(10);
  });
});
