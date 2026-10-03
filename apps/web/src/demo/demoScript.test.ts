import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import te from "../i18n/te.json";
import {
  DEMO_BUDGET_SECS,
  DEMO_STEPS,
  SIM_CLOCK_START,
  formatElapsed,
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

  it("every step has a plain title and sentence in both languages, and a screen to see it on", () => {
    for (const s of DEMO_STEPS) {
      const key = String(s.step) as keyof typeof en.demo.steps;
      for (const lang of [en, te]) {
        expect(lang.demo.steps[key].title.length, `step ${s.step} title`).toBeGreaterThan(0);
        expect(lang.demo.steps[key].what.length, `step ${s.step} sentence`).toBeGreaterThan(0);
      }
      expect(s.seeIt.startsWith("/"), `step ${s.step} link`).toBe(true);
      expect(s.estimatedSecs).toBeGreaterThan(0);
    }
  });

  it("each step has an outcome sentence in both languages", () => {
    for (const lang of [en, te]) {
      for (const n of ["1", "2", "3", "4", "5", "6"]) {
        expect(lang.demo.outcome[n as keyof typeof lang.demo.outcome], `outcome ${n}`).toBeTruthy();
      }
    }
  });

  it("start to finish stays under the 4-minute budget", () => {
    expect(DEMO_BUDGET_SECS).toBe(240);
    expect(totalEstimatedSecs()).toBeLessThan(DEMO_BUDGET_SECS);
  });

  it("simulated clock seed is a valid date", () => {
    expect(Number.isNaN(new Date(SIM_CLOCK_START).getTime())).toBe(false);
  });

  it("helpers behave", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(95)).toBe("1:35");
  });
});

describe("demo api adapter (mock mode)", () => {
  it("runs every walkthrough step against the shared mock and returns visible outcomes", async () => {
    expect((await demoReset()).ok).toBe(true);
    const compare = await compareRosters();
    expect(compare.ok).toBe(true);
    expect(compare.mocked).toBe(true);
    expect(compare.data?.tailAfterPct).toBeGreaterThan(compare.data?.tailBeforePct ?? 100);

    const urgent = await raiseUrgentRequest();
    expect(urgent.error).toBeUndefined();
    expect(urgent.data?.approved).toBe(true);
    expect(urgent.data?.farmerName).toBeTruthy();
    expect(urgent.data?.grantedM3).toBeGreaterThan(0);
    expect(urgent.data?.grantedM3).toBeLessThanOrEqual(urgent.data?.askedM3 ?? 0);

    const notify = await replanAndNotify();
    expect(notify.data?.callsPlaced).toBeGreaterThan(0);
    expect((notify.data?.voiceOnly.length ?? 0) + (notify.data?.whatsapp.length ?? 0)).toBeGreaterThan(0);
    // Farmers without a smartphone get a call only.
    expect(notify.data?.voiceOnly).toContain("Anjamma Bandi");
    expect(notify.data?.voiceOnly).toContain("Narasimha Chinta");

    const night = await fireNightProtocol();
    expect(night.data?.startsAt).toBe("2026-09-17T13:30:00Z");
    expect(night.data?.farmersWarned).toBeGreaterThan(0);

    const buffer = await releaseToBuffer("test reason");
    expect(buffer.data?.bufferM3).toBeGreaterThan(0);
    expect(buffer.data?.requester).toBe("Padmavathi Kolli");

    const audit = await fetchAudit();
    expect(audit.data?.conservationOk).toBe(true);
    expect(audit.data?.summaryEn.length).toBeGreaterThan(0);

    expect((await demoAdvance(1)).data?.now).toBeTruthy();
    expect(((await fetchEvents()).data ?? []).length).toBeGreaterThan(0);
  });

  it("turns events into rows the screen can write as sentences", async () => {
    await demoReset();
    const events = (await fetchEvents()).data ?? [];
    expect(events.some((e) => e.type === "farmer_registered" && e.name)).toBe(true);
    expect(events.every((e) => !e.type.includes("."))).toBe(true);
  });
});
