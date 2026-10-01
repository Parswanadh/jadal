import type {
  Balances,
  JadalEvent,
  Ledger,
  LedgerAccount,
  LedgerEntry,
} from "@jadal/contracts";

export class JadalLedger implements Ledger {
  /**
   * Pure function: turns a Jadal domain event into double-entry ledger movements.
   * Every movement is atomic and volume-conserving.
   */
  entriesFor(event: JadalEvent): LedgerEntry[] {
    const entries: LedgerEntry[] = [];
    const eventId = event.id;
    const at = event.at;

    let seq = 1;
    const makeEntry = (
      from: LedgerAccount,
      to: LedgerAccount,
      volume_m3: number,
      reason: string
    ): LedgerEntry | null => {
      if (volume_m3 <= 0.0001) return null;
      return {
        id: `le_${eventId}_${seq++}`,
        at,
        from,
        to,
        volume_m3,
        reason,
        event_id: eventId,
      };
    };

    switch (event.type) {
      case "season.approved": {
        let totalEntitlements = 0;
        for (const ent of event.entitlements) {
          if (ent.volume_m3 > 0) {
            totalEntitlements += ent.volume_m3;
            const entry = makeEntry(
              "canal_supply",
              `farmer:${ent.farmer_id}:quota`,
              ent.volume_m3,
              `Approved seasonal entitlement for plan ${ent.crop_plan_id}`
            );
            if (entry) entries.push(entry);
          }
        }
        const unallocated = event.season_supply_m3 - totalEntitlements;
        if (unallocated > 0) {
          const entry = makeEntry(
            "canal_supply",
            "buffer",
            unallocated,
            "Unallocated seasonal supply allocated to common buffer"
          );
          if (entry) entries.push(entry);
        }
        break;
      }

      case "turn.delivered": {
        const { farmer_id, delivered_m3, conveyance_loss_m3 } = event;
        if (delivered_m3 > 0) {
          const entry = makeEntry(
            `farmer:${farmer_id}:quota`,
            `farmer:${farmer_id}:delivered`,
            delivered_m3,
            `Delivered turn ${event.turn_id}`
          );
          if (entry) entries.push(entry);
        }
        if (conveyance_loss_m3 > 0) {
          const entry = makeEntry(
            `farmer:${farmer_id}:quota`,
            "losses:conveyance",
            conveyance_loss_m3,
            `Conveyance loss for turn ${event.turn_id}`
          );
          if (entry) entries.push(entry);
        }
        break;
      }

      case "week.released_to_buffer": {
        const entry = makeEntry(
          `farmer:${event.farmer_id}:quota`,
          "buffer",
          event.volume_m3,
          `Farmer ${event.farmer_id} released week ${event.week_start} to buffer`
        );
        if (entry) entries.push(entry);
        break;
      }

      case "crop.harvested": {
        const entry = makeEntry(
          `farmer:${event.farmer_id}:quota`,
          "buffer",
          event.remaining_m3,
          `Crop plan ${event.crop_plan_id} harvested; remaining quota to buffer`
        );
        if (entry) entries.push(entry);
        break;
      }

      case "rain.replanned": {
        if (event.by_farmer_m3) {
          for (const [farmerId, vol] of Object.entries(event.by_farmer_m3)) {
            if (vol > 0) {
              const entry = makeEntry(
                `farmer:${farmerId}:quota`,
                "buffer",
                vol,
                `Rain replan: reduced water need moved to buffer`
              );
              if (entry) entries.push(entry);
            }
          }
        }
        break;
      }

      case "request.decided": {
        // If an approved request moves volume (e.g. buffer request approved)
        if (event.decision === "approve" && event.volume_m3 > 0) {
          // If actor is farmer or note indicates buffer, move from buffer to farmer quota
          const targetFarmer = event.actor.kind === "farmer" ? event.actor.id : null;
          if (targetFarmer) {
            const entry = makeEntry(
              "buffer",
              `farmer:${targetFarmer}:quota`,
              event.volume_m3,
              `Approved request ${event.request_id} from buffer: ${event.note ?? ""}`
            );
            if (entry) entries.push(entry);
          }
        }
        break;
      }

      default:
        // Other events (registrations, proposals, triages, contacts) do not move water volume
        break;
    }

    return entries;
  }

  /**
   * Aggregates double entries into current account balances.
   */
  balances(entries: LedgerEntry[]): Balances {
    let canal_supply = 0;
    let buffer = 0;
    let conveyance_losses = 0;
    const farmers: Record<string, { quota: number; delivered: number }> = {};

    const getFarmer = (id: string) => {
      if (!farmers[id]) {
        farmers[id] = { quota: 0, delivered: 0 };
      }
      return farmers[id]!;
    };

    const applyDelta = (account: LedgerAccount, delta: number) => {
      if (account === "canal_supply") {
        canal_supply += delta;
      } else if (account === "buffer") {
        buffer += delta;
      } else if (account === "losses:conveyance") {
        conveyance_losses += delta;
      } else if (account.startsWith("farmer:")) {
        const parts = account.split(":");
        const farmerId = parts[1]!;
        const type = parts[2] as "quota" | "delivered";
        const f = getFarmer(farmerId);
        if (type === "quota") {
          f.quota += delta;
        } else if (type === "delivered") {
          f.delivered += delta;
        }
      }
    };

    for (const entry of entries) {
      applyDelta(entry.from, -entry.volume_m3);
      applyDelta(entry.to, entry.volume_m3);
    }

    return {
      canal_supply,
      buffer,
      conveyance_losses,
      farmers,
    };
  }

  /**
   * Invariant check: season supply = Σ quota + buffer + Σ delivered + conveyance losses
   */
  checkConservation(
    entries: LedgerEntry[],
    seasonSupply_m3: number,
    tolerance_m3 = 0.001
  ): { ok: boolean; diff_m3: number } {
    const bal = this.balances(entries);
    let totalWaterInSystem = bal.buffer + bal.conveyance_losses;

    for (const f of Object.values(bal.farmers)) {
      totalWaterInSystem += f.quota + f.delivered;
    }

    const diff_m3 = Math.abs(totalWaterInSystem - seasonSupply_m3);
    const ok = diff_m3 <= tolerance_m3;

    return { ok, diff_m3 };
  }

  /**
   * Computes the Gini coefficient of values across a population.
   * G = (Σ_i Σ_j |x_i - x_j|) / (2 * n * Σ_i x_i)
   * 0 = perfectly equal, 1 = absolute inequality.
   */
  gini(values: number[]): number {
    const n = values.length;
    if (n === 0) return 0;

    let sumDiff = 0;
    let sumVal = 0;

    for (let i = 0; i < n; i++) {
      const xi = values[i]!;
      sumVal += xi;
      for (let j = 0; j < n; j++) {
        const xj = values[j]!;
        sumDiff += Math.abs(xi - xj);
      }
    }

    if (sumVal === 0) return 0;
    return sumDiff / (2 * n * sumVal);
  }
}

export const ledger = new JadalLedger();
