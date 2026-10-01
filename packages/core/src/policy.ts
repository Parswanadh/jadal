import type { Balances, Policy } from "@jadal/contracts";

export class JadalPolicy implements Policy {
  /**
   * Evaluates an urgent water request.
   * Urgent water is deducted from the farmer's remaining future seasonal quota.
   * Rejects if remaining quota is insufficient.
   */
  canGrantUrgent(
    balances: Balances,
    farmerId: string,
    volume_m3: number
  ): { ok: boolean; reason: string } {
    if (volume_m3 <= 0) {
      return { ok: false, reason: "Requested volume must be positive" };
    }

    const farmer = balances.farmers[farmerId];
    const remainingQuota = farmer ? farmer.quota : 0;

    if (remainingQuota < volume_m3) {
      return {
        ok: false,
        reason: `Insufficient future quota: requested ${volume_m3} m³, but farmer ${farmerId} has only ${remainingQuota} m³ remaining`,
      };
    }

    return {
      ok: true,
      reason: `Approved: ${volume_m3} m³ will be deducted from farmer ${farmerId}'s future quota`,
    };
  }

  /**
   * Evaluates a request to draw water from the common buffer pool.
   * Enforces:
   * 1. Per-farmer weekly cap: ASSUMED project rule of 25% of weekly entitlement.
   * 2. Physical availability in the common buffer pool.
   */
  canGrantBuffer(
    balances: Balances,
    farmerId: string,
    volume_m3: number,
    weeklyEntitlement_m3: number,
    alreadyGrantedThisWeek_m3: number
  ): { ok: boolean; max_m3: number; reason: string } {
    if (volume_m3 <= 0) {
      return { ok: false, max_m3: 0, reason: "Requested volume must be positive" };
    }

    // ASSUMED project rule: buffer request capped at 25% of weekly entitlement per farmer per week
    const weeklyCap = 0.25 * weeklyEntitlement_m3;
    const remainingFarmerCap = Math.max(0, weeklyCap - alreadyGrantedThisWeek_m3);
    const availableBuffer = Math.max(0, balances.buffer);

    const max_m3 = Math.min(remainingFarmerCap, availableBuffer);

    if (availableBuffer <= 0) {
      return {
        ok: false,
        max_m3: 0,
        reason: "Common buffer pool is depleted",
      };
    }

    if (remainingFarmerCap <= 0) {
      return {
        ok: false,
        max_m3: 0,
        reason: `Weekly buffer cap reached: farmer ${farmerId} has already used their weekly limit of ${weeklyCap} m³ (25% of entitlement)`,
      };
    }

    if (volume_m3 > max_m3) {
      return {
        ok: false,
        max_m3,
        reason: `Requested volume (${volume_m3} m³) exceeds maximum grantable volume (${max_m3} m³) based on weekly cap and available buffer`,
      };
    }

    return {
      ok: true,
      max_m3,
      reason: `Approved: ${volume_m3} m³ granted from common buffer pool`,
    };
  }
}

export const policy = new JadalPolicy();
