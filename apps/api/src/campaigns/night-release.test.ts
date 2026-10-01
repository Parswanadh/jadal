/**
 * Night-release tests (B7).
 *
 * The rule is small but the failure mode is expensive: a 19:00 IST release must warn at 18:00 IST by
 * WhatsApp plus a voice call, and a daytime release must warn nobody. The tests build one roster for
 * the fixture's night window (`rw2`, 19:00 IST) covering one smartphone farmer and one feature-phone
 * farmer, so both channel branches are exercised, and assert the exact warning instant (`start − 1h`).
 *
 * NO NETWORK: `scheduleNightRelease` never fetches; it reads the store and appends events.
 */

import { describe, expect, it } from "vitest";
import { JadalEvent, type ReleaseWindow, type Roster } from "@jadal/contracts";

import { createEnv, createTestDb, type FetchRoutes, type TestEnv } from "../../test/harness";
import { seedScenario } from "../../test/fixtures";
import { now as clockNow } from "../db/clock";
import { appendEvent } from "../db/store";
import { scheduleNightRelease } from "./night-release";

/** `createEnv` plus the migrations `createTestDb` applies; the store cannot run without them. */
async function dbEnv(routes: FetchRoutes = {}): Promise<TestEnv> {
  const env = createEnv(routes);
  env.DB = await createTestDb();
  return env;
}

/** Read the log directly: `store.readEvents` has a known payload-parsing bug this file must avoid. */
async function readJadalEvents(env: TestEnv): Promise<JadalEvent[]> {
  const rows = await env.DB.prepare("SELECT payload FROM events ORDER BY seq ASC").all<{ payload: string }>();
  return rows.map((row) => JadalEvent.parse(JSON.parse(row.payload) as unknown));
}

function warningAt(startIso: string): string {
  return new Date(Date.parse(startIso) - 3_600_000).toISOString();
}

function rosterFor(window: ReleaseWindow): Roster {
  const id = "roster-night";
  return {
    id,
    canal_id: window.canal_id,
    release_window_id: window.id,
    status: "proposed",
    turns: [
      {
        id: `${id}:t1`,
        roster_id: id,
        outlet_id: "o1",
        farmer_id: "f1",
        start: window.start,
        end: window.end,
        planned_volume_m3: 120,
        expected_flow_m3s: 0.145,
        lag_h: 0.2,
      },
      {
        id: `${id}:t2`,
        roster_id: id,
        outlet_id: "o5",
        farmer_id: "f5",
        start: window.start,
        end: window.end,
        planned_volume_m3: 60,
        expected_flow_m3s: 0.12,
        lag_h: 1.2,
      },
    ],
    shortfall_m3: {},
  };
}

describe("scheduleNightRelease", () => {
  it("queues WhatsApp plus a warning call at start − 1h for every affected farmer", async () => {
    const env = await dbEnv();
    const seed = await seedScenario(env);
    const now = await clockNow(env);

    const window = seed.scenario.release_windows.find((candidate) => candidate.id === "rw2");
    if (window === undefined) throw new Error("fixture is missing release window rw2");
    await appendEvent(env, {
      id: "evt-roster-night",
      at: now,
      canal_id: window.canal_id,
      actor: { kind: "agent", id: "scheduler" },
      type: "roster.proposed",
      roster: rosterFor(window),
    });
    await appendEvent(env, {
      id: "evt-roster-night-approved",
      at: now,
      canal_id: window.canal_id,
      actor: { kind: "coordinator", id: "coordinator" },
      type: "roster.approved",
      roster_id: "roster-night",
    });

    const contacts = await scheduleNightRelease(env, window, now);
    const expectedAt = warningAt(window.start);
    expect(expectedAt).toBe("2026-09-17T12:30:00.000Z");

    // f1 has a smartphone → call + WhatsApp. f5 has a feature phone → call only, never WhatsApp.
    expect(contacts).toHaveLength(3);
    const f1Channels = contacts.filter((contact) => contact.farmer_id === "f1").map((contact) => contact.channel);
    const f5Channels = contacts.filter((contact) => contact.farmer_id === "f5").map((contact) => contact.channel);
    expect(f1Channels.sort()).toEqual(["voice", "whatsapp"]);
    expect(f5Channels).toEqual(["voice"]);

    for (const contact of contacts) {
      expect(contact.status).toBe("queued");
      expect(contact.purpose).toBe("release_warning");
      expect(contact.at).toBe(expectedAt);
      expect(contact.attempt).toBe(1);
      expect(contact.message_te.length).toBeGreaterThan(0);
      expect(contact.message_te).toContain("రాత్రి");
    }

    const events = await readJadalEvents(env);
    for (const event of events) {
      expect(() => JadalEvent.parse(event)).not.toThrow();
    }
    expect(events.filter((event) => event.type === "contact.updated")).toHaveLength(3);
  });

  it("queues nothing for a daytime release", async () => {
    const env = createEnv();
    const now = "2026-09-14T00:30:00.000Z";
    // 2026-09-17T02:30:00Z is 08:00 IST — outside the band.
    const daytime: ReleaseWindow = {
      id: "rw-day",
      canal_id: "c1",
      start: "2026-09-17T02:30:00.000Z",
      end: "2026-09-18T02:30:00.000Z",
      discharge_m3s: 0.15,
    };
    expect(await scheduleNightRelease(env, daytime, now)).toEqual([]);
  });

  it("queues nothing once the warning instant has already passed", async () => {
    const env = await dbEnv();
    const seed = await seedScenario(env);
    const window = seed.scenario.release_windows.find((candidate) => candidate.id === "rw2");
    if (window === undefined) throw new Error("fixture is missing release window rw2");
    await appendEvent(env, {
      id: "evt-roster-night-2",
      at: window.start,
      canal_id: window.canal_id,
      actor: { kind: "agent", id: "scheduler" },
      type: "roster.proposed",
      roster: rosterFor(window),
    });
    await appendEvent(env, {
      id: "evt-roster-night-2-approved",
      at: window.start,
      canal_id: window.canal_id,
      actor: { kind: "coordinator", id: "coordinator" },
      type: "roster.approved",
      roster_id: "roster-night",
    });
    // One minute after the 18:00 IST warning instant.
    const late = new Date(Date.parse(warningAt(window.start)) + 60_000).toISOString();
    expect(await scheduleNightRelease(env, window, late)).toEqual([]);
  });
});
