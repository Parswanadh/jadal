export interface Balances {
  canal_supply: number;
  buffer: number;
  conveyance_losses: number;
  farmers: Record<string, { quota: number; delivered: number }>;
}

export type LedgerAccount =
  | "canal_supply"
  | "buffer"
  | "losses:conveyance"
  | `farmer:${string}:quota`
  | `farmer:${string}:delivered`
  | string;

export interface LedgerEntry {
  id: string;
  at: string;
  from: LedgerAccount;
  to: LedgerAccount;
  volume_m3: number;
  reason: string;
  event_id: string;
}

export interface Actor {
  kind: "coordinator" | "farmer" | "agent" | "system" | string;
  id: string;
}

export interface BaseEvent {
  id: string;
  at: string;
  canal_id: string;
  actor: Actor;
}

export interface SeasonApprovedEvent extends BaseEvent {
  type: "season.approved";
  season_supply_m3: number;
  entitlements: Array<{
    id?: string;
    farmer_id: string;
    crop_plan_id?: string;
    week_start?: string;
    volume_m3: number;
    net_irrigation_mm?: number;
    status?: string;
    explanation?: string;
  }>;
}

export interface TurnDeliveredEvent extends BaseEvent {
  type: "turn.delivered";
  turn_id: string;
  farmer_id: string;
  delivered_m3: number;
  conveyance_loss_m3: number;
  overrun_h?: number;
}

export interface RainReplannedEvent extends BaseEvent {
  type: "rain.replanned";
  saved_m3: number;
  by_farmer_m3: Record<string, number>;
}

export interface WeekReleasedToBufferEvent extends BaseEvent {
  type: "week.released_to_buffer";
  farmer_id: string;
  week_start: string;
  volume_m3: number;
}

export interface CropHarvestedEvent extends BaseEvent {
  type: "crop.harvested";
  farmer_id: string;
  crop_plan_id: string;
  remaining_m3: number;
}

export interface RequestDecidedEvent extends BaseEvent {
  type: "request.decided";
  request_id: string;
  decision: "approve" | "reject";
  volume_m3: number;
  note?: string;
  farmer_id?: string;
  request_type?: "urgent" | "buffer" | string;
  [key: string]: unknown;
}

export interface GenericEvent extends BaseEvent {
  type: string;
  [key: string]: unknown;
}

export type JadalEvent =
  | SeasonApprovedEvent
  | TurnDeliveredEvent
  | RainReplannedEvent
  | WeekReleasedToBufferEvent
  | CropHarvestedEvent
  | RequestDecidedEvent
  | GenericEvent;

export interface Ledger {
  /** Pure: turns events into double entries. */
  entriesFor(event: JadalEvent): LedgerEntry[];
  balances(entries: LedgerEntry[]): Balances;
  /** season supply = Σ quota + buffer + Σ delivered + conveyance losses (within tolerance_m3). */
  checkConservation(
    entries: LedgerEntry[],
    seasonSupply_m3: number,
    tolerance_m3?: number,
  ): { ok: boolean; diff_m3: number };
  /** Gini coefficient of % need met across farmers (0 = perfectly equal). */
  gini(values: number[]): number;
}

function round6(val: number): number {
  return Math.round(val * 1e6) / 1e6;
}

export const ledger = {
  /**
   * Pure: turn one event into its double entries.
   *
   * Double-entry rule (README §9): every entry is `from -> to` with a positive `volume_m3`, and no
   * entry may have `from === to` — a self-transfer moves nothing and is not a movement. `balances`
   * below is the sum of credits minus debits per account.
   *
   * Units: every `volume_m3` is m3. `at` is an ISO-8601 instant carried through unchanged.
   *
   * Per-event semantics:
   *  * `season.approved`  — each positive entitlement debits `canal_supply` and credits
   *    `farmer:{id}:quota`; any supply left over goes to `buffer`.
   *  * `turn.delivered`   — debits the delivering farmer's quota for both the water delivered to
   *    the field gate and the conveyance loss, crediting `...:delivered` and `losses:conveyance`.
   *  * `week.released_to_buffer` / `crop.harvested` — farmer quota -> buffer.
   *  * `rain.replanned`   — per-farmer quota -> buffer, iterated in SORTED farmer-id order so the
   *    entry ids are stable across runs.
   *  * `request.decided`  — see the note on the urgent branch below.
   *  * Unknown `type`      — no entries. An unrecognised event is inert rather than an error.
   *
   * Boundaries:
   *  * Non-positive volumes are filtered out, so a zero or negative movement produces no entry and
   *    cannot violate the `volume_m3 > 0` DB CHECK.
   *  * `season.approved` where entitlements EXCEED `season_supply_m3` produces a negative
   *    remainder and a correspondingly negative `canal_supply` balance rather than an error; the
   *    over-allocation surfaces in `checkConservation`, not here.
   *  * `rain.replanned` does NOT check `saved_m3` against the sum of `by_farmer_m3`. The two can
   *    disagree and nothing detects it — see `docs/research/model-audit.md` F-08.
   *
   * ASSUMED: the `request.decided` branch infers the request type from up to five different
   * shapes (`request_type`, an embedded `request.type`, `requestType`, the note text, the request
   * id) because the event contract does not require the type to be present. That heuristic is a
   * compatibility shim, and a mis-classification silently books a grant against the wrong account.
   */
  entriesFor(event: JadalEvent): LedgerEntry[] {
    const rawEntries: Array<{
      from: LedgerAccount;
      to: LedgerAccount;
      volume_m3: number;
      reason: string;
    }> = [];

    switch (event.type) {
      case "season.approved": {
        const e = event as SeasonApprovedEvent;
        let totalEntitlements = 0;
        for (const ent of e.entitlements) {
          if (ent.volume_m3 > 0) {
            totalEntitlements += ent.volume_m3;
            rawEntries.push({
              from: "canal_supply",
              to: `farmer:${ent.farmer_id}:quota`,
              volume_m3: ent.volume_m3,
              reason: ent.explanation || "season approved: farmer entitlement quota",
            });
          }
        }
        const remainder = round6(e.season_supply_m3 - totalEntitlements);
        if (remainder > 0) {
          rawEntries.push({
            from: "canal_supply",
            to: "buffer",
            volume_m3: remainder,
            reason: "season approved: unallocated supply to buffer",
          });
        }
        break;
      }

      case "turn.delivered": {
        const e = event as TurnDeliveredEvent;
        if (e.delivered_m3 > 0) {
          rawEntries.push({
            from: `farmer:${e.farmer_id}:quota`,
            to: `farmer:${e.farmer_id}:delivered`,
            volume_m3: e.delivered_m3,
            reason: "turn delivered to field gate",
          });
        }
        if (e.conveyance_loss_m3 > 0) {
          rawEntries.push({
            from: `farmer:${e.farmer_id}:quota`,
            to: "losses:conveyance",
            volume_m3: e.conveyance_loss_m3,
            reason: "conveyance loss during turn delivery",
          });
        }
        break;
      }

      case "week.released_to_buffer": {
        const e = event as WeekReleasedToBufferEvent;
        if (e.volume_m3 > 0) {
          rawEntries.push({
            from: `farmer:${e.farmer_id}:quota`,
            to: "buffer",
            volume_m3: e.volume_m3,
            reason: "week unused / released to buffer",
          });
        }
        break;
      }

      case "crop.harvested": {
        const e = event as CropHarvestedEvent;
        if (e.remaining_m3 > 0) {
          rawEntries.push({
            from: `farmer:${e.farmer_id}:quota`,
            to: "buffer",
            volume_m3: e.remaining_m3,
            reason: "crop harvested early: remaining quota to buffer",
          });
        }
        break;
      }

      case "rain.replanned": {
        const e = event as RainReplannedEvent;
        const farmerIds = Object.keys(e.by_farmer_m3 || {}).sort();
        for (const fId of farmerIds) {
          const vol = e.by_farmer_m3[fId];
          if (vol !== undefined && vol > 0) {
            rawEntries.push({
              from: `farmer:${fId}:quota`,
              to: "buffer",
              volume_m3: vol,
              reason: "rain replanned: reduced need moved to buffer",
            });
          }
        }
        break;
      }

      case "request.decided": {
        const e = event as RequestDecidedEvent;
        if (e.decision === "approve" && e.volume_m3 > 0) {
          const isBuffer =
            e.request_type === "buffer" ||
            (e as any).request?.type === "buffer" ||
            (e as any).requestType === "buffer" ||
            /buffer/i.test(e.note ?? "") ||
            /buffer/i.test(e.request_id) ||
            (e as any).from === "buffer";

          const farmerId =
            e.farmer_id ??
            (e as any).farmerId ??
            (e as any).request?.farmer_id ??
            (e.actor?.kind === "farmer" ? e.actor.id : undefined) ??
            (e.request_id.match(/(?:req[-_])?(f\d+|farmer\d+)/i)?.[1]) ??
            "unknown";

          if (isBuffer) {
            rawEntries.push({
              from: "buffer",
              to: `farmer:${farmerId}:quota`,
              volume_m3: e.volume_m3,
              reason: e.note || "buffer request approved",
            });
          } else {
            // Urgent approval moves no water between accounts: an urgent grant re-phases the SAME
            // farmer's own future quota forward in time, so the quota account is debited and
            // credited by the same amount.
            //
            // Previously this pushed `farmer:id:quota -> farmer:id:quota`, a self-transfer that
            // nets to zero. That entry violates the double-entry rule stated above and is rejected
            // by the DB CHECK `from <> to`, which is why `apps/api/src/core-shim.ts` has to special
            // -case `request.decided` and book the decision from the request row instead
            // (`core-adapters.ts` `entriesForDecision`). Emitting no entry is the honest encoding
            // of "no net movement": `balances` would produce the identical result either way, but
            // only this version is a valid movement.
            //
            // ASSUMED: the time-shift itself (this week's water taken from a future week's quota)
            // is NOT represented, because `LedgerAccount` has no week-scoped quota account. See
            // `docs/research/model-audit.md` F-07.
          }
        }
        break;
      }

      default:
        break;
    }

    return rawEntries.map((raw, index) => ({
      id: `${event.id}:${index}`,
      at: event.at,
      from: raw.from,
      to: raw.to,
      volume_m3: raw.volume_m3,
      reason: raw.reason,
      event_id: event.id,
    }));
  },

  /**
   * Net balance of every account after applying the entries in order.
   *
   * Accounts: `canal_supply` [m3], `buffer` [m3], `conveyance_losses` [m3], and per farmer
   * `quota` [m3] and `delivered` [m3].
   *
   * Sign conventions (README §9): `canal_supply`, `buffer` and `conveyance_losses` are held as
   * ACCOUNT BALANCES — debits reduce them and credits increase them (so `canal_supply` falls as
   * entitlements are allocated). `farmer.quota` and `farmer.delivered` are held as MOVEMENT TOTALS
   * in the direction of flow (so `quota` grows when it is credited and falls when water is
   * delivered out of it). `checkConservation` relies on exactly these conventions.
   *
   * Boundaries:
   *  * Accounts are created lazily; an unknown farmer id appears with zero balances only if some
   *    entry names it. `Object.keys(bal.farmers)` therefore lists exactly the farmers with activity.
   *  * An entry whose `from`/`to` does not match a known account or the
   *    `farmer:{id}:{quota|delivered}` pattern is silently ignored — a typo'd account name loses
   *    volume with no error. This is the mechanism by which conservation can break silently.
   *  * `volume_m3` of 0 (or NaN, which is falsy-checked by `if (!v) continue`) contributes nothing.
   *  * Balances are rounded to 6 decimals at the end, so a chain of tiny entries cannot leave
   *    float dust in the reported figures.
   */
  balances(entries: LedgerEntry[]): Balances {
    const bal: Balances = {
      canal_supply: 0,
      buffer: 0,
      conveyance_losses: 0,
      farmers: {},
    };

    const getFarmer = (id: string) => {
      let f = bal.farmers[id];
      if (!f) {
        f = { quota: 0, delivered: 0 };
        bal.farmers[id] = f;
      }
      return f;
    };

    for (const entry of entries) {
      const v = entry.volume_m3;
      if (!v) continue;

      // Source account
      if (entry.from === "canal_supply") {
        bal.canal_supply += v;
      } else if (entry.from === "buffer") {
        bal.buffer -= v;
      } else if (entry.from === "losses:conveyance") {
        bal.conveyance_losses -= v;
      } else {
        const m = entry.from.match(/^farmer:([^:]+):(quota|delivered)$/);
        if (m) {
          const [, farmerId, type] = m;
          const f = getFarmer(farmerId!);
          if (type === "quota") {
            f.quota -= v;
          } else if (type === "delivered") {
            f.delivered -= v;
          }
        }
      }

      // Destination account
      if (entry.to === "canal_supply") {
        bal.canal_supply -= v;
      } else if (entry.to === "buffer") {
        bal.buffer += v;
      } else if (entry.to === "losses:conveyance") {
        bal.conveyance_losses += v;
      } else {
        const m = entry.to.match(/^farmer:([^:]+):(quota|delivered)$/);
        if (m) {
          const [, farmerId, type] = m;
          const f = getFarmer(farmerId!);
          if (type === "quota") {
            f.quota += v;
          } else if (type === "delivered") {
            f.delivered += v;
          }
        }
      }
    }

    bal.canal_supply = round6(bal.canal_supply);
    bal.buffer = round6(bal.buffer);
    bal.conveyance_losses = round6(bal.conveyance_losses);
    for (const farmerId of Object.keys(bal.farmers)) {
      const f = bal.farmers[farmerId]!;
      f.quota = round6(f.quota);
      f.delivered = round6(f.delivered);
    }

    return bal;
  },

  /**
   * Checks the conservation invariant (README §9):
   *
   *   season_supply = sum(quotas) + buffer + sum(delivered) + conveyance_losses   [m3]
   *
   * The identity holds by construction when every entry is well-formed, because each entry moves
   * volume between two of the four accounted places and never out of the system.
   *
   * `tolerance_m3` defaults to 0.001 m3 (one litre). ASSUMED: this default is a project choice.
   * It absorbs the 6-decimal rounding applied by `balances`, but it also means a genuine
   * discrepancy of up to a litre is reported as `ok: true`.
   *
   * Boundaries:
   *  * `diff_m3` is the ABSOLUTE difference and is reported even when `ok` is true, so a caller can
   *    log drift rather than only seeing pass/fail.
   *  * A difference below 1e-9 is snapped to exactly 0, so float dust never shows as a nonzero diff.
   *  * `tolerance_m3 = 0` is honoured (and, because of that snap, still passes on exact equality).
   *  * A NEGATIVE tolerance makes `ok` true only when the diff is itself negative — which cannot
   *    happen, so `ok` is always false. Passing a negative tolerance is a caller error.
   *  * An entry naming an unknown account (see `balances`) removes volume from the identity, so the
   *    check correctly FAILS in that case — this is the intended way to detect a typo'd account.
   */
  checkConservation(
    entries: LedgerEntry[],
    seasonSupply_m3: number,
    tolerance_m3?: number,
  ): { ok: boolean; diff_m3: number } {
    const bal = this.balances(entries);
    const totalQuotas = Object.values(bal.farmers).reduce((sum, f) => sum + f.quota, 0);
    const totalDelivered = Object.values(bal.farmers).reduce((sum, f) => sum + f.delivered, 0);
    const totalAccounted = totalQuotas + bal.buffer + totalDelivered + bal.conveyance_losses;

    const rawDiff = Math.abs(totalAccounted - seasonSupply_m3);
    const diff_m3 = rawDiff < 1e-9 ? 0 : round6(rawDiff);
    const tolerance = tolerance_m3 !== undefined ? tolerance_m3 : 0.001;
    const ok = diff_m3 <= tolerance;

    return { ok, diff_m3 };
  },

  /**
   * Gini coefficient of a distribution (README §9):
   *
   *   G = sum_i sum_j |x_i - x_j| / (2 . n . sum_i x_i)             [dimensionless]
   *
   * 0 = perfect equality, -> 1 = maximal inequality. Used on the per-farmer "% need met" series
   * from `rosterEngine.needMet` to compare equal_water against equal_hours.
   *
   * This is the mean absolute difference form of the Gini, which is algebraically identical to the
   * more common Lorenz-curve form. It is computed in O(n^2) directly, without sorting, so the
   * result is independent of input order — a deliberate determinism guarantee.
   *
   * Units: the ratio is scale-invariant, so the input unit cancels. Percent, m3 or fractions all
   * give the same coefficient.
   *
   * Boundaries:
   *  * Empty input returns 0. ASSUMED: no farmers means no inequality to report, not NaN.
   *  * A single value returns 0 (one person cannot be unequal to themselves).
   *  * All-zero input returns 0 rather than 0/0 = NaN, because the `sum <= 0` guard fires first.
   *    This matters for needMet output: if every farmer received 0%, the honest reading is
   *    "no water was distributed, so the distribution is not unequal", and the caller must consult
   *    the shortfall figures rather than the Gini to detect the failure.
   *  * A NEGATIVE value is not meaningful for this statistic but is not rejected; one negative
   *    entry can drive `sum` to <= 0 and the function then returns 0.
   */
  gini(values: number[]): number {
    if (values.length === 0) return 0;
    const n = values.length;
    const sum = values.reduce((acc, val) => acc + val, 0);
    if (sum <= 0) return 0;

    let diffSum = 0;
    for (let i = 0; i < n; i++) {
      const vi = values[i]!;
      for (let j = 0; j < n; j++) {
        diffSum += Math.abs(vi - values[j]!);
      }
    }

    return diffSum / (2 * n * sum);
  },
} satisfies Ledger;
