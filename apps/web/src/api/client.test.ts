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
    expect(approved.approved).toBe(1);
  });

  it("decideRequest flips status and demoAdvance moves time", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const decided = await client.decideRequest("req-mock-1", { decision: "reject", volume_m3: 0 });
    expect(decided.status).toBe("rejected");
    const advanced = await client.demoAdvance({ hours: 6 });
    expect(advanced.now).toBe(new Date(new Date(MOCK_NOW).getTime() + 6 * 3600 * 1000).toISOString());
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
