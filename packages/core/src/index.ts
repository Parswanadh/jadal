import type {
  CropEngine,
  Hydraulics,
  RosterEngine,
  Ledger,
  Policy,
} from "@jadal/contracts";

import { cropEngine, Fao56CropEngine, SOIL_AWC } from "./crop-engine";
import { hydraulics, CanalHydraulics } from "./hydraulics";
import { rosterEngine, CanalRosterEngine } from "./roster-engine";
import { ledger, JadalLedger } from "./ledger";
import { policy, JadalPolicy } from "./policy";
import { allCropParams, getCropParams } from "./crop-params";

// Satisfies checks ensuring exact contract compliance
const checkedCropEngine = cropEngine satisfies CropEngine;
const checkedHydraulics = hydraulics satisfies Hydraulics;
const checkedRosterEngine = rosterEngine satisfies RosterEngine;
const checkedLedger = ledger satisfies Ledger;
const checkedPolicy = policy satisfies Policy;

export {
  checkedCropEngine as cropEngine,
  checkedHydraulics as hydraulics,
  checkedRosterEngine as rosterEngine,
  checkedLedger as ledger,
  checkedPolicy as policy,
  Fao56CropEngine,
  CanalHydraulics,
  CanalRosterEngine,
  JadalLedger,
  JadalPolicy,
  allCropParams,
  getCropParams,
  SOIL_AWC,
};

/**
 * Converts water depth in millimeters applied over an area in hectares
 * to volumetric water in cubic meters (m³).
 *
 * 1 mm = 0.001 m
 * 1 ha = 10,000 m²
 * 1 mm * 1 ha = 0.001 m * 10,000 m² = 10 m³
 *
 * Sourced from FAO-56 Table 1, p. 15.
 *
 * @param depthMm Depth of water in millimeters
 * @param areaHa Area of land in hectares
 * @returns Total water volume in cubic meters (m³)
 */
export function mmHaToCubicMeters(depthMm: number, areaHa: number): number {
  if (depthMm < 0 || areaHa < 0) {
    throw new RangeError("Depth and area must be non-negative");
  }
  return depthMm * areaHa * 10;
}
