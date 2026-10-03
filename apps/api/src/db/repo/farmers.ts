/**
 * Farmer, plot and crop-plan queries.
 *
 * `FarmerRecord` carries the registration facts (`verified`) beside the contract `Farmer`, because
 * the portal needs both in one call and the contract has no place for a registration flag.
 */

import { Channel, CropPlan, Farmer, Plot } from "@jadal/contracts/entities";
import { resultRows, type DbEnv } from "../store";
import { emptyWhere, inList, toBool, withOptional } from "./shared";

/**
 * One entry of `routes.listFarmers.response`.
 *
 * `verified` is not on the contract's `Farmer` — it is a fact about the *registration*, not the
 * person — so it travels beside the farmer rather than inside it. The portal needs both in one call.
 */
export interface FarmerRecord {
  readonly farmer: Farmer;
  readonly plots: Plot[];
  readonly crop_plans: CropPlan[];
  readonly verified: boolean;
}

interface FarmerRow {
  id: string;
  name: string;
  phone: string;
  language: string;
  preferred_channels: string;
  has_smartphone: number;
  verified: number;
  registered_at: string;
}

interface PlotRow {
  id: string;
  farmer_id: string;
  outlet_id: string;
  area_ha: number;
  soil: string;
  lat: number;
  lon: number;
}

interface CropPlanRow {
  id: string;
  plot_id: string;
  crop: string;
  sowing_date: string;
  area_fraction: number;
  application_efficiency: number;
  rice_practice: string | null;
  status: string;
}

/**
 * `farmer` table row → contract `Farmer`.
 *
 * `verified` and `registered_at` are deliberately *not* included: they are registration facts, not
 * person facts, and `Farmer` has no place for them. `FarmerRecord` carries them alongside.
 *
 * The parse is not decoration — `preferred_channels` comes out of a JSON column, so it is the one
 * place a projection bug (a bad enum written by an agent) becomes a typed error here rather than an
 * unvalidated string reaching a route.
 */
function toFarmer(row: FarmerRow): Farmer {
  const channels: unknown = JSON.parse(row.preferred_channels);
  return Farmer.parse({
    id: row.id,
    name: row.name,
    phone: row.phone,
    language: row.language,
    preferred_channels: Channel.array().parse(channels),
    has_smartphone: toBool(row.has_smartphone),
  });
}

function toPlot(row: PlotRow): Plot {
  return Plot.parse({
    id: row.id,
    farmer_id: row.farmer_id,
    outlet_id: row.outlet_id,
    area_ha: row.area_ha,
    soil: row.soil,
    lat: row.lat,
    lon: row.lon,
  });
}

function toCropPlan(row: CropPlanRow): CropPlan {
  return CropPlan.parse(
    withOptional(
      {
        id: row.id,
        plot_id: row.plot_id,
        crop: row.crop,
        sowing_date: row.sowing_date,
        area_fraction: row.area_fraction,
        application_efficiency: row.application_efficiency,
        status: row.status,
      },
      "rice_practice",
      row.rice_practice,
    ),
  );
}

/**
 * Every registered farmer, with their plots and crop plans, ordered by name.
 *
 * Name rather than id because every screen that lists farmers is read by a human looking for a person.
 * `id` is the tiebreak so two farmers sharing a name still order deterministically.
 *
 * The three tables are fetched with three queries rather than one joined query on purpose: a join
 * would fan out to one row per (plot × crop_plan) combination and the grouping would then have to be
 * reassembled anyway. Three flat reads plus an in-memory fold is both easier to reason about and the
 * same number of round trips.
 */
export async function listFarmers(env: DbEnv): Promise<FarmerRecord[]> {
  const farmerRows = resultRows(
    await env.DB.prepare("SELECT * FROM farmer ORDER BY name ASC, id ASC").all<FarmerRow>(),
  );
  if (farmerRows.length === 0) return [];

  const ids = farmerRows.map((row) => row.id);
  const plotWhere = inList(emptyWhere(), "farmer_id", ids);
  const plotRows = resultRows(
    await env.DB.prepare(`SELECT * FROM plot${plotWhere.sql} ORDER BY farmer_id ASC, id ASC`)
      .bind(...plotWhere.bindings)
      .all<PlotRow>(),
  );

  // Crop plans hang off plots, so the plot ids — not the farmer ids — are what filters them.
  const plotIds = plotRows.map((row) => row.id);
  const planWhere = inList(emptyWhere(), "plot_id", plotIds);
  const planRows = resultRows(
    await env.DB.prepare(`SELECT * FROM crop_plan${planWhere.sql} ORDER BY plot_id ASC, id ASC`)
      .bind(...planWhere.bindings)
      .all<CropPlanRow>(),
  );

  const plotsByFarmer = new Map<string, Plot[]>();
  for (const row of plotRows) {
    const bucket = plotsByFarmer.get(row.farmer_id) ?? [];
    bucket.push(toPlot(row));
    plotsByFarmer.set(row.farmer_id, bucket);
  }

  const plansByFarmer = new Map<string, CropPlan[]>();
  const farmerOfPlot = new Map<string, string>();
  for (const row of plotRows) farmerOfPlot.set(row.id, row.farmer_id);
  for (const row of planRows) {
    const farmer_id = farmerOfPlot.get(row.plot_id);
    if (farmer_id === undefined) continue;
    const bucket = plansByFarmer.get(farmer_id) ?? [];
    bucket.push(toCropPlan(row));
    plansByFarmer.set(farmer_id, bucket);
  }

  return farmerRows.map((row) => ({
    farmer: toFarmer(row),
    plots: plotsByFarmer.get(row.id) ?? [],
    crop_plans: plansByFarmer.get(row.id) ?? [],
    verified: toBool(row.verified),
  }));
}

/** One farmer with their plots and crop plans, or `null` when the id is unknown. */
export async function getFarmer(env: DbEnv, farmerId: string): Promise<FarmerRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM farmer WHERE id = ?").bind(farmerId).first<FarmerRow>();
  if (row === null) return null;

  const plotRows = resultRows(
    await env.DB.prepare("SELECT * FROM plot WHERE farmer_id = ? ORDER BY id ASC")
      .bind(farmerId)
      .all<PlotRow>(),
  );
  const planRows = resultRows(
    await env.DB.prepare(
      `SELECT cp.* FROM crop_plan cp
       JOIN plot p ON p.id = cp.plot_id
       WHERE p.farmer_id = ?
       ORDER BY cp.id ASC`,
    )
      .bind(farmerId)
      .all<CropPlanRow>(),
  );

  return {
    farmer: toFarmer(row),
    plots: plotRows.map(toPlot),
    crop_plans: planRows.map(toCropPlan),
    verified: toBool(row.verified),
  };
}

/**
 * Crop plans that have cleared verification, ordered by sowing date then id.
 *
 * "Verified" means the *plan* passed the coordinator's field check, so the filter is
 * `status IN ('verified','active')` — a plan that is verified and running is still verified, and
 * excluding `active` would hide most of the season from the portal's verification view. `harvested`
 * is excluded: that is a terminal state, not a pending verification.
 *
 * Ordered by sowing date because the verification queue is worked oldest-crop-first, matching the
 * order the coordinator registered them in.
 */
export async function listVerifiedCropPlans(env: DbEnv, farmerId?: string): Promise<CropPlan[]> {
  const clauses = ["cp.status IN ('verified','active')"];
  const bindings: unknown[] = [];
  if (farmerId !== undefined) {
    clauses.push("p.farmer_id = ?");
    bindings.push(farmerId);
  }
  const rows = resultRows(
    await env.DB.prepare(
      `SELECT cp.* FROM crop_plan cp
       JOIN plot p ON p.id = cp.plot_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY cp.sowing_date ASC, cp.id ASC`,
    )
      .bind(...bindings)
      .all<CropPlanRow>(),
  );
  return rows.map(toCropPlan);
}
