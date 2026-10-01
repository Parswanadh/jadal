/**
 * The single import boundary between the API and the deterministic core.
 *
 * Everything in this module either re-exports `@jadal/core` (the merged Task A implementation of
 * `packages/contracts/src/core.ts`), wraps a core export so an API-specific rule cannot be bypassed
 * (`ledger`), or comes from `./core-adapters`, which holds the few helpers the core does not export.
 * Explicit re-exports rather than a bare `export *` so this file stays reviewable and a name the core
 * does not own cannot leak in silently.
 *
 * Rules that hold:
 *  * Every water number in the API comes from `@jadal/core` or from the pin-compatible adapters in
 *    `./core-adapters`. No route, agent or prompt does arithmetic.
 *  * Agronomic constants come from the verified FAO-56 JSON in the core (`cropParams`); the API
 *    never types a table in by hand.
 */

import { ledger as coreLedger } from "@jadal/core";
import type { JadalEvent, Ledger, LedgerEntry } from "@jadal/contracts";

export {
  cropEngine,
  SOIL_AVAILABLE_WATER,
  hydraulics,
  rosterEngine,
  policy,
  cropParams,
  mmHaToCubicMeters,
} from "@jadal/core";

export {
  round,
  daysBetween,
  effectiveRain_mm,
  cropParamsFor,
  entriesForDecision,
} from "./core-adapters";

/**
 * Plan an event's water movements.
 *
 * `@jadal/core`'s `entriesFor` emits the `request.decided` movement itself, and for an urgent grant
 * that movement is `farmer:{id}:quota → farmer:{id}:quota` — a self-transfer `store.planAppend`
 * rejects with `invalid_ledger_entry`. The API books decision movements from the request row via
 * `entriesForDecision` (`routes/write.ts` `appendDecision`), so `request.decided` must carry no
 * entries here; every other event is delegated to the core unchanged.
 */
export function entriesFor(event: JadalEvent): LedgerEntry[] {
  if (event.type === "request.decided") return [];
  return coreLedger.entriesFor(event);
}

/**
 * The API's ledger facade: the core ledger with `entriesFor` replaced by the wrapped version above,
 * so a caller using `ledger.entriesFor` cannot bypass the `request.decided` guard. The spread keeps
 * `balances` on the facade, which is what `checkConservation`'s `this.balances(entries)` call needs.
 */
export const ledger: Ledger = { ...coreLedger, entriesFor };
