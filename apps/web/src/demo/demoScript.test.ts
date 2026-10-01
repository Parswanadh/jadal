import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_BUDGET_SECS,
  DEMO_STEPS,
  SIM_CLOCK_START,
  formatElapsed,
  stepByNumber,
  totalEstimatedSecs,
} from "./demoScript.ts";

test("demo script has exactly 6 sequential steps", () => {
  assert.equal(DEMO_STEPS.length, 6);
  assert.deepEqual(
    DEMO_STEPS.map((s) => s.step),
    [1, 2, 3, 4, 5, 6],
  );
});

test("every step is bilingual with an API-backed action", () => {
  for (const s of DEMO_STEPS) {
    assert.ok(s.titleEn.length > 0, `step ${s.step} titleEn`);
    assert.ok(s.titleTe.length > 0, `step ${s.step} titleTe`);
    assert.ok(s.whatEn.length > 0, `step ${s.step} whatEn`);
    assert.ok(s.whatTe.length > 0, `step ${s.step} whatTe`);
    assert.ok(s.actionLabelEn.length > 0, `step ${s.step} actionLabelEn`);
    assert.ok(s.actionLabelTe.length > 0, `step ${s.step} actionLabelTe`);
    assert.ok(s.apiCalls.length > 0, `step ${s.step} apiCalls`);
    assert.ok(s.estimatedSecs > 0, `step ${s.step} estimatedSecs`);
  }
});

test("step actions cover demo controls and read models", () => {
  const calls = DEMO_STEPS.flatMap((s) => s.apiCalls).join("\n");
  assert.match(calls, /\/api\/demo\/advance/);
  assert.match(calls, /\/api\/events/);
  assert.match(calls, /\/api\/rosters\/propose/);
  assert.match(calls, /\/api\/audit/);
});

test("start -> finish estimate stays under the 4-minute budget", () => {
  assert.equal(DEMO_BUDGET_SECS, 240);
  assert.ok(totalEstimatedSecs() < DEMO_BUDGET_SECS);
});

test("simulated clock seed is a valid date", () => {
  assert.ok(!Number.isNaN(new Date(SIM_CLOCK_START).getTime()));
});

test("helpers behave", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(95), "1:35");
  assert.equal(stepByNumber(1)?.actionId, "compare");
  assert.equal(stepByNumber(6)?.actionId, "audit");
  assert.equal(stepByNumber(99), undefined);
});
