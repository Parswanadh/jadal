// C5 canal hero: data access through the shared typed API client.
//
// Single rule: every water number shown in the UI comes from the API response
// (or its mock, or the precomputed core results in seed.json). This module only
// fetches and reshapes rows; no multiplication, division, summation or
// interpolation of volumes happens here or in any component.
//
// NOTE: packages/contracts has no HTTP route for hydraulics flows or
// overrunImpact (agent tools over packages/core), so those come from the
// precomputed seed (see mock.ts).

import { api, isMockMode } from "../api";
import { CANAL_SEED } from "./mock";
import type { CanalVisualData, NeedMetRow, OverrunCase, RosterMode } from "./types";

export type DataSource = "api" | "mock";

export interface CanalVisualBundle {
  data: CanalVisualData;
  source: DataSource;
}

/**
 * Load the canal hero bundle: canal + outlets, farmer names and the need-met /
 * Gini comparison from the shared client; flows and overrun answers from the seed.
 */
export async function loadCanalVisual(): Promise<CanalVisualBundle> {
  const [canalRes, farmers, windows] = await Promise.all([api.canal(), api.listFarmers(), api.releaseWindows()]);
  const win = windows[0];
  if (!win) throw new Error("no release window");
  const [hours, water] = await Promise.all([
    api.proposeRoster({ release_window_id: win.id, mode: "equal_hours" }),
    api.proposeRoster({ release_window_id: win.id, mode: "equal_water" }),
  ]);

  const farmerName = new Map(farmers.map((r) => [r.farmer.id, r.farmer.name]));
  const outletFarmer = new Map(farmers.flatMap((r) => r.plots.map((p) => [p.outlet_id, r.farmer.id] as const)));
  const toRows = (rows: { farmer_id: string; outlet_id: string; pct: number }[]): NeedMetRow[] =>
    rows.map((n) => ({
      farmer_id: n.farmer_id,
      outlet_id: n.outlet_id,
      farmer_name: farmerName.get(n.farmer_id) ?? n.farmer_id,
      farmer_name_te: "",
      pct: n.pct,
    }));

  const data: CanalVisualData = {
    canal: {
      id: canalRes.canal.id,
      name: canalRes.canal.name,
      name_te: "",
      length_m: canalRes.canal.length_m,
      head_discharge_m3s: canalRes.canal.head_discharge_m3s,
    },
    outlets: canalRes.outlets.map((o) => {
      const fid = outletFarmer.get(o.id) ?? "";
      return {
        id: o.id,
        canal_id: o.canal_id,
        name: o.name,
        name_te: CANAL_SEED.outlet_name_te[o.id] ?? "",
        chainage_m: o.chainage_m,
        farmer_id: fid,
        farmer_name: farmerName.get(fid) ?? "",
        farmer_name_te: "",
      };
    }),
    flows: CANAL_SEED.flows,
    needMet: { equal_hours: toRows(hours.need_met), equal_water: toRows(water.need_met) },
    comparison: hours.comparison,
    overrunSteps: CANAL_SEED.overrunSteps,
    overrun: CANAL_SEED.overrun,
  };
  return { data, source: isMockMode() ? "mock" : "api" };
}

/** Verbatim rows for one roster mode — no transformation. */
export function getNeedMet(data: CanalVisualData, mode: RosterMode): NeedMetRow[] {
  return data.needMet[mode];
}

/**
 * Exact-key lookup of a precomputed overrunImpact answer.
 * Returns undefined for 0 h (no overrun) and for the tail outlet (nothing
 * downstream). Never interpolates between steps.
 */
export function getOverrunCase(
  data: CanalVisualData,
  outletId: string,
  hours: number,
): OverrunCase | undefined {
  if (hours === 0) return undefined;
  return data.overrun[outletId]?.[String(hours)];
}

/** Display names for an outlet row, kept next to its data (no join logic). */
export function outletById(data: CanalVisualData, outletId: string) {
  return data.outlets.find((o) => o.id === outletId);
}
