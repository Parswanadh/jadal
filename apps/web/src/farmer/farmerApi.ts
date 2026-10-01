import type { Channel, CropPlan, Farmer, Plot, RequestType, WaterRequest } from "@jadal/contracts";
import type { z } from "zod";
import { api, isMockMode } from "../api";
import type { RegisterBody } from "../api";

/**
 * Farmer-portal view of the shared typed API client (src/api/client.ts).
 * It only reshapes responses for display; the portal never computes water
 * numbers, every volume and percentage comes from the API (or its mock).
 */

export type FarmerDirectoryEntry = {
  farmer: Farmer;
  plots: Plot[];
  cropPlans: CropPlan[];
  verified: boolean;
};

/** Body of POST /api/farmers (see contracts routes.register). */
export type RegisterInput = RegisterBody;

export type RegisterResult = { farmer: Farmer; plots: Plot[]; crop_plans: CropPlan[] };

export type NextTurnView = {
  start: string;
  end: string;
  planned_volume_m3: number;
  outlet_name: string;
};

export type MyWaterView = {
  farmer_id: string;
  farmer_name: string;
  week_start: string;
  entitlement_m3: number;
  net_irrigation_mm: number;
  next_turn: NextTurnView | null;
  delivered_m3: number;
  quota_m3: number;
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

/**
 * Requests raised from the portal in mock mode. The shared mock returns a
 * fixed list, so portal-sent requests are appended locally to show up on the
 * buffer board. Live mode always reads from the server.
 */
const localRequests: WaterRequest[] = [];

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
      const farmer = farmers.find((e) => e.farmer.id === farmerId)?.farmer;
      if (!farmer) throw new Error(`Unknown farmer ${farmerId}`);
      const ent = suggestion.entitlements.find((e) => e.farmer_id === farmerId);
      if (!ent) throw new Error(`No entitlement for farmer ${farmerId}`);
      const bal = ledger.balances.farmers.find((f) => f.farmer_id === farmerId);
      if (!bal) throw new Error(`No balance for farmer ${farmerId}`);

      let nextTurn: NextTurnView | null = null;
      const win = windows[0];
      if (win) {
        const { roster } = await api.proposeRoster({ release_window_id: win.id, mode: "equal_water" });
        const turn = roster.turns.find((x) => x.farmer_id === farmerId);
        if (turn) {
          const outletName = canal.outlets.find((o) => o.id === turn.outlet_id)?.name ?? turn.outlet_id;
          nextTurn = { start: turn.start, end: turn.end, planned_volume_m3: turn.planned_volume_m3, outlet_name: outletName };
        }
      }
      return {
        farmer_id: farmer.id,
        farmer_name: farmer.name,
        week_start: ent.week_start,
        entitlement_m3: ent.volume_m3,
        net_irrigation_mm: ent.net_irrigation_mm,
        next_turn: nextTurn,
        delivered_m3: bal.delivered_m3,
        quota_m3: bal.quota_m3,
        need_met_pct: bal.need_met_pct,
      };
    },

    async raiseRequest(input) {
      const req = await api.raiseRequest(input);
      if (isMockMode()) localRequests.unshift(req);
      return req;
    },

    async listRequests() {
      const server = await api.listRequests();
      if (!isMockMode()) return server;
      return [...localRequests, ...server];
    },
  };
}
