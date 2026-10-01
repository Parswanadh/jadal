// C5 canal hero — seed-data invariants (node:test, no dependencies).
// Guards the "numbers ONLY from API/mock" rule: every figure the UI can show
// must already exist, verbatim, in src/canal/seed.json.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const seed = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "canal", "seed.json"), "utf-8"));
const TE_RE = /[ఀ-౿]/;

describe("canal seed", () => {
  it("canal head is declared", () => {
    assert.equal(seed.canal.id, "canal-minor-1");
    assert.equal(seed.canal.length_m, 12000);
    assert.equal(seed.canal.head_discharge_m3s, 1.2);
    assert.match(seed.canal.name_te, TE_RE);
  });

  it("8 outlets ordered head to tail inside the canal", () => {
    assert.equal(seed.outlets.length, 8);
    const ids = new Set(seed.outlets.map((o) => o.id));
    assert.equal(ids.size, 8);
    const chain = seed.outlets.map((o) => o.chainage_m);
    assert.deepEqual([...chain].sort((a, b) => a - b), chain);
    for (const o of seed.outlets) {
      assert.ok(o.chainage_m >= 0 && o.chainage_m <= seed.canal.length_m, `${o.id} chainage`);
      assert.match(o.name_te, TE_RE);
      assert.match(o.farmer_name_te, TE_RE);
    }
    const farmers = new Set(seed.outlets.map((o) => o.farmer_id));
    assert.equal(farmers.size, 8);
  });

  it("flows shrink head to tail", () => {
    assert.equal(seed.flows.length, 8);
    assert.deepEqual(seed.flows.map((f) => f.outlet_id), seed.outlets.map((o) => o.id));
    const q = seed.flows.map((f) => f.flow_m3s);
    for (let i = 1; i < q.length; i++) assert.ok(q[i] < q[i - 1], `flow must shrink at index ${i}`);
    assert.ok(q[0] < seed.canal.head_discharge_m3s);
    for (const f of seed.flows) assert.ok(f.loss_fraction >= 0 && f.loss_fraction < 1);
  });

  it("equal-hours leaves the tail at ~40% while equal-water is flat", () => {
    for (const mode of ["equal_hours", "equal_water"]) {
      const rows = seed.needMet[mode];
      assert.equal(rows.length, 8);
      assert.deepEqual(rows.map((r) => r.outlet_id), seed.outlets.map((o) => o.id));
      for (const r of rows) assert.ok(r.pct >= 0 && r.pct <= 100, `${mode} ${r.outlet_id}`);
    }
    const tailHours = seed.needMet.equal_hours.at(-1).pct;
    assert.ok(tailHours <= 45, `tail under equal hours is ~40%, got ${tailHours}`);
    assert.ok(seed.needMet.equal_hours[0].pct >= 95);
    for (const r of seed.needMet.equal_water) assert.ok(r.pct >= 90, `equal water ${r.outlet_id}`);
  });

  it("comparison gini prefers equal water", () => {
    const { equal_hours_gini: h, equal_water_gini: w } = seed.comparison;
    assert.ok(h >= 0 && h <= 1 && w >= 0 && w <= 1);
    assert.ok(h > w, "equal hours must be less equal than equal water");
  });

  it("overrun answers exist for every non-tail outlet and sum exactly", () => {
    assert.deepEqual(seed.overrunSteps, [0, 0.5, 1, 2]);
    assert.deepEqual(Object.keys(seed.overrun).sort(), ["o1", "o2", "o3", "o4", "o5", "o6", "o7"]);
    const idx = Object.fromEntries(seed.outlets.map((o, i) => [o.id, i]));
    for (const [oid, cases] of Object.entries(seed.overrun)) {
      assert.deepEqual(Object.keys(cases).sort(), ["0.5", "1", "2"]);
      let prev = -1;
      for (const h of ["0.5", "1", "2"]) {
        const c = cases[h];
        assert.ok(c.total_lost_m3 > 0);
        assert.ok(c.total_lost_m3 > prev, `${oid}@${h} must grow with hours`);
        prev = c.total_lost_m3;
        // Only downstream outlets appear, each with a positive verbatim figure.
        for (const [downId, lost] of c.losses) {
          assert.ok(idx[downId] > idx[oid], `${downId} must be downstream of ${oid}`);
          assert.ok(lost > 0);
        }
        // Displayed total equals the displayed parts — the UI never sums.
        const parts = c.losses.reduce((a, [, l]) => a + l, 0);
        assert.equal(parts, c.total_lost_m3, `${oid}@${h} total must equal parts`);
      }
    }
  });
});
