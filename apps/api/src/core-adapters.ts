/**
 * The API-local adapters over `@jadal/core` — the only helpers this app keeps outside the core.
 *
 * `packages/core` is the authority for every water number (`cropEngine`, `hydraulics`,
 * `rosterEngine`, `ledger`, `policy`, `cropParams`). A few helpers the API needs are not on the
 * core's public surface, and they live here rather than being re-implemented across the app:
 *
 *  * `round` and `daysBetween` — presentation/date utilities, not water arithmetic.
 *  * `effectiveRain_mm` — the USDA-SCS daily rule `docs/research/voice-and-data.md` §7.4 specifies
 *    for the Open-Meteo path. `voice.test.ts` pins its exact behaviour; the core does not export it.
 *  * `cropParamsFor` — the core ships `cropParams` as one verified FAO-56 row per crop (rice has a
 *    `flooded` and an `intermittent` variant); this selects the row a `CropPlan` must be evaluated
 *    with. Thin selection logic only: the numbers themselves come from the core's JSON.
 *  * `entriesForDecision` — the movement a coordinator decision implies, once the request row has
 *    supplied the `farmer_id` and `type` the `request.decided` event does not carry. The API owns
 *    this because it owns the request lookup (`routes/write.ts` `appendDecision`); the core's own
 *    `entriesFor` is not used for decisions (see `core-shim.ts`).
 *
 * Pure functions only: no I/O, no clock, no database.
 */

import { cropParams } from "@jadal/core";
import type { CropParams, CropPlan, JadalEvent, LedgerAccount, LedgerEntry } from "@jadal/contracts";

/* ------------------------------------------------------------------ utilities */

/** Round to `digits` decimals, avoiding -0 and float dust like 0.30000000000000004. */
export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

const MS_PER_DAY = 86_400_000;

/** Parse a strict `YYYY-MM-DD` date to epoch ms, or NaN. */
function isoToMs(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return Number.NaN;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return Number.NaN;
  return Date.UTC(year, month - 1, day);
}

/** Whole days from `fromIso` to `toIso`; NaN if either is not a `YYYY-MM-DD` date. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = isoToMs(fromIso);
  const b = isoToMs(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / MS_PER_DAY);
}

/* ------------------------------------------------------------------ effective rain */

/**
 * Daily effective rainfall, USDA Soil Conservation Service method, as specified in
 * `docs/research/voice-and-data.md` §7.4:
 *
 *   `Peff = 0`                              if `P ≤ 5 mm`   (intercepts and evaporates)
 *   `Peff = (P − 5) · 0.75`                 if `P ≤ 50 mm`
 *   `Peff = 0.70 · P`                       if `P > 50 mm`
 *
 * ASSUMED: this is **not** an FAO-56 equation. `docs/research/fao56-book-reference.md` records the
 * finding that FAO-56 prescribes no empirical effective-rain equation. The SCS curve is adopted
 * because it is the rule the project documents specify for the Open-Meteo path and it is closed-form
 * (no ponded-depth state to carry). The core does not export it, so the API carries this exact
 * pin-compatible copy; `voice.test.ts` asserts its behaviour against the §7.4 curve.
 */
export function effectiveRain_mm(dailyRain_mm: number): number {
  const p = Number.isFinite(dailyRain_mm) ? Math.max(0, dailyRain_mm) : 0;
  if (p <= 5) return 0;
  if (p <= 50) return (p - 5) * 0.75;
  return 0.7 * p;
}

/* ------------------------------------------------------------------ crop parameters */

/** The core's verified FAO-56 table, typed as the contract's `CropParams`. */
const CROP_PARAM_ROWS = cropParams as readonly CropParams[];

/**
 * Resolve the parameter row a plan should be evaluated with. Rice is the only crop with two rows;
 * `CropPlan.rice_practice` picks between them, defaulting to `flooded` when the field has not
 * declared a practice (a paddy with no declared practice is managed continuously flooded).
 *
 * The numeric authority is the core's JSON table — this only selects a row.
 */
export function cropParamsFor(plan: CropPlan): CropParams {
  if (plan.crop === "rice") {
    const variant = plan.rice_practice === "intermittent" ? "intermittent" : "flooded";
    const row = CROP_PARAM_ROWS.find((candidate) => candidate.crop === "rice" && candidate.variant === variant);
    if (row === undefined) {
      throw new RangeError(`@jadal/core has no rice (${variant}) parameters`);
    }
    return row;
  }

  const row = CROP_PARAM_ROWS.find((candidate) => candidate.crop === plan.crop);
  if (row === undefined) {
    throw new RangeError(`@jadal/core has no parameters for crop ${plan.crop}`);
  }
  return row;
}

/* ------------------------------------------------------------------ decisions */

/** Volumes are stored to 1e-6 m³ — the rounding resolution, and the floor for the DB CHECK. */
const VOLUME_DECIMALS = 6;
/** Float slack when testing a rounded volume against zero, in m³. */
const EPSILON = 1e-6;

/** A movement before it has been filtered and numbered. */
interface Movement {
  from: LedgerAccount;
  to: LedgerAccount;
  volume_m3: number;
  reason: string;
}

function quotaAccount(farmer_id: string): LedgerAccount {
  return `farmer:${farmer_id}:quota`;
}

function deliveredAccount(farmer_id: string): LedgerAccount {
  return `farmer:${farmer_id}:delivered`;
}

/** A decided request, resolved against the `request` row. See `entriesForDecision`. */
export interface DecisionAttribution {
  event: Extract<JadalEvent, { type: "request.decided" }>;
  /** `request.farmer_id`. */
  farmer_id: string;
  /** `request.type`. */
  request_type: "urgent" | "buffer" | "release_to_buffer" | "harvest_exit";
}

/**
 * Number, filter and stamp the movements of one event.
 *
 * Filtering happens *after* rounding and *before* numbering, so `e1`, `e2`, … are dense and every id
 * handed out corresponds to a row that satisfies both DB CHECKs (`volume_m3 > 0`, `from <> to`).
 */
function movementsOf(event: JadalEvent, movements: readonly Movement[]): LedgerEntry[] {
  const emitted = movements.flatMap((movement) => {
    const volume = round(movement.volume_m3, VOLUME_DECIMALS);
    if (!(volume > EPSILON)) return [];
    if (movement.from === movement.to) return [];
    return [{ volume_m3: volume, movement }];
  });
  return emitted.map((item, index) => ({
    id: `${event.id}:e${index + 1}`,
    at: event.at,
    from: item.movement.from,
    to: item.movement.to,
    volume_m3: item.volume_m3,
    reason: item.movement.reason,
    event_id: event.id,
  }));
}

/**
 * The movement a coordinator decision implies, once the request it refers to has been looked up.
 *
 * Semantics (unchanged from the pre-swap API core):
 *  * urgent approve  → `farmer:{id}:quota` → `farmer:{id}:delivered`;
 *  * buffer approve  → `buffer` → `farmer:{id}:delivered`;
 *  * reject, `release_to_buffer` and `harvest_exit` → `[]` (those are already booked by
 *    `week.released_to_buffer` / `crop.harvested`; approving them must not move water twice).
 *
 * ASSUMED: the `LedgerAccount` union has no week-scoped quota and no "reserved" account, so an
 * approved grant is booked into `farmer:{id}:delivered` at decision time. That makes the deduction
 * visible immediately and keeps `quota − delivered`, the quantity `policy.canGrantUrgent` checks,
 * honest.
 */
export function entriesForDecision(attribution: DecisionAttribution): LedgerEntry[] {
  const { event, farmer_id, request_type } = attribution;
  if (event.decision !== "approve") return [];

  const from: LedgerAccount | null =
    request_type === "urgent" ? quotaAccount(farmer_id) : request_type === "buffer" ? "buffer" : null;
  if (from === null) return [];

  return movementsOf(event, [
    {
      from,
      to: deliveredAccount(farmer_id),
      volume_m3: event.volume_m3,
      reason:
        request_type === "urgent"
          ? `urgent request ${event.request_id} approved from future quota`
          : `buffer request ${event.request_id} approved from buffer`,
    },
  ]);
}
