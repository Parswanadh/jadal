/**
 * Policy rules: may this request be approved? Implements `Policy` from `@jadal/contracts/core`.
 *
 * These are the only two places in the system where a *person's* decision is turned into a number,
 * so both rules answer with a reason a coordinator can read aloud over the phone. They are pure
 * functions over `Balances` — the balances are derived from the ledger, and the decision that
 * follows is recorded as a ledger entry, so policy never holds state of its own.
 *
 *  * `canGrantUrgent` — an urgent grant is *borrowed from the farmer's own future*: the approved
 *    volume is debited from quota they have not yet used. So the only question is whether the
 *    remaining undelivered quota (`quota − delivered`) covers it.
 *  * `canGrantBuffer` — a buffer grant is extra water from the canal's own reserve, so it is capped
 *    twice: by the farmer's weekly share of the buffer and by what is actually in the buffer.
 */

import type { Balances, Policy } from "@jadal/contracts";

import { round } from "./units";

/** Decimals used for the reported `max_m3`; 0.001 m³ is a millimetre of water over one hectare. */
const M3_DECIMALS = 3;
/** Float slack when comparing a requested volume against a cap, in m³. */
const EPSILON = 1e-6;

/**
 * Maximum buffer water one farmer may be granted in a week, as a fraction of their weekly
 * entitlement.
 *
 * ASSUMED: 25% of the weekly entitlement. The contract states this as the default project rule and
 * gives no source for it, so it lives here as one named constant rather than as a literal scattered
 * through the approval path. It is a *community reserve* cap: buffer water is water some other
 * farmer is not using, so a farmer may top up a bad week but not water a second crop with it.
 */
export const BUFFER_WEEKLY_CAP_FRACTION = 0.25;

function balanceOf(balances: Balances, farmerId: string): { quota: number; delivered: number } {
  return balances.farmers[farmerId] ?? { quota: 0, delivered: 0 };
}

function isGrantable(volume_m3: number, available_m3: number): boolean {
  return volume_m3 > 0 && volume_m3 <= available_m3 + EPSILON;
}

export const policy: Policy = {
  canGrantUrgent(balances: Balances, farmerId: string, volume_m3: number) {
    const farmer = balanceOf(balances, farmerId);
    // Water already in the field is not re-grantable: the check is against what is still to come.
    const undelivered = round(farmer.quota - farmer.delivered, M3_DECIMALS);

    if (!(volume_m3 > 0)) {
      return { ok: false, reason: "an urgent grant must be for a positive volume" };
    }
    if (!(undelivered > 0)) {
      return {
        ok: false,
        reason: `${farmerId} has no undelivered quota left (quota ${round(farmer.quota, M3_DECIMALS)} m³, already delivered ${round(farmer.delivered, M3_DECIMALS)} m³), so there is nothing to bring forward`,
      };
    }
    if (!isGrantable(volume_m3, undelivered)) {
      return {
        ok: false,
        reason: `${farmerId} asked for ${round(volume_m3, M3_DECIMALS)} m³ of extra water but only ${undelivered} m³ of undelivered quota is left, so the rest would have to come from the buffer — that is a buffer request, not an urgent one`,
      };
    }
    return {
      ok: true,
      reason: `${farmerId} can take ${round(volume_m3, M3_DECIMALS)} m³ now from their own future quota (${undelivered} m³ still undelivered)`,
    };
  },

  canGrantBuffer(
    balances: Balances,
    farmerId: string,
    volume_m3: number,
    weeklyEntitlement_m3: number,
    alreadyGrantedThisWeek_m3: number,
  ) {
    const entitlement = Number.isFinite(weeklyEntitlement_m3) ? Math.max(0, weeklyEntitlement_m3) : 0;
    const granted = Number.isFinite(alreadyGrantedThisWeek_m3) ? Math.max(0, alreadyGrantedThisWeek_m3) : 0;
    const bufferAvailable = Number.isFinite(balances.buffer) ? Math.max(0, balances.buffer) : 0;

    // The weekly cap is the binding rule; what is physically in the buffer can only lower it.
    const weeklyCap = round(entitlement * BUFFER_WEEKLY_CAP_FRACTION, M3_DECIMALS);
    const weeklyLeft = round(Math.max(0, weeklyCap - granted), M3_DECIMALS);
    const max_m3 = round(Math.min(weeklyLeft, bufferAvailable), M3_DECIMALS);

    if (!(volume_m3 > 0)) {
      return { ok: false, max_m3, reason: "a buffer grant must be for a positive volume" };
    }
    if (!(weeklyCap > 0)) {
      return {
        ok: false,
        max_m3: 0,
        reason: `${farmerId} has no weekly entitlement recorded (${round(entitlement, M3_DECIMALS)} m³), so no buffer cap can be derived`,
      };
    }
    if (!(bufferAvailable > 0)) {
      return {
        ok: false,
        max_m3: 0,
        reason: "the canal buffer is empty, so there is no community water to grant this week",
      };
    }
    if (isGrantable(volume_m3, max_m3)) {
      return {
        ok: true,
        max_m3,
        reason: `${farmerId} can take up to ${max_m3} m³ from the buffer this week (cap ${weeklyCap} m³ = ${Math.round(BUFFER_WEEKLY_CAP_FRACTION * 100)}% of ${round(entitlement, M3_DECIMALS)} m³, ${granted} m³ already granted, ${bufferAvailable} m³ in the buffer)`,
      };
    }
    if (!(volume_m3 <= weeklyLeft + EPSILON)) {
      return {
        ok: false,
        max_m3,
        reason: `${farmerId} asked for ${round(volume_m3, M3_DECIMALS)} m³ of buffer water, over the ${BUFFER_WEEKLY_CAP_FRACTION * 100}% weekly cap of ${weeklyCap} m³ (${granted} m³ already granted this week)`,
      };
    }
    return {
      ok: false,
      max_m3,
      reason: `${farmerId} asked for ${round(volume_m3, M3_DECIMALS)} m³ of buffer water but the buffer only holds ${bufferAvailable} m³`,
    };
  },
};
