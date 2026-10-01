import type { Channel, CropPlan, Farmer, Plot, RequestType, WaterRequest } from "@jadal/contracts";
import type { z } from "zod";
import { api, isMockMode } from "../api";
import type { RegisterBody } from "../api";

/**
 * Farmer-portal view of the shared typed API client (src/api/client.ts).
 * It only reshapes responses for display. Every volume and percentage comes
 * from the API (or its mock) and is passed on as returned.
 */

export type FarmerDirectoryEntry = {
  farmer: Farmer;
  plots: Plot[];
  cropPlans: CropPlan[];
  verified: boolean;
};

/** Body of the register route (see contracts routes.register). */
export type RegisterInput = RegisterBody;

export type RegisterResult = { farmer: Farmer; plots: Plot[]; crop_plans: CropPlan[] };

export type NextTurnView = {
  start: string;
  end: string;
  /** Water released at the outlet during the turn, as planned by the roster. */
  planned_volume_m3: number;
  outlet_name: string;
  /** False while the coordinator has not approved the roster yet. */
  approved: boolean;
};

/** One crop's share for the week, exactly as the API returned it. */
export type WeeklyShare = {
  crop_plan_id: string;
  crop: string;
  volume_m3: number;
  net_irrigation_mm: number;
  status: "proposed" | "approved" | "edited";
};

export type MyWaterView = {
  farmer_id: string;
  farmer_name: string;
  week_start: string | null;
  /** Empty until the coordinator has planned this farmer's crops. */
  shares: WeeklyShare[];
  next_turn: NextTurnView | null;
  delivered_m3: number;
  /** Null when the ledger has no quota for this farmer yet. */
  quota_m3: number | null;
  need_met_pct: number;
};

export type RequestTypeName = z.output<typeof RequestType>;
export type ChannelName = z.output<typeof Channel>;

export type RaiseRequestInput = {
  farmer_id: string;
  type: RequestTypeName;
  volume_m3: number;
  reason: string;
  channel: ChannelName;
  crop_plan_id?: string;
};

export type DataSource = "live" | "mock";

export interface FarmerApi {
  readonly source: DataSource;
  listFarmers(): Promise<FarmerDirectoryEntry[]>;
  register(input: RegisterInput): Promise<RegisterResult>;
  getMyWater(farmerId: string): Promise<MyWaterView>;
  raiseRequest(input: RaiseRequestInput): Promise<WaterRequest>;
  listRequests(): Promise<WaterRequest[]>;
}

export function createFarmerApi(): FarmerApi {
  return {
    get source(): DataSource {
      return isMockMode() ? "mock" : "live";
    },

    async listFarmers() {
      const list = await api.listFarmers();
      return list.map((e) => ({ farmer: e.farmer, plots: e.plots, cropPlans: e.crop_plans, verified: e.verified }));
    },

    register: (input) => api.register(input),

    async getMyWater(farmerId) {
      const [farmers, suggestion, windows, canal, ledger] = await Promise.all([
        api.listFarmers(),
        api.suggestEntitlements(),
        api.releaseWindows(),
        api.canal(),
        api.ledger(),
      ]);
      const entry = farmers.find((e) => e.farmer.id === farmerId);
      if (!entry) throw new Error(`Unknown farmer ${farmerId}`);
      const cropOf = new Map(entry.crop_plans.map((c) => [c.id, c.crop] as const));
      const mine = suggestion.entitlements.filter((e) => e.farmer_id === farmerId);
      const bal = ledger.balances.farmers.find((f) => f.farmer_id === farmerId);

      let nextTurn: NextTurnView | null = null;
      const win = windows[0];
      if (win) {
        const { roster } = await api.proposeRoster({ release_window_id: win.id, mode: "equal_water" });
        const turn = roster.turns.find((x) => x.farmer_id === farmerId);
        if (turn) {
          const outletName = canal.outlets.find((o) => o.id === turn.outlet_id)?.name ?? "";
          nextTurn = {
            start: turn.start,
            end: turn.end,
            planned_volume_m3: turn.planned_volume_m3,
            outlet_name: outletName,
            approved: roster.status === "approved",
          };
        }
      }
      return {
        farmer_id: entry.farmer.id,
        farmer_name: entry.farmer.name,
        week_start: mine[0]?.week_start ?? null,
        shares: mine.map((e) => ({
          crop_plan_id: e.crop_plan_id,
          crop: cropOf.get(e.crop_plan_id) ?? "",
          volume_m3: e.volume_m3,
          net_irrigation_mm: e.net_irrigation_mm,
          status: e.status,
        })),
        next_turn: nextTurn,
        delivered_m3: bal?.delivered_m3 ?? 0,
        quota_m3: bal ? bal.quota_m3 : null,
        need_met_pct: bal?.need_met_pct ?? 0,
      };
    },

    raiseRequest: (input) => api.raiseRequest(input),

    listRequests: () => api.listRequests(),
  };
}
