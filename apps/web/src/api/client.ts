import type { CropPlan, Farmer, Plot, WaterRequest } from "@jadal/contracts";
import { Channel, RequestType } from "@jadal/contracts";
import {
  delivered as mockDelivered,
  initialRequests,
  scenario,
  turnsRw1,
  weeklyEntitlements,
} from "./mock";

/**
 * Typed client for the farmer portal. Method shapes mirror
 * packages/contracts/src/api.ts (routes.register, listFarmers,
 * raiseRequest, listRequests, ledger). Each method tries the live API
 * first and falls back to the fixture-backed mock when the backend
 * (Task B) is unreachable, so the portal works fully offline.
 */

// --- View types (display only; the UI never computes water numbers) ---

export type FarmerDirectoryEntry = {
  farmer: Farmer;
  plots: Plot[];
  cropPlans: CropPlan[];
  verified: boolean;
};

/** Body of POST /api/farmers (see contracts routes.register). */
export type RegisterInput = {
  farmer: Omit<Farmer, "id">;
  plots: Omit<Plot, "id" | "farmer_id">[];
  crop_plans: (Omit<CropPlan, "id" | "plot_id" | "status"> & { plot_index: number })[];
};

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

export type RequestTypeName = (typeof RequestType)["_output"];
export type ChannelName = (typeof Channel)["_output"];

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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

function directoryFromMock(): FarmerDirectoryEntry[] {
  return scenario.farmers.map((farmer) => {
    const plots = scenario.plots.filter((p) => p.farmer_id === farmer.id);
    const plotIds = new Set(plots.map((p) => p.id));
    const cropPlans = scenario.crop_plans.filter((c) => plotIds.has(c.plot_id));
    return { farmer, plots, cropPlans, verified: true };
  });
}

function myWaterFromMock(farmerId: string): MyWaterView {
  const farmer = scenario.farmers.find((f) => f.id === farmerId);
  if (!farmer) throw new Error(`Unknown farmer ${farmerId}`);
  const ent = weeklyEntitlements.find((e) => e.farmer_id === farmerId);
  if (!ent) throw new Error(`No entitlement for farmer ${farmerId}`);
  const turn = turnsRw1.find((x) => x.farmer_id === farmerId) ?? null;
  const bal = mockDelivered.find((d) => d.farmer_id === farmerId);
  if (!bal) throw new Error(`No balances for farmer ${farmerId}`);
  const outletName = turn ? (scenario.outlets.find((o) => o.id === turn.outlet_id)?.name ?? turn.outlet_id) : "";
  return {
    farmer_id: farmer.id,
    farmer_name: farmer.name,
    week_start: ent.week_start,
    entitlement_m3: ent.volume_m3,
    net_irrigation_mm: ent.net_irrigation_mm,
    next_turn: turn ? { start: turn.start, end: turn.end, planned_volume_m3: turn.planned_volume_m3, outlet_name: outletName } : null,
    delivered_m3: bal.delivered_m3,
    quota_m3: bal.quota_m3,
    need_met_pct: bal.need_met_pct,
  };
}

/** In-memory request store seeded from the mock; portal-sent requests append here. */
let requestStore: WaterRequest[] | null = null;
function store(): WaterRequest[] {
  if (!requestStore) requestStore = [...initialRequests];
  return requestStore;
}

class MockFarmerApi implements FarmerApi {
  readonly source: DataSource = "mock";

  async listFarmers(): Promise<FarmerDirectoryEntry[]> {
    return directoryFromMock();
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const n = store().length + scenario.farmers.length;
    const farmer: Farmer = { ...input.farmer, id: `f-new-${n}` };
    const plots: Plot[] = input.plots.map((p, i) => ({ ...p, id: `p-new-${n}-${i}`, farmer_id: farmer.id }));
    const crop_plans: CropPlan[] = input.crop_plans.map((c, i) => {
      const plot = plots[c.plot_index];
      if (!plot) throw new Error(`Unknown plot_index ${c.plot_index}`);
      const { plot_index: _ignored, ...rest } = c;
      return { ...rest, id: `cp-new-${n}-${i}`, plot_id: plot.id, status: "registered" as const };
    });
    return { farmer, plots, crop_plans };
  }

  async getMyWater(farmerId: string): Promise<MyWaterView> {
    return myWaterFromMock(farmerId);
  }

  async raiseRequest(input: RaiseRequestInput): Promise<WaterRequest> {
    const req: WaterRequest = {
      id: `r-local-${Date.now()}`,
      farmer_id: input.farmer_id,
      crop_plan_id: input.crop_plan_id,
      type: input.type,
      volume_m3: input.volume_m3,
      reason: input.reason,
      channel: input.channel,
      status: "raised",
      raised_at: new Date().toISOString(),
    };
    store().unshift(req);
    return req;
  }

  async listRequests(): Promise<WaterRequest[]> {
    return [...store()];
  }
}

type BalancesView = {
  farmers: { farmer_id: string; name: string; quota_m3: number; delivered_m3: number; need_met_pct: number }[];
};

class HttpFarmerApi implements FarmerApi {
  readonly source: DataSource = "live";
  private mock = new MockFarmerApi();

  async listFarmers(): Promise<FarmerDirectoryEntry[]> {
    // GET /api/farmers (contracts routes.listFarmers)
    return fetchJson<FarmerDirectoryEntry[]>("/api/farmers");
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    // POST /api/farmers (contracts routes.register)
    return fetchJson<RegisterResult>("/api/farmers", { method: "POST", body: JSON.stringify(input) });
  }

  async getMyWater(farmerId: string): Promise<MyWaterView> {
    // Contracts v1 exposes no GET route for weekly entitlements or the
    // current roster, so the schedule half of this view comes from the
    // mock until the backend adds it. Ledger balances (quota, delivered,
    // need-met) are live API numbers when reachable.
    const base = myWaterFromMock(farmerId);
    try {
      const ledger = await fetchJson<{ balances: BalancesView }>("/api/ledger");
      const row = ledger.balances.farmers.find((f) => f.farmer_id === farmerId);
      if (!row) return base;
      return { ...base, farmer_name: row.name, delivered_m3: row.delivered_m3, quota_m3: row.quota_m3, need_met_pct: row.need_met_pct };
    } catch {
      return base;
    }
  }

  async raiseRequest(input: RaiseRequestInput): Promise<WaterRequest> {
    // POST /api/requests (contracts routes.raiseRequest)
    return fetchJson<WaterRequest>("/api/requests", { method: "POST", body: JSON.stringify(input) });
  }

  async listRequests(): Promise<WaterRequest[]> {
    // GET /api/requests (contracts routes.listRequests)
    return fetchJson<WaterRequest[]>("/api/requests");
  }

  /** Exposed for per-method fallback in useFarmerApi. */
  fallback(): FarmerApi {
    return this.mock;
  }
}

export type FarmerApiState = { api: FarmerApi; live: boolean };

/**
 * Build an API that prefers the live backend but falls back to the mock
 * per method, so one missing endpoint never blanks the whole portal.
 */
export function createFarmerApi(): FarmerApi {
  const http = new HttpFarmerApi();
  const mock = http.fallback();
  const state: { live: boolean } = { live: true };
  const api: FarmerApi = {
    get source(): DataSource {
      return state.live ? "live" : "mock";
    },
    listFarmers: async () => {
      try {
        return await http.listFarmers();
      } catch {
        state.live = false;
        return mock.listFarmers();
      }
    },
    register: async (input: RegisterInput) => http.register(input).catch(() => mock.register(input)),
    getMyWater: (id: string) => http.getMyWater(id),
    raiseRequest: async (input: RaiseRequestInput) => http.raiseRequest(input).catch(() => mock.raiseRequest(input)),
    listRequests: async () => http.listRequests().catch(() => mock.listRequests()),
  };
  return api;
}

export { scenario };
