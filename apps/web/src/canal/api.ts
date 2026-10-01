// C5 canal hero — data access.
//
// Single rule: every water number shown in the UI comes from the API response
// (or the seed bundle while the Task B backend is not deployed yet). This
// module only fetches, validates shapes loosely, and looks rows up by key.
// No multiplication, division, summation or interpolation of volumes happens
// here or in any component.
//
// NOTE: packages/contracts has no HTTP route for overrunImpact (it is an agent
// tool over packages/core), so overrun answers always come from the seed
// bundle, which mirrors the overrunImpact row shape { outlet_id, lost_m3 }.

import { MOCK_DATA } from "./mock";
import type { CanalVisualData, NeedMetRow, OverrunCase, RosterComparison, RosterMode } from "./types";

export type DataSource = "api" | "mock";

export interface CanalVisualBundle {
  data: CanalVisualData;
  source: DataSource;
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

function isCanalVisualData(v: unknown): v is CanalVisualData {
  const d = v as Partial<CanalVisualData>;
  return (
    !!d &&
    typeof d === "object" &&
    Array.isArray(d.outlets) &&
    Array.isArray(d.flows) &&
    !!d.needMet &&
    Array.isArray(d.needMet.equal_hours) &&
    Array.isArray(d.needMet.equal_water)
  );
}

/**
 * Load the canal hero bundle. Tries the live API first
 * (GET /api/canal, POST /api/rosters/propose per mode) and falls back to the
 * local seed on any failure — the Task B backend has not landed yet.
 */
export async function loadCanalVisual(): Promise<CanalVisualBundle> {
  const t = withTimeout(2000);
  try {
    const [canalRes, hoursRes, waterRes] = await Promise.all([
      fetch("/api/canal", { signal: t.signal }),
      fetch("/api/rosters/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ release_window_id: "demo", mode: "equal_hours" satisfies RosterMode }),
        signal: t.signal,
      }),
      fetch("/api/rosters/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ release_window_id: "demo", mode: "equal_water" satisfies RosterMode }),
        signal: t.signal,
      }),
    ]);
    if (!canalRes.ok || !hoursRes.ok || !waterRes.ok) throw new Error("api not ready");
    const canal = (await canalRes.json()) as {
      canal: CanalVisualData["canal"];
      outlets: CanalVisualData["outlets"];
    };
    const hours = (await hoursRes.json()) as { need_met: NeedMetRow[]; comparison: RosterComparison };
    const water = (await waterRes.json()) as { need_met: NeedMetRow[]; comparison: RosterComparison };
    const merged: CanalVisualData = {
      ...MOCK_DATA,
      canal: canal.canal,
      outlets: canal.outlets,
      needMet: { equal_hours: hours.need_met, equal_water: water.need_met },
      comparison: hours.comparison ?? water.comparison,
    };
    if (!isCanalVisualData(merged)) throw new Error("api shape mismatch");
    // Flows + overrun still come from the seed: no API route serves them yet.
    return { data: merged, source: "api" };
  } catch {
    return { data: MOCK_DATA, source: "mock" };
  } finally {
    t.done();
  }
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
