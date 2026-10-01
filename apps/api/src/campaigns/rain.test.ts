/**
 * Rain re-plan tests (B7).
 *
 * The trigger is a policy number from `docs/research/voice-and-data.md` §7.4: a forecast
 * `precipitation_sum >= 15 mm` inside the next 24 hours. `shouldReplan` is asserted at, just below
 * and above the threshold and against a day outside the horizon. The integration test mocks Open-Meteo
 * through `createEnv`'s fetch routes (so the test proves the client is used and no other egress
 * happens), seeds the demo scenario, and checks that the re-plan conserves its own volume —
 * `saved_m3` equals the sum of `by_farmer_m3` and the appended `rain.replanned` event says the same.
 *
 * NO NETWORK: the only fetch is the mocked Open-Meteo route; any other URL throws.
 */

import { describe, expect, it } from "vitest";
import { JadalEvent, type WeatherDay } from "@jadal/contracts";

import { createEnv, createTestDb, type FetchRoutes, type TestEnv } from "../../test/harness";
import { seedScenario } from "../../test/fixtures";
import { setNow } from "../db/clock";
import { readEvents } from "../db/store";
import { rainTriggerMm } from "../voice/openmeteo";
import { replan, shouldReplan } from "./rain";

/** `createEnv` plus the migrations `createTestDb` applies; the store cannot run without them. */
async function dbEnv(routes: FetchRoutes = {}): Promise<TestEnv> {
  const env = createEnv(routes);
  env.DB = await createTestDb();
  return env;
}

/** Read the log through the store, which parses and validates every row as `JadalEvent`. */
async function readJadalEvents(env: TestEnv): Promise<JadalEvent[]> {
  return readEvents(env);
}

/** 2026-09-14T12:00:00Z; the horizon is 2026-09-15T12:00:00Z. */
const NOW = "2026-09-14T12:00:00.000Z";

function day(date: string, rain_mm: number): WeatherDay {
  return { date, et0_mm: 4.5, rain_mm };
}

/** The daily envelope `getForecast` expects, parallel arrays and all. */
function openMeteo(dates: readonly string[], rain: readonly number[]): unknown {
  return {
    daily: {
      time: [...dates],
      et0_fao_evapotranspiration: dates.map(() => 4.5),
      precipitation_sum: [...rain],
      rain_sum: [...rain],
      precipitation_probability_max: dates.map(() => 70),
      temperature_2m_max: dates.map(() => 33),
      temperature_2m_min: dates.map(() => 25),
    },
  };
}

describe("shouldReplan", () => {
  it("triggers at or above the 15 mm threshold inside the next 24 hours", () => {
    expect(rainTriggerMm).toBe(15);
    expect(shouldReplan([day("2026-09-14", rainTriggerMm)], NOW)).toBe(true);
    expect(shouldReplan([day("2026-09-14", 42.5)], NOW)).toBe(true);
  });

  it("does not trigger below the threshold", () => {
    expect(shouldReplan([day("2026-09-14", 14.9)], NOW)).toBe(false);
    expect(shouldReplan([day("2026-09-14", 0)], NOW)).toBe(false);
  });

  it("ignores heavy rain beyond the 24-hour horizon", () => {
    expect(shouldReplan([day("2026-09-20", 80)], NOW)).toBe(false);
  });

  it("returns false for an unparseable clock rather than guessing", () => {
    expect(shouldReplan([day("2026-09-14", 80)], "not-a-date")).toBe(false);
  });
});

describe("replan", () => {
  it("defers upcoming turns, conserves the saved volume and notifies affected farmers", async () => {
    const env = await dbEnv({ "api.open-meteo.com": openMeteo(["2026-09-15"], [16]) });
    await seedScenario(env);
    await setNow(env, "2026-09-14T23:00:00.000Z");

    const result = await replan(env, "c1");
    expect(result.saved_m3).toBeGreaterThan(0);
    const perFarmer = Object.values(result.by_farmer_m3);
    const summed = perFarmer.reduce((total, volume) => total + volume, 0);
    expect(result.saved_m3).toBeCloseTo(summed, 6);
    expect(result.contacts.length).toBeGreaterThan(0);
    for (const contact of result.contacts) {
      expect(contact.purpose).toBe("roster_change");
      expect(contact.message_te).toContain("వర్షం");
    }

    // Exactly one Open-Meteo call, and it is the mocked one.
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0]?.url).toContain("api.open-meteo.com");

    const events = await readJadalEvents(env);
    for (const event of events) {
      expect(() => JadalEvent.parse(event)).not.toThrow();
    }
    const replanned = events.filter((event) => event.type === "rain.replanned");
    expect(replanned).toHaveLength(1);
    const event = replanned[0];
    if (event?.type !== "rain.replanned") throw new Error("expected a rain.replanned event");
    expect(event.saved_m3).toBeCloseTo(result.saved_m3, 6);
    expect(event.by_farmer_m3).toEqual(result.by_farmer_m3);
  });

  it("does nothing when the forecast is below the trigger", async () => {
    const env = await dbEnv({ "api.open-meteo.com": openMeteo(["2026-09-15"], [1]) });
    await seedScenario(env);
    await setNow(env, "2026-09-14T23:00:00.000Z");

    const result = await replan(env, "c1");
    expect(result).toEqual({ saved_m3: 0, by_farmer_m3: {}, contacts: [] });

    const events = await readJadalEvents(env);
    expect(events.filter((event) => event.type === "rain.replanned")).toHaveLength(0);
  });
});
