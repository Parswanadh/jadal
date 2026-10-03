/**
 * Canal and outlet queries.
 *
 * The canal's physical parameters and the outlets along it. These are the physical facts the
 * hydraulics engine and the scheduler read; nothing here is derived.
 */

import { Canal, Outlet } from "@jadal/contracts/entities";
import { resultRows, type DbEnv } from "../store";
import { emptyWhere, eq, toBool } from "./shared";

interface CanalRow {
  id: string;
  name: string;
  length_m: number;
  head_discharge_m3s: number;
  seepage_k_per_m: number;
  manning_n: number;
  bed_slope: number;
  hydraulic_radius_m: number;
  lined: number;
}

interface OutletRow {
  id: string;
  canal_id: string;
  name: string;
  chainage_m: number;
}

function toCanal(row: CanalRow): Canal {
  return Canal.parse({
    id: row.id,
    name: row.name,
    length_m: row.length_m,
    head_discharge_m3s: row.head_discharge_m3s,
    seepage_k_per_m: row.seepage_k_per_m,
    manning_n: row.manning_n,
    bed_slope: row.bed_slope,
    hydraulic_radius_m: row.hydraulic_radius_m,
    lined: toBool(row.lined),
  });
}

function toOutlet(row: OutletRow): Outlet {
  return Outlet.parse({
    id: row.id,
    canal_id: row.canal_id,
    name: row.name,
    chainage_m: row.chainage_m,
  });
}

/** The canal's physical parameters, or `null` when no such canal exists. */
export async function getCanal(env: DbEnv, canalId: string): Promise<Canal | null> {
  const row = await env.DB.prepare("SELECT * FROM canal WHERE id = ?").bind(canalId).first<CanalRow>();
  return row === null ? null : toCanal(row);
}

/**
 * Outlets on a canal, head to tail.
 *
 * `chainage_m` is the physical ordering — warabandi is sequenced by distance from the head, so this
 * is the order the portal and the caller agent render. `id` breaks ties so two outlets at the same
 * chainage still have a total order.
 */
export async function listOutlets(env: DbEnv, canalId?: string): Promise<Outlet[]> {
  const where = eq(emptyWhere(), "canal_id", canalId);
  const rows = resultRows(
    await env.DB.prepare(`SELECT * FROM outlet${where.sql} ORDER BY chainage_m ASC, id ASC`)
      .bind(...where.bindings)
      .all<OutletRow>(),
  );
  return rows.map(toOutlet);
}
