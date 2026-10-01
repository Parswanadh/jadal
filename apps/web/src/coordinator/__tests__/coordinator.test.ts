import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { conservationHolds, giniOf, mock } from "../mock.ts";
import { strings } from "../i18n.ts";

describe("giniOf", () => {
  it("is 0 for perfectly equal values", () => {
    assert.equal(giniOf([90, 90, 90, 90]), 0);
  });
  it("is higher for unequal than equal distributions", () => {
    const equal = giniOf([92, 93, 94, 95, 96, 97, 98, 98]);
    const unequal = giniOf([44, 46, 72, 82, 88, 100, 100, 100]);
    assert.ok(unequal > equal, `unequal ${String(unequal)} should exceed equal ${String(equal)}`);
  });
  it("is 0 for empty input", () => {
    assert.equal(giniOf([]), 0);
  });
});

describe("conservationHolds", () => {
  it("accepts balanced books within 1 m3", () => {
    assert.equal(conservationHolds(1000, 600, 200, 150, 50), true);
  });
  it("rejects imbalanced books", () => {
    assert.equal(conservationHolds(1000, 600, 200, 150, 49), false);
  });
});

describe("mock", () => {
  it("entitlement rows sum to the season total", async () => {
    const { rows, seasonTotalM3 } = await mock.suggestEntitlements();
    const sum = rows.reduce((a, r) => a + r.volumeM3, 0);
    assert.equal(sum, seasonTotalM3);
    assert.equal(rows.length, 9);
  });

  it("equal-hours starves the tail, equal-water meets >90%", async () => {
    const water = await mock.proposeRoster("equal_water");
    const hours = await mock.proposeRoster("equal_hours");
    const tail = (id: string) => id === "o7" || id === "o8";
    for (const turn of water.turns.filter((x) => tail(x.outletId))) {
      assert.ok(turn.needMetPct > 90, `${turn.outletId} water ${String(turn.needMetPct)}`);
    }
    for (const turn of hours.turns.filter((x) => tail(x.outletId))) {
      assert.ok(turn.needMetPct < 60, `${turn.outletId} hours ${String(turn.needMetPct)}`);
    }
    assert.ok(water.equalWaterGini < hours.equalHoursGini);
  });

  it("requests carry triage scores and recommendations", async () => {
    const rows = await mock.listRequests();
    assert.ok(rows.length >= 3);
    for (const r of rows) {
      assert.ok(r.triageScore >= 0 && r.triageScore <= 1);
      assert.ok(r.recommendation.volumeM3 >= 0);
      assert.ok(r.recommendation.rationale.length > 0);
    }
  });

  it("ledger has 8 farmers and a conservation flag", async () => {
    const ledger = await mock.ledger();
    assert.equal(ledger.farmers.length, 8);
    assert.equal(ledger.conservationOk, true);
    assert.ok(ledger.gini >= 0 && ledger.gini <= 1);
  });
});

describe("i18n", () => {
  it("en and te expose the same keys", () => {
    const enKeys = Object.keys(strings.en).sort();
    const teKeys = Object.keys(strings.te).sort();
    assert.deepEqual(teKeys, enKeys);
  });
});
