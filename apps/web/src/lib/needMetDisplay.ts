/**
 * Presentation helpers for a need-met percentage.
 *
 * The API's `need_met.pct` is the UN-CAPPED planned value for `equal_hours`,
 * so it can exceed 100 (the head of the canal is over-allocated). These helpers
 * are display-only: they clamp a BAR width so it cannot overflow its track and
 * classify an explicit over-allocated state. They NEVER change the number shown.
 */
export const OVER_ALLOCATED_PCT = 100;

export type NeedMetBand = "low" | "mid" | "high" | "over";

/** Bar width as a percentage, clamped to [0, 100] so bars never overflow. */
export function barWidthPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(OVER_ALLOCATED_PCT, pct));
}

/** True when the planned need-met exceeds 100% (over-allocation). */
export function isOverAllocated(pct: number): boolean {
  return Number.isFinite(pct) && pct > OVER_ALLOCATED_PCT;
}

/** Visual band for the bar colour; `over` is the explicit over-allocated state. */
export function needMetBand(pct: number): NeedMetBand {
  if (isOverAllocated(pct)) return "over";
  if (pct < 60) return "low";
  if (pct < 90) return "mid";
  return "high";
}
