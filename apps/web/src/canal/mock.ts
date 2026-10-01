// C5 canal hero: typed access to the precomputed seed (seed.json).
//
// The contract has no HTTP route for per-outlet hydraulics flows or for
// overrunImpact (both are @jadal/core functions used by agent tools), so the
// canal page reads them from this precomputed bundle. The numbers were
// generated once, offline, by calling hydraulics.atOutlets / overrunImpact from
// packages/core on packages/contracts/fixtures/demo-scenario.json, so they stay
// consistent with the shared mock's canal and outlets. Nothing is computed at
// runtime. The canal, outlets, need-met and Gini all come from the API client.

import seed from "./seed.json";
import type { OutletFlow, OverrunCase } from "./types";

export interface CanalSeed {
  /** Telugu display names of outlets, keyed by outlet id (the contract has no Telugu names). */
  outlet_name_te: Record<string, string>;
  flows: OutletFlow[];
  overrunSteps: number[];
  overrun: Record<string, Record<string, OverrunCase>>;
}

// ASSUMED: precomputed core results for the demo scenario; replaced by live hydraulics once an API route serves them.
export const CANAL_SEED: CanalSeed = seed as unknown as CanalSeed;
