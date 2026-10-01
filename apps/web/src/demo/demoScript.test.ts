import { describe, expect, it } from "vitest";
import {
  DEMO_BUDGET_SECS,
  DEMO_STEPS,
  SIM_CLOCK_START,
  formatElapsed,
  stepByNumber,
  totalEstimatedSecs,
} from "./demoScript";
import {
  compareRosters,
  demoAdvance,
  demoReset,
  fetchAudit,
  fetchEvents,
  fireNightProtocol,
  raiseUrgentRequest,
  releaseToBuffer,
  replanAndNotify,
} from "./api";

describe("demo script", () => {
  it("has exactly 6 sequential steps", () => {
    expect(DEMO_STEPS).toHaveLength(6);
    expect(DEMO_STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("every step is bilingual with an API-backed action", () => {
    for (const s of DEMO_STEPS) {
      expect(s.titleEn.length, `step ${s.step} titleEn`).toBeGreaterThan(0);
      expect(s.titleTe.length, `step ${s.step} titleTe`).toBeGreaterThan(0);
      expect(s.whatEn.length, `step ${s.step} whatEn`).toBeGreaterThan(0);
      expect(s.whatTe.length, `step ${s.step} whatTe`).toBeGreaterThan(0);
      expect(s.actionLabelEn.length).toBeGreaterThan(0);
      expect(s.actionLabelTe.length).toBeGreaterThan(0);
      expect(s.apiCalls.length).toBeGreaterThan(0);
      expect(s.estimatedSecs).toBeGreaterThan(0);
    }
  });

  it("step actions cover demo controls and read models", () => {
    const calls = DEMO_STEPS.flatMap((s) => s.apiCalls).join("\n");
    expect(calls).toMatch(/\/api\/demo\/advance/);
    expect(calls).toMatch(/\/api\/events/);
    expect(calls).toMatch(/\/api\/rosters\/propose/);
    expect(calls).toMatch(/\/api\/audit/);
  });

  it("start -> finish estimate stays under the 4-minute budget", () => {
    expect(DEMO_BUDGET_SECS).toBe(240);
    expect(totalEstimatedSecs()).toBeLessThan(DEMO_BUDGET_SECS);
  });

  it("simulated clock seed is a valid date", () => {
    expect(Number.isNaN(new Date(SIM_CLOCK_START).getTime())).toBe(false);
  });

  it("helpers behave", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(95)).toBe("1:35");
    expect(stepByNumber(1)?.actionId).toBe("compare");
    expect(stepByNumber(6)?.actionId).toBe("audit");
    expect(stepByNumber(99)).toBeUndefined();
  });
});

describe("demo api adapter (mock mode)", () => {
  it("runs every walkthrough step against the shared mock", async () => {
    expect((await demoReset()).ok).toBe(true);
    const compare = await compareRosters();
    expect(compare.ok).toBe(true);
    expect(compare.mocked).toBe(true);
    expect(compare.data?.tailAfterPct).toBeGreaterThan(compare.data?.tailBeforePct ?? 100);

    const urgent = await raiseUrgentRequest();
    expect(urgent.error).toBeUndefined();
    expect(urgent.data?.decision).toMatch(/approved/);

    const notify = await replanAndNotify();
    expect(notify.data?.callsPlaced).toBeGreaterThan(0);
    expect((notify.data?.voiceOnly.length ?? 0) + (notify.data?.whatsapp.length ?? 0)).toBeGreaterThan(0);

    const night = await fireNightProtocol();
    expect(night.data?.windowId).toBe("rw2");
    expect(night.data?.startsAtIst).toBe("19:00 IST");

    const buffer = await releaseToBuffer();
    expect(buffer.data?.bufferM3).toBeGreaterThan(0);

    const audit = await fetchAudit();
    expect(audit.data?.conservationOk).toBe(true);
    expect(audit.data?.summaryEn.length).toBeGreaterThan(0);

    expect((await demoAdvance(1)).data?.now).toBeTruthy();
    expect(((await fetchEvents()).data ?? []).length).toBeGreaterThan(0);
  });
});
