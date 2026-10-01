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

// ASSUMED: Maximum buffer grant is 25% of the farmer's weekly baseline entitlement per week to protect communal reserves.
const BUFFER_CAP_RATIO = 0.25;

function round6(val: number): number {
  return Math.round(val * 1e6) / 1e6;
}

export const policy = {
  canGrantUrgent(balances: Balances, farmerId: string, volume_m3: number): { ok: boolean; reason: string } {
    if (volume_m3 <= 0) {
      return { ok: false, reason: "Requested volume must be positive" };
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

    if (volume_m3 <= 0) {
      return {
        ok: false,
        max_m3,
        reason: "Requested volume must be positive",
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
