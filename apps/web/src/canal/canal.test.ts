import { describe, expect, it } from "vitest";
import scenario from "@jadal/contracts/fixtures/demo-scenario.json";
import { getNeedMet, getOverrunCase, loadCanalVisual } from "./api";
import { CANAL_SEED } from "./mock";
import { STR } from "./strings";

const fixtureOutletIds = (scenario as { outlets: { id: string }[] }).outlets.map((o) => o.id);

describe("canal seed (precomputed core results)", () => {
  it("covers exactly the fixture outlets, head to tail", () => {
    expect(CANAL_SEED.flows.map((f) => f.outlet_id)).toEqual(fixtureOutletIds);
    expect(Object.keys(CANAL_SEED.outlet_name_te)).toEqual(fixtureOutletIds);
  });

  it("flows shrink head to tail", () => {
    const q = CANAL_SEED.flows.map((f) => f.flow_m3s);
    for (let i = 1; i < q.length; i++) expect(q[i]).toBeLessThan(q[i - 1] ?? 0);
  });

  it("has overrun answers for every non-tail outlet, growing with hours, totals equal parts", () => {
    expect(Object.keys(CANAL_SEED.overrun).sort()).toEqual(fixtureOutletIds.slice(0, -1).sort());
    for (const cases of Object.values(CANAL_SEED.overrun)) {
      let prev = -1;
      for (const h of ["0.5", "1", "2"]) {
        const c = cases[h];
        expect(c).toBeDefined();
        if (!c) continue;
        expect(c.total_lost_m3).toBeGreaterThan(prev);
        prev = c.total_lost_m3;
        expect(c.losses.reduce((a, [, l]) => a + l, 0)).toBe(c.total_lost_m3);
      }
    }
  });
});

describe("loadCanalVisual (mock mode)", () => {
  it("builds the page bundle from the shared client", async () => {
    const { data, source } = await loadCanalVisual();
    expect(source).toBe("mock");
    expect(data.outlets.map((o) => o.id)).toEqual(fixtureOutletIds);
    expect(getNeedMet(data, "equal_hours")).toHaveLength(fixtureOutletIds.length);
    expect(getNeedMet(data, "equal_water")[0]?.farmer_name).toBeTruthy();
    expect(data.comparison.equal_water_gini).toBeLessThan(data.comparison.equal_hours_gini);
  });

  it("looks up overrun rows by exact key", async () => {
    const { data } = await loadCanalVisual();
    expect(getOverrunCase(data, "o1", 0)).toBeUndefined();
    expect(getOverrunCase(data, "o1", 1)?.total_lost_m3).toBeGreaterThan(0);
    expect(getOverrunCase(data, "o8", 1)).toBeUndefined();
  });
});

describe("canal strings", () => {
  it("has the same keys in English and Telugu", () => {
    expect(Object.keys(STR.te).sort()).toEqual(Object.keys(STR.en).sort());
  });
});
