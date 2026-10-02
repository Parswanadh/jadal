import { describe, expect, it } from "vitest";
import source from "./AskWater.tsx?raw";

/**
 * Regression guard: raising a water request must never phone a real farmer.
 *
 * `POST /api/alerts` with severity "urgent" renders the night-release warning ("be ready to open your
 * field gate"). This form used to send one the moment an urgent request was raised, so in live mode
 * the farmer's phone rang with what sounded like approved water before the coordinator had decided
 * (seen in the Twilio log: calls to the farmer on requests with no `request.decided` event).
 *
 * The only alert the form may send is the simulated one in mock mode, where there is no telephony.
 */
describe("AskWater does not phone a real farmer", () => {
  it("sends an alert at most once, and only behind the mock-mode guard", () => {
    const calls = [...source.matchAll(/\bsendAlert\(/g)].map((m) => m.index ?? -1);
    expect(calls.length).toBeLessThanOrEqual(1);
    if (calls.length === 0) return;

    const guard = source.indexOf('type === "urgent" && isMockMode()');
    expect(guard).toBeGreaterThan(-1);
    expect(calls[0]).toBeGreaterThan(guard);
    // The guarded block must be the one that holds the call: nothing between the guard and the call
    // may close the `if` early.
    const between = source.slice(guard, calls[0]);
    expect(between.includes("}")).toBe(false);
  });
});
