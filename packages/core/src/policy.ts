import type { Balances } from "./ledger";

export interface Policy {
  /** Urgent request: approved volume is moved from the farmer's future quota. Rejects if quota is insufficient. */
  canGrantUrgent(balances: Balances, farmerId: string, volume_m3: number): { ok: boolean; reason: string };
  /** Buffer request: capped per farmer per week (default 25% of their weekly entitlement, ASSUMED project rule). */
  canGrantBuffer(
    balances: Balances,
    farmerId: string,
    volume_m3: number,
    weeklyEntitlement_m3: number,
    alreadyGrantedThisWeek_m3: number,
  ): { ok: boolean; max_m3: number; reason: string };
}

/**
 * ASSUMED: maximum buffer grant is 25% of the farmer's weekly baseline entitlement per week, to
 * protect the communal reserve. NOT an FAO-56 or statutory figure — a project rule stated in
 * `packages/core/README.md` §10 and in the `Policy` interface doc.
 */
const BUFFER_CAP_RATIO = 0.25;

function round6(val: number): number {
  return Math.round(val * 1e6) / 1e6;
}

/**
 * A volume is only meaningful if it is a finite, positive number.
 *
 * `!(x > 0)` is used deliberately instead of `x <= 0`: NaN compares false against everything, so
 * `NaN <= 0` is false and a plain `<= 0` test lets NaN through. Before this guard,
 * `canGrantBuffer(balances, id, NaN, 100, 0)` returned `{ok: true}` because both the cap check and
 * the balance check (`NaN > cap`) were false. See `docs/research/model-audit.md` F-09.
 */
function isPositiveVolume(val: number): boolean {
  return Number.isFinite(val) && val > 0;
}

export const policy = {
  /**
   * Urgent request: the approved volume is moved from the farmer's own future seasonal quota.
   *
   *   grant  iff  0 < volume_m3 <= balances.farmers[farmerId].quota
   *
   * Units: `volume_m3` and `quota` are both m3, so the comparison is dimensionally trivial.
   *
   * SOURCE: this is a PROJECT POLICY, not a source equation. `packages/core/README.md` §10 states
   * it; `packages/contracts/src/core.ts` documents the signature.
   *
   * Boundaries:
   *  * An unknown `farmerId` has no `farmers` entry, so `quota` reads as 0 and the request is
   *    rejected with "Insufficient future quota". ASSUMED: an unknown farmer is treated as having
   *    no quota rather than raising — the caller is expected to have validated the farmer first.
   *  * `volume_m3 = 0`, negative, or NaN: rejected as non-positive.
   *  * `quota = 0`: rejected, even for a zero-volume request (which is rejected one branch earlier).
   *  * This is a PURE PREDICATE: it does not deduct anything. The deduction happens in the ledger
   *    when the decision is booked. Calling it twice does not reserve twice.
   */
  canGrantUrgent(balances: Balances, farmerId: string, volume_m3: number): { ok: boolean; reason: string } {
    if (!isPositiveVolume(volume_m3)) {
      return { ok: false, reason: "Requested volume must be a finite positive number" };
    }

    const availableQuota = balances.farmers[farmerId]?.quota ?? 0;
    if (availableQuota <= 0 || availableQuota < volume_m3) {
      return {
        ok: false,
        reason: `Insufficient future quota for farmer ${farmerId}: ${availableQuota} m³ available, ${volume_m3} m³ requested`,
      };
    }

    return {
      ok: true,
      reason: `Quota sufficient: ${volume_m3} m³ can be deducted from ${availableQuota} m³ available future quota`,
    };
  },

  /**
   * Buffer request: capped per farmer per week, and further limited by the communal reserve.
   *
   *   weeklyCap    = 0.25 . max(0, weeklyEntitlement_m3)      [m3]   ASSUMED project rule
   *   remainingCap = max(0, weeklyCap - alreadyGrantedThisWeek_m3)
   *   max_m3       = min(remainingCap, max(0, balances.buffer))
   *   grant        iff  0 < volume_m3 <= remainingCap  AND  volume_m3 <= availableBuffer
   *
   * Units: every term is m3; the 0.25 ratio is dimensionless.
   *
   * SOURCE: `BUFFER_CAP_RATIO` is an ASSUMED project rule (README §10). The reserve check is the
   * physical constraint that the common pool must actually hold the water.
   *
   * Boundaries and ordering (these are observable and are pinned by tests):
   *  * `volume_m3` not a finite positive number -> rejected, but `max_m3` still reports the cap.
   *  * `weeklyEntitlement_m3 <= 0` -> `weeklyCap = 0`, so any positive request is rejected with the
   *    cap message. A zero entitlement means the farmer has no weekly basis to borrow against.
   *  * `balances.buffer <= 0` is checked BEFORE the cap check, so an exhausted reserve is reported
   *    as the reason even when the weekly cap is also exhausted. The reserve is the binding
   *    physical constraint, so it is the more useful thing to tell the coordinator.
   *  * `alreadyGrantedThisWeek_m3` above the cap saturates `remainingCap` at 0 (never negative).
   *  * Negative `weeklyEntitlement_m3` or `alreadyGrantedThisWeek_m3` is clamped to 0, so a bad
   *    input cannot INCREASE the cap.
   *  * `max_m3` is returned on EVERY path, including rejections, so a caller can offer a partial
   *    grant without recomputing the limits. On the non-positive-volume path it reports the full
   *    remaining cap rather than 0.
   *  * The function does not deduct from `balances.buffer`; the ledger books the movement.
   */
  canGrantBuffer(
    balances: Balances,
    farmerId: string,
    volume_m3: number,
    weeklyEntitlement_m3: number,
    alreadyGrantedThisWeek_m3: number,
  ): { ok: boolean; max_m3: number; reason: string } {
    const weeklyCap = round6(Math.max(0, weeklyEntitlement_m3) * BUFFER_CAP_RATIO);
    const granted = Math.max(0, alreadyGrantedThisWeek_m3);
    const remainingCap = round6(Math.max(0, weeklyCap - granted));
    const availableBuffer = round6(Math.max(0, balances.buffer));

    const max_m3 = round6(Math.min(remainingCap, availableBuffer));

    if (!isPositiveVolume(volume_m3)) {
      return {
        ok: false,
        max_m3,
        reason: "Requested volume must be a finite positive number",
      };
    }

    if (availableBuffer <= 0) {
      return {
        ok: false,
        max_m3: 0,
        reason: "Common buffer reserve is exhausted (0 m³ available)",
      };
    }

    if (weeklyEntitlement_m3 <= 0 || remainingCap <= 0) {
      return {
        ok: false,
        max_m3: 0,
        reason: `Weekly buffer cap reached or zero entitlement for farmer ${farmerId} (cap: ${weeklyCap} m³, already granted: ${alreadyGrantedThisWeek_m3} m³)`,
      };
    }

    if (volume_m3 > remainingCap) {
      return {
        ok: false,
        max_m3,
        reason: `Requested volume ${volume_m3} m³ exceeds remaining weekly buffer cap (${remainingCap} m³)`,
      };
    }

    if (volume_m3 > availableBuffer) {
      return {
        ok: false,
        max_m3,
        reason: `Requested volume ${volume_m3} m³ exceeds available buffer balance (${availableBuffer} m³)`,
      };
    }

    return {
      ok: true,
      max_m3,
      reason: `Buffer grant approved: ${volume_m3} m³ (max allowable: ${max_m3} m³)`,
    };
  },
} satisfies Policy;
