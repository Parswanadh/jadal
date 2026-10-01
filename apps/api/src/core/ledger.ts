/**
 * Double-entry volume ledger. Implements `Ledger` from `@jadal/contracts/core`.
 *
 * The event log is the only input. `entriesFor` is a pure function from one `JadalEvent` to the water
 * movements that event causes, following the table in `docs/architecture/overview.md` §3:
 *
 *   | event                  | movement                                                       |
 *   | ---------------------- | -------------------------------------------------------------- |
 *   | season.approved        | canal_supply → each farmer's quota, remainder → buffer          |
 *   | turn.delivered         | farmer quota → farmer delivered, and quota → conveyance loss    |
 *   | request.decided        | farmer quota (urgent) or buffer (buffer) → the farmer's delivered|
 *   | week.released_to_buffer| quota → buffer                                                |
 *   | crop.harvested         | quota → buffer                                                |
 *   | rain.replanned         | each farmer's quota → buffer                                  |
 *   | everything else        | nothing moves                                                 |
 *
 * `request.decided` is the one row that needs more than the event: see the SCHEMA NOTE in
 * `movementsFor` and the `entriesForDecision` helper below.
 *
 * **Why conservation is exact, not merely checked.** `canal_supply` is only ever a *source* account,
 * and every *destination* is one of the four water accounts (`farmer:*:quota`, `farmer:*:delivered`,
 * `buffer`, `losses:conveyance`). So for any set of entries, writing `S` for the supply debited and
 * `T` for the sum of all entry volumes:
 *
 *   credits to the four accounts  = T
 *   debits  from the four accounts = T − S
 *   net of the four accounts      = T − (T − S) = S
 *
 * which is precisely the invariant `season supply = Σ quotas + buffer + Σ delivered + losses` that
 * `checkConservation` verifies. It holds by construction, for any event mix, as long as no entry
 * invents an account outside that set — which is why every account built here is one of the
 * `LedgerAccount` literals or `farmer:<id>:quota|delivered`, and why `balances` throws on anything
 * else rather than quietly dropping water.
 *
 * Being structural has one consequence worth stating plainly, because it bounds what the auditor can
 * trust: **the invariant cannot detect a missing movement.** Drop a delivery entry and the volume
 * leaves both sides of the sum, so the balance still holds — the water is simply gone from the canal
 * and nobody can tell from this check. What `checkConservation` does catch is a season supply on
 * record that disagrees with the log (a lost, duplicated or invented season event), and an account
 * outside the union. Catching a farmer who was scheduled but never served is a different check —
 * roster `planned_volume_m3` against ledger `delivered` — and belongs to the auditor agent, not here.
 *
 * Two DB-level rules shape the output (`apps/api/migrations/0002_jadal.sql`):
 *   * `CHECK (volume_m3 > 0)` — zero-volume movements are dropped rather than written.
 *   * `CHECK (from_account <> to_account)` — a movement that would credit and debit one account is
 *     dropped; a real self-transfer means the caller is modelling the wrong thing.
 * Entry ids are `${event.id}:e${n}`, 1-based over the *emitted* entries, so an event's ids are stable
 * whether or not zero-volume movements were filtered out, and `appendEvent` stays idempotent.
 */

import type { Balances, Ledger, LedgerAccount, LedgerEntry } from "@jadal/contracts";
import type { JadalEvent } from "@jadal/contracts";

import { LedgerAccount as LedgerAccountSchema } from "@jadal/contracts";
import { round } from "./units";

/** Volumes are stored to 1e-6 m³ — the rounding resolution, and the floor for the CHECK constraint. */
const VOLUME_DECIMALS = 6;
/** Balances are reported to 0.001 m³, three orders of magnitude below the 0.5 m³ audit tolerance. */
const BALANCE_DECIMALS = 3;
/** Float slack when testing a rounded volume against zero, in m³. */
const EPSILON = 1e-6;

/** A movement before it has been filtered and numbered. */
interface Movement {
  from: LedgerAccount;
  to: LedgerAccount;
  volume_m3: number;
  reason: string;
}

export function quotaAccount(farmer_id: string): LedgerAccount {
  return `farmer:${farmer_id}:quota`;
}

export function deliveredAccount(farmer_id: string): LedgerAccount {
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
 * the ledger hands out corresponds to a row that satisfies both DB CHECKs.
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

function movementsFor(event: JadalEvent): Movement[] {
  switch (event.type) {
    case "season.approved": {
      // One entry per approved entitlement, then whatever the coordinator did not allocate. An
      // over-allocated season (entitlements > season_supply_m3) is a coordinator error the auditor
      // must see, so no negative "remainder" entry is invented to hide it: `checkConservation`
      // reports the gap.
      const movements: Movement[] = event.entitlements.map((entitlement) => ({
        from: "canal_supply",
        to: quotaAccount(entitlement.farmer_id),
        volume_m3: entitlement.volume_m3,
        reason: `season entitlement ${entitlement.id} week ${entitlement.week_start}`,
      }));
      const allocated = event.entitlements.reduce((sum, entitlement) => sum + entitlement.volume_m3, 0);
      const remainder = event.season_supply_m3 - allocated;
      movements.push({
        from: "canal_supply",
        to: "buffer",
        volume_m3: remainder,
        reason: "season supply not allocated to entitlements",
      });
      return movements;
    }

    case "turn.delivered": {
      // The field-gate volume is charged to the farmer's quota, split into what reached the field and
      // what the seepage ate on the way. `overrun_h` moves no water here: the downstream farmers who
      // missed their turn are recorded as roster shortfall, and the over-runner's own surplus is
      // already inside `delivered_m3`.
      return [
        {
          from: quotaAccount(event.farmer_id),
          to: deliveredAccount(event.farmer_id),
          volume_m3: event.delivered_m3,
          reason: `turn ${event.turn_id} delivered`,
        },
        {
          from: quotaAccount(event.farmer_id),
          to: "losses:conveyance",
          volume_m3: event.conveyance_loss_m3,
          reason: `conveyance loss on turn ${event.turn_id}`,
        },
      ];
    }

    case "week.released_to_buffer":
      return [
        {
          from: quotaAccount(event.farmer_id),
          to: "buffer",
          volume_m3: event.volume_m3,
          reason: `week ${event.week_start} released to buffer`,
        },
      ];

    case "crop.harvested":
      return [
        {
          from: quotaAccount(event.farmer_id),
          to: "buffer",
          volume_m3: event.remaining_m3,
          reason: `crop plan ${event.crop_plan_id} harvested, quota returned`,
        },
      ];

    case "rain.replanned": {
      // The saving is per farmer (`by_farmer_m3`), which is the only farmer-scoped form the event
      // has, so that is what each quota is debited by and the buffer credited with. `saved_m3` is the
      // same total by definition: if a writer ever sets it to something else, the conservation
      // invariant still holds (it is structural) and the discrepancy has to be caught by comparing
      // the event's own two fields — which is why no scaling is applied here.
      return Object.keys(event.by_farmer_m3)
        .sort()
        .map((farmer_id) => ({
          from: quotaAccount(farmer_id),
          to: "buffer",
          volume_m3: event.by_farmer_m3[farmer_id] ?? 0,
          reason: "rain re-plan: reduced need returned to buffer",
        }));
    }

    case "request.decided":
      // SCHEMA NOTE: `request.decided` carries `request_id` only — no `farmer_id`, no request `type`
      // — so a pure event→entry function cannot tell whose quota to debit, nor whether the buffer
      // funds it. Nothing is emitted here; `db/repo.ts` resolves the `request` row inside the same
      // batch and calls `entriesForDecision`. Adding `farmer_id` and `type` to the event would close
      // this (reported as a contract change, see the task report).
      return [];

    default:
      return [];
  }
}

/**
 * The movement a coordinator decision implies, once the request it refers to has been looked up.
 *
 * ASSUMED: the `LedgerAccount` union has no week-scoped quota and no "reserved" account, so an
 * approved grant is booked into `farmer:{id}:delivered` at decision time. That makes the deduction
 * visible immediately (the point of an urgent approval: volume comes out of the farmer's future
 * quota) and keeps `quota − delivered`, the quantity `policy.canGrantUrgent` checks, honest. The cost
 * is a convention for the caller: the turn that delivers a granted volume must not book the same
 * water again in `turn.delivered`.
 */
export function entriesForDecision(attribution: DecisionAttribution): LedgerEntry[] {
  const { event, farmer_id, request_type } = attribution;
  if (event.decision !== "approve") return [];

  const from: LedgerAccount | null =
    request_type === "urgent" ? quotaAccount(farmer_id) : request_type === "buffer" ? "buffer" : null;
  if (from === null) {
    // `release_to_buffer` and `harvest_exit` are already accounted for by `week.released_to_buffer`
    // and `crop.harvested`; approving them must not move water twice.
    return [];
  }

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

/** Where a volume sitting in an account is counted in `Balances`. */
type Bucket =
  | { kind: "supply" }
  | { kind: "buffer" }
  | { kind: "losses" }
  | { kind: "quota"; farmer_id: string }
  | { kind: "delivered"; farmer_id: string };

const FARMER_ACCOUNT = /^farmer:([^:]+):(quota|delivered)$/;

/**
 * Classify an account against the `LedgerAccount` union.
 *
 * The zod union is the authority: an account it rejects is a bug, and throwing is the right response,
 * because silently ignoring it would break the conservation invariant that the auditor relies on.
 */
function bucketOf(account: string): Bucket {
  if (!LedgerAccountSchema.safeParse(account).success) {
    throw new RangeError(`ledger entry uses an account outside LedgerAccount: ${account}`);
  }
  const farmer = FARMER_ACCOUNT.exec(account);
  if (farmer) {
    const farmer_id = farmer[1];
    const field = farmer[2];
    if (farmer_id === undefined || field === undefined) {
      throw new RangeError(`ledger entry uses an unparseable farmer account: ${account}`);
    }
    return field === "quota" ? { kind: "quota", farmer_id } : { kind: "delivered", farmer_id };
  }
  if (account === "canal_supply") return { kind: "supply" };
  if (account === "buffer") return { kind: "buffer" };
  return { kind: "losses" };
}

/** Gini of the distribution `values`, 0 when it is perfectly (or degenerately) equal. */
function giniOf(values: readonly number[]): number {
  const n = values.length;
  if (n === 0 || n === 1) return 0;
  // A Gini over negative values has no interpretation (need met is never negative), so an input that
  // contains one reports 0 rather than a number nobody should act on.
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return 0;
  if (sorted.every((value) => value === sorted[0])) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i += 1) weighted += (i + 1) * (sorted[i] ?? 0);
  const g = (2 * weighted) / (n * total) - (n + 1) / n;
  const clamped = g > 1 ? 1 : g < 0 ? 0 : g;
  return round(clamped, 6);
}

/**
 * The double entries one event writes. Named export as well as a method on `ledger`, because the
 * event store (`src/db/store.ts`) calls it directly while planning its `db.batch()`.
 */
export function entriesFor(event: JadalEvent): LedgerEntry[] {
  return movementsOf(event, movementsFor(event));
}

export const ledger: Ledger = {
  entriesFor,

  balances(entries: LedgerEntry[]): Balances {
    // Water is credited to the destination and debited from the source, and an account's balance is
    // the water it still holds: `canal_supply` and `losses:conveyance` are filled by being debited,
    // `buffer` likewise, and a farmer's `quota`/`delivered` grow as they are credited. So every
    // bucket takes the same signed delta. Summing in entry order keeps the float sum deterministic.
    let canal_supply = 0;
    let buffer = 0;
    let conveyance_losses = 0;
    const farmers: Record<string, { quota: number; delivered: number }> = {};

    const apply = (account: Bucket, signed: number): void => {
      if (account.kind === "supply") canal_supply += signed;
      else if (account.kind === "buffer") buffer += signed;
      else if (account.kind === "losses") conveyance_losses += signed;
      else {
        const farmer = farmers[account.farmer_id] ?? { quota: 0, delivered: 0 };
        if (account.kind === "quota") farmer.quota += signed;
        else farmer.delivered += signed;
        farmers[account.farmer_id] = farmer;
      }
    };

    for (const entry of entries) {
      // +1 credits the account (water arriving), -1 debits it (water leaving). Summing in entry
      // order keeps the float sum deterministic for a given log.
      apply(bucketOf(entry.to), entry.volume_m3);
      apply(bucketOf(entry.from), -entry.volume_m3);
    }

    const netFarmers: Record<string, { quota: number; delivered: number }> = {};
    for (const [farmer_id, farmer] of Object.entries(farmers)) {
      netFarmers[farmer_id] = {
        quota: round(farmer.quota, BALANCE_DECIMALS),
        delivered: round(farmer.delivered, BALANCE_DECIMALS),
      };
    }

    return {
      canal_supply: round(canal_supply, BALANCE_DECIMALS),
      buffer: round(buffer, BALANCE_DECIMALS),
      conveyance_losses: round(conveyance_losses, BALANCE_DECIMALS),
      farmers: netFarmers,
    };
  },

  checkConservation(entries: LedgerEntry[], seasonSupply_m3: number, tolerance_m3 = 0.5) {
    const balances = ledger.balances(entries);
    let accounted = balances.buffer + balances.conveyance_losses;
    for (const farmer of Object.values(balances.farmers)) {
      accounted += farmer.quota + farmer.delivered;
    }
    const diff = seasonSupply_m3 - accounted;
    if (!Number.isFinite(diff)) {
      // A non-finite difference cannot be reported as a number; it is a violation regardless.
      return { ok: false, diff_m3: 0 };
    }
    const tolerance = Number.isFinite(tolerance_m3) ? Math.max(0, tolerance_m3) : 0;
    return { ok: Math.abs(diff) <= tolerance, diff_m3: round(diff, VOLUME_DECIMALS) };
  },

  gini(values: number[]): number {
    return giniOf(values);
  },
};
