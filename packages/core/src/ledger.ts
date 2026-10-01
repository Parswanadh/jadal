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
            // Urgent approval: no net volume change between accounts other than recorded reason
            rawEntries.push({
              from: `farmer:${farmerId}:quota`,
              to: `farmer:${farmerId}:quota`,
              volume_m3: e.volume_m3,
              reason: e.note || "urgent request approved",
            });
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
