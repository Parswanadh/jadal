import { describe, expect, it } from "vitest";
import { CropName, CropParams } from "@jadal/contracts";
import cropParamsRaw from "./data/crop-params.json";
import { allCropParams, getCropParams } from "./crop-params";

describe("A1: Crop parameter data", () => {
  it("validates that all entries parse successfully against CropParams zod schema", () => {
    expect(cropParamsRaw.length).toBeGreaterThanOrEqual(10);
    for (const raw of cropParamsRaw) {
      const parsed = CropParams.parse(raw);
      expect(parsed).toBeDefined();
    }
  });

  it("covers every CropName enum value", () => {
    const definedCrops = new Set(allCropParams.map((c) => c.crop));
    for (const crop of CropName.options) {
      expect(definedCrops.has(crop)).toBe(true);
      const params = getCropParams(crop);
      expect(params.crop).toBe(crop);
    }
  });

  it("ensures every crop has stage lengths strictly greater than zero", () => {
    for (const params of allCropParams) {
      expect(params.stage_days.ini).toBeGreaterThan(0);
      expect(params.stage_days.dev).toBeGreaterThan(0);
      expect(params.stage_days.mid).toBeGreaterThan(0);
      expect(params.stage_days.late).toBeGreaterThan(0);
      const totalDays =
        params.stage_days.ini +
        params.stage_days.dev +
        params.stage_days.mid +
        params.stage_days.late;
      expect(totalDays).toBeGreaterThan(0);
    }
  });

  it("ensures every entry has an authoritative source citation", () => {
    for (const params of allCropParams) {
      expect(params.source.length).toBeGreaterThan(5);
    }
  });

  it("handles variants and throws on unknown crop", () => {
    const floodedRice = getCropParams("rice", "flooded");
    expect(floodedRice.crop).toBe("rice");
    expect(floodedRice.variant).toBe("flooded");

    // Non-existent variant falls back to crop default
    const fallbackRice = getCropParams("rice", "nonexistent_variant");
    expect(fallbackRice.crop).toBe("rice");

    // Unknown crop throws
    expect(() => getCropParams("unknown_crop" as any)).toThrow();
  });
});

