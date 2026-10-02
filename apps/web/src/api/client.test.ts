// Every mock response must parse with its contract schema (Task C2).
// Runs the client in mock mode (VITE_MOCK=1) and validates each response
// against routes[key].response from packages/contracts/src/api.ts.

import { describe, expect, it, vi, afterEach } from "vitest";
import { routes } from "@jadal/contracts";
import type { z } from "zod";
import * as client from "./client";
import { MOCK_NOW } from "./mock";

type RouteKey = keyof typeof routes;

afterEach(() => {
  vi.unstubAllEnvs();
});

const registerBody: z.input<typeof routes.register.body> = {
  farmer: {
    name: "Test Farmer",
    phone: "+919000000099",
    language: "te",
    preferred_channels: ["voice"],
    has_smartphone: false,
  },
  plots: [{ outlet_id: "o1", area_ha: 1, soil: "loam", lat: 16.3, lon: 80.44 }],
  crop_plans: [
    { plot_index: 0, crop: "rice", sowing_date: "2026-07-10", area_fraction: 1, application_efficiency: 0.8 },
  ],
};

// One invocation per routes entry. Each thunk calls the same-named client
// function, so this table also pins "one function per route".
const calls: Record<RouteKey, () => Promise<unknown>> = {
  health: () => client.health(),
  canal: () => client.canal(),
  register: () => client.register(registerBody),
  listFarmers: () => client.listFarmers(),
  verifyFarmer: () => client.verifyFarmer("f1"),
  suggestEntitlements: () => client.suggestEntitlements({}),
  approveEntitlements: () => client.approveEntitlements({ edits: [{ id: "e-cp1-2026-09-14", volume_m3: 500 }] }),
  releaseWindows: () => client.releaseWindows(),
  proposeRoster: () => client.proposeRoster({ release_window_id: "rw1", mode: "equal_water" }),
  approveRoster: () => client.approveRoster("r-rw1-equal_water"),
  raiseRequest: () =>
    client.raiseRequest({ farmer_id: "f1", type: "urgent", volume_m3: 200, reason: "test", channel: "voice" }),
  listRequests: () => client.listRequests(),
  decideRequest: () => client.decideRequest("req-mock-1", { decision: "approve", volume_m3: 150 }),
  ledger: () => client.ledger(),
  events: () => client.events(),
  contacts: () => client.contacts(),
  phoneReply: () => client.phoneReply("ct-f1", { text: "సరే" }),
  intake: () => client.intake({ farmer_id: "f1", text: "నీరు కావాలి" }),
  audit: () => client.audit(),
  demoReset: () => client.demoReset(),
  demoAdvance: () => client.demoAdvance({ hours: 6 }),
};

describe("api client covers every contract route", () => {
  it("exposes one function per entry in routes", () => {
    for (const key of Object.keys(routes) as RouteKey[]) {
      expect(typeof (client as Record<string, unknown>)[key], key).toBe("function");
    }
  });

  it("api object is keyed exactly by route name", () => {
    expect(Object.keys(client.api).sort()).toEqual(Object.keys(routes).sort());
  });
});

describe("mock responses validate against contract schemas", () => {
  for (const key of Object.keys(routes) as RouteKey[]) {
    it(`${key} mock response parses`, async () => {
      vi.stubEnv("VITE_MOCK", "1");
      const res = await calls[key]();
      const parsed = (routes[key].response as z.ZodTypeAny).safeParse(res);
      expect(parsed.success, key).toBe(true);
    });
  }
});

describe("mock mode switching", () => {
  it("is mock by default and when VITE_MOCK=1", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    expect(client.isMockMode()).toBe(true);
    expect((await client.health()).version).toBe("0.1.0-mock");
  });

  it("VITE_MOCK=0 selects the real API", () => {
    vi.stubEnv("VITE_MOCK", "0");
    expect(client.isMockMode()).toBe(false);
  });
});

describe("mock builders echo caller input", () => {
  it("register links generated ids", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const res = await client.register(registerBody);
    expect(res.farmer.name).toBe("Test Farmer");
    expect(res.plots[0]?.farmer_id).toBe(res.farmer.id);
    expect(res.crop_plans[0]?.plot_id).toBe(res.plots[0]?.id);
  });

  it("suggest honours week_start and approve counts edits", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const suggested = await client.suggestEntitlements({ week_start: "2026-09-21" });
    expect(suggested.entitlements[0]?.week_start).toBe("2026-09-21");
    expect(suggested.season_total_m3).toBeGreaterThan(0);
    const approved = await client.approveEntitlements({ edits: [{ id: "e-x", volume_m3: 10 }] });
    expect(approved.approved).toBe(suggested.entitlements.length);
  });

  it("decideRequest flips status and demoAdvance moves time", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const decided = await client.decideRequest("req-mock-1", { decision: "reject", volume_m3: 0 });
    expect(decided.status).toBe("rejected");
    await client.demoReset();
    const advanced = await client.demoAdvance({ hours: 6 });
    expect(advanced.now).toBe(new Date(new Date(MOCK_NOW).getTime() + 6 * 3600 * 1000).toISOString());
    // The clock keeps going from where it was, and reset puts it back.
    const later = await client.demoAdvance({ hours: 2 });
    expect(later.now).toBe(new Date(new Date(MOCK_NOW).getTime() + 8 * 3600 * 1000).toISOString());
    await client.demoReset();
    expect((await client.demoAdvance({ hours: 1 })).now).toBe(new Date(new Date(MOCK_NOW).getTime() + 3600 * 1000).toISOString());
  });

  it("equal_water meets every outlet above 90%", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const res = await client.proposeRoster({ release_window_id: "rw1" });
    expect(res.roster.turns).toHaveLength(8);
    for (const n of res.need_met) expect(n.pct).toBeGreaterThan(90);
  });

  it("ledger and audit balances conserve the season supply", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const { balances } = await client.ledger();
    const quotaSum = balances.farmers.reduce((s, f) => s + f.quota_m3, 0);
    expect(balances.canal_supply_m3).toBe(quotaSum + balances.buffer_m3 + balances.conveyance_losses_m3);
    expect(balances.conservation_ok).toBe(true);
  });
});

// The two coordinator-tool endpoints are outside the frozen contract, so they
// are pinned here rather than by the per-route loop above.
describe("coordinator tool endpoints (mock mode)", () => {
  it("saves a turn time and re-applies it to the next proposal", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    await client.demoReset();
    const before = await client.proposeRoster({ release_window_id: "rw1", mode: "equal_water" });
    const turn = before.roster.turns[0];
    expect(turn).toBeDefined();
    const start = "2026-09-15T01:00:00.000Z";
    const end = "2026-09-15T04:00:00.000Z";
    const res = await client.updateTurn(before.roster.id, turn?.id ?? "", { start, end });
    expect(res.ok).toBe(true);
    expect(res.turn).toMatchObject({ start, end });
    const after = await client.proposeRoster({ release_window_id: "rw1", mode: "equal_water" });
    expect(after.roster.turns.find((t) => t.id === turn?.id)).toMatchObject({ start, end });
  });

  it("rejects a backwards pair, an unknown turn and an unknown schedule", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    await client.demoReset();
    const good = { start: "2026-09-15T01:00:00.000Z", end: "2026-09-15T04:00:00.000Z" };
    await expect(
      client.updateTurn("r-rw1-equal_water", "t-rw1-o1", { start: good.end, end: good.start }),
    ).rejects.toMatchObject({ status: 400, code: "backwards_times" });
    await expect(client.updateTurn("r-rw1-equal_water", "no-such-turn", good)).rejects.toMatchObject({
      status: 404,
      code: "turn_not_found",
    });
    await expect(client.updateTurn("r-nope-equal_water", "t-rw1-o1", good)).rejects.toMatchObject({
      status: 404,
      code: "roster_not_found",
    });
  });

  it("records a turn change in the audit", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    await client.demoReset();
    expect((await client.audit()).findings.some((f) => /changed by the coordinator/i.test(f.text))).toBe(false);
    await client.updateTurn("r-rw1-equal_water", "t-rw1-o1", {
      start: "2026-09-15T01:00:00.000Z",
      end: "2026-09-15T04:00:00.000Z",
    });
    expect((await client.audit()).findings.some((f) => /changed by the coordinator/i.test(f.text))).toBe(true);
  });

  it("sends an alert and reports simulated mode", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const res = await client.sendAlert({ farmer_id: "f1", channel: "whatsapp", message: "Please check your turn." });
    expect(res.ok).toBe(true);
    expect(res.simulated).toBe(true);
    expect(res.contact_id).toBeTruthy();
    expect(res.detail).toBeTruthy();
  });

  it("rejects an alert for a farmer it does not know", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    await expect(client.sendAlert({ farmer_id: "no-such-farmer", channel: "call" })).rejects.toMatchObject({
      status: 404,
    });
  });
});
