// C5 canal hero — typed access to the seed bundle.
//
// seed.json holds FIXED numbers with the same shapes the API will serve
// (routes.canal, routes.proposeRoster, overrunImpact rows). They were generated
// once, offline, by Temp/gen_seed.py. Nothing here is computed at runtime.

import seed from "./seed.json";
import type { CanalVisualData } from "./types";

function assertSeed(value: unknown): asserts value is CanalVisualData {
  const d = value as CanalVisualData;
  if (!d || typeof d !== "object") throw new Error("canal seed: bad bundle");
  if (!d.canal || !Array.isArray(d.outlets) || !Array.isArray(d.flows)) {
    throw new Error("canal seed: missing canal/outlets/flows");
  }
  if (!d.needMet?.equal_hours || !d.needMet?.equal_water || !d.comparison || !d.overrun) {
    throw new Error("canal seed: missing roster/overrun data");
  }
}

assertSeed(seed);

export const MOCK_DATA: CanalVisualData = seed;
