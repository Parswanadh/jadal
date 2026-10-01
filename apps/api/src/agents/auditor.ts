/**
 * The Auditor agent.
 *
 * `audit` is deterministic and reads only the event log and its projections. `conservation_ok` comes
 * straight from `core-shim`'s `ledger.checkConservation`, never from a re-derivation here. Findings
 * are severity-tagged:
 *
 *   * `critical` — a conservation violation (the declared season supply and the accounted water
 *     disagree beyond tolerance);
 *   * `warn` — a roster shortfall, or a delivery-Gini above the project's fairness threshold;
 *   * `info` — the all-clear line.
 *
 * The two summaries are deterministic templates with no model call, so an audit is reproducible with
 * zero API keys; `summary_te` is natural Telugu script. The return shape is exactly
 * `routes.audit.response`.
 */

import type { Entitlement } from "@jadal/contracts";
import { ledger, round } from "../core-shim";
import { getLedgerEntries, getSeason, listEntitlements, listFarmers, listOutlets, listRosters } from "../db/repo";
import type { ToolEnv } from "./tools";

export type FindingSeverity = "info" | "warn" | "critical";

export interface AuditFinding {
  readonly severity: FindingSeverity;
  readonly text: string;
}

/** Mirrors the (unexported) `BalancesView` in `@jadal/contracts`'s `routes.audit.response`. */
export interface BalancesView {
  readonly canal_supply_m3: number;
  readonly buffer_m3: number;
  readonly conveyance_losses_m3: number;
  readonly farmers: {
    readonly farmer_id: string;
    readonly name: string;
    readonly quota_m3: number;
    readonly delivered_m3: number;
    readonly need_met_pct: number;
  }[];
  readonly conservation_ok: boolean;
  readonly gini: number;
}

export interface AuditReport {
  readonly balances: BalancesView;
  readonly findings: AuditFinding[];
  readonly summary_en: string;
  readonly summary_te: string;
}

/**
 * ASSUMED: a delivery Gini above 0.20 is worth a coordinator's attention. The contract gives no
 * threshold; this is a project policy value, named here rather than hidden in the condition.
 */
export const FAIRNESS_GINI_WARN_THRESHOLD = 0.2;

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return round(Math.min(100, Math.max(0, value)), 2);
}

/** The latest week each farmer has an entitlement for, as `{ week, volume }`. */
function latestNeedByFarmer(entitlements: readonly Entitlement[]): Map<string, number> {
  const latestWeek = new Map<string, string>();
  for (const entitlement of entitlements) {
    const current = latestWeek.get(entitlement.farmer_id);
    if (current === undefined || entitlement.week_start > current) latestWeek.set(entitlement.farmer_id, entitlement.week_start);
  }
  const volume = new Map<string, number>();
  for (const entitlement of entitlements) {
    if (entitlement.week_start !== latestWeek.get(entitlement.farmer_id)) continue;
    volume.set(entitlement.farmer_id, (volume.get(entitlement.farmer_id) ?? 0) + entitlement.volume_m3);
  }
  return volume;
}

/**
 * Produce the fairness and conservation report. Reads only; appends nothing.
 */
export async function audit(env: ToolEnv): Promise<AuditReport> {
  const entries = await getLedgerEntries(env);
  const raw = ledger.balances(entries);

  const outlets = await listOutlets(env);
  const canalId = outlets[0]?.canal_id;
  const season = canalId === undefined ? null : await getSeason(env, canalId);
  const seasonSupply = season?.season_supply_m3 ?? raw.canal_supply;
  const conservation = ledger.checkConservation(entries, seasonSupply, season?.tolerance_m3);

  const farmers = await listFarmers(env);
  const nameOf = new Map(farmers.map((record) => [record.farmer.id, record.farmer.name]));
  const needOf = latestNeedByFarmer(await listEntitlements(env));

  const farmerIds = new Set<string>([...Object.keys(raw.farmers), ...needOf.keys()]);
  const farmerViews: BalancesView["farmers"] = [];
  const needMetPct: number[] = [];
  for (const farmer_id of [...farmerIds].sort()) {
    const balance = raw.farmers[farmer_id] ?? { quota: 0, delivered: 0 };
    const need = needOf.get(farmer_id) ?? 0;
    const pct = need > 0 ? clampPct((100 * balance.delivered) / need) : balance.delivered > 0 ? 100 : 100;
    needMetPct.push(pct);
    farmerViews.push({
      farmer_id,
      name: nameOf.get(farmer_id) ?? farmer_id,
      quota_m3: round(balance.quota),
      delivered_m3: round(balance.delivered),
      need_met_pct: pct,
    });
  }

  const gini = ledger.gini(needMetPct);

  const findings: AuditFinding[] = [];
  if (!conservation.ok) {
    findings.push({
      severity: "critical",
      text: `Conservation violated: declared season supply ${round(seasonSupply)} m³ but the ledger accounts for ${round(seasonSupply - conservation.diff_m3)} m³ (gap ${round(conservation.diff_m3)} m³).`,
    });
  }

  const rosters = await listRosters(env);
  let shortfall_m3 = 0;
  for (const roster of rosters) {
    for (const volume of Object.values(roster.shortfall_m3)) shortfall_m3 += volume;
  }
  if (shortfall_m3 > 0) {
    findings.push({
      severity: "warn",
      text: `Roster shortfall: ${round(shortfall_m3)} m³ of need could not be scheduled inside its release window.`,
    });
  }

  if (gini > FAIRNESS_GINI_WARN_THRESHOLD) {
    findings.push({
      severity: "warn",
      text: `Delivery is uneven: need-met Gini ${gini} exceeds the fairness threshold ${FAIRNESS_GINI_WARN_THRESHOLD}.`,
    });
  }

  if (findings.length === 0) {
    findings.push({ severity: "info", text: "No conservation or fairness issues found." });
  }

  const conservationWord = conservation.ok ? "OK" : "FAILING";
  const summary_en =
    `Jadal audit: conservation ${conservationWord}. Canal supply ${round(seasonSupply)} m³, ` +
    `buffer ${round(raw.buffer)} m³, conveyance losses ${round(raw.conveyance_losses)} m³, ` +
    `need-met Gini ${gini}, ${farmerViews.length} farmer(s) tracked, ${findings.length} finding(s).`;

  const summary_te =
    `జడల్ ఆడిట్ నివేదిక: నీటి లెక్కింపు ${conservation.ok ? "సరిగ్గా ఉంది" : "పొరపాటుగా ఉంది"}. ` +
    `కాలువ నుండి ${round(seasonSupply)} ఘన మీటర్లు విడుదలయ్యాయి. ` +
    `బఫర్‌లో ${round(raw.buffer)} ఘన మీటర్లు ఉన్నాయి. ` +
    `కాలువలో ${round(raw.conveyance_losses)} ఘన మీటర్లు ఇంకిపోయాయి. ` +
    `రైతుల మధ్య పంపిణీ అసమానత ${gini}. ` +
    `${farmerViews.length} మంది రైతులు, ${findings.length} అంశాలు పరిశీలించబడ్డాయి.`;

  return {
    balances: {
      canal_supply_m3: round(raw.canal_supply),
      buffer_m3: round(raw.buffer),
      conveyance_losses_m3: round(raw.conveyance_losses),
      farmers: farmerViews,
      conservation_ok: conservation.ok,
      gini,
    },
    findings,
    summary_en,
    summary_te,
  };
}
