/**
 * Deterministic core — the single seam between the API and water arithmetic.
 *
 * Implements the interfaces declared in `packages/contracts/src/core.ts`. When Task A merges,
 * `src/core-shim.ts` becomes `export * from "@jadal/core"` and this folder is deleted; nothing
 * outside `src/core/` needs to change.
 *
 * These functions are pure. No I/O, no `Date.now()`, no LLM, no database.
 */

import type {
  Balances,
  CropEngine,
  Hydraulics,
  Ledger,
  Policy,
  RosterEngine,
} from "@jadal/contracts/core";

export { cropEngine } from "./crop-engine";
export { hydraulics } from "./hydraulics";
export { rosterEngine } from "./roster";
export { ledger } from "./ledger";
export { policy } from "./policy";

export type { Balances, CropEngine, Hydraulics, Ledger, Policy, RosterEngine };