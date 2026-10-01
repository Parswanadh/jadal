/**
 * Event → projection reducers.
 *
 * Every function here is pure: an event in, the exact `db.batch()` statements that apply it to the
 * projection tables out. No database access, no clock, no `Date.now()`. That is what lets
 * `store.appendEvent` put the event, its projections and its ledger entries into a single atomic
 * batch, and what lets a test assert the reducer's output directly.
 *
 * Rules this module follows:
 *
 *  * **Parameterised only.** Values always travel as `?` bindings. No interpolation of event data
 *    into SQL, ever. (Table and column names appear literally because they are code, not input.)
 *  * **Upsert, never delete.** Projections are monotone: replaying the log twice, or replaying it out
 *    of order, converges on the same rows rather than losing them.
 *  * **Last event wins** for a single-valued status column. The log is the authority on transitions,
 *    so a projection simply records the most recent event that touched the row.
 *  * **Never DELETE, never renumber.** Ledger history must survive every rebuild.
 *
 * Where the migration has no column that can represent an event's effect, the projection is empty and
 * the effect lives in the ledger only. Those cases are marked `SCHEMA NOTE` below; the list is
 * reproduced in the task report.
 */

import type { JadalEvent } from "@jadal/contracts/events";

/** One statement for `db.batch()`. `bindings` are positional `?` values. */
export interface ProjectionStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

function stmt(sql: string, ...bindings: unknown[]): ProjectionStatement {
  return { sql, bindings };
}

/**
 * Conservation tolerance seeded with a newly declared season. Matches the `season.tolerance_m3`
 * default in `migrations/0002_jadal.sql`. ASSUMED (per that migration): 0.5 m³ is below the resolution
 * of any irrigation meter, so a larger gap is a real violation rather than float noise.
 */
export const DEFAULT_TOLERANCE_M3 = 0.5;

/** Compile-time exhaustiveness guard: every new event type must be handled here. */
function assertNever(value: never, type: string): never {
  throw new Error(`projections: unhandled event type ${JSON.stringify(value)} (discriminator ${type})`);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** `undefined` → SQL NULL, so an absent optional becomes NULL instead of the string "undefined". */
function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

// ---------------------------------------------------------------------------
// Per-entity upserts
// ---------------------------------------------------------------------------

/**
 * SCHEMA NOTE: `verified` and `registered_at` are deliberately excluded from the DO UPDATE clause.
 * Re-registering a farmer must never silently revoke a verification the coordinator already granted.
 */
function farmerUpsert(event: Extract<JadalEvent, { type: "farmer.registered" }>): ProjectionStatement {
  const { farmer } = event;
  return stmt(
    `INSERT INTO farmer (id, name, phone, language, preferred_channels, has_smartphone, verified, registered_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       phone = excluded.phone,
       language = excluded.language,
       preferred_channels = excluded.preferred_channels,
       has_smartphone = excluded.has_smartphone`,
    farmer.id,
    farmer.name,
    farmer.phone,
    farmer.language,
    json(farmer.preferred_channels),
    farmer.has_smartphone ? 1 : 0,
    event.at,
  );
}

function plotUpsert(plot: Extract<JadalEvent, { type: "farmer.registered" }>["plots"][number]): ProjectionStatement {
  return stmt(
    `INSERT INTO plot (id, farmer_id, outlet_id, area_ha, soil, lat, lon)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       farmer_id = excluded.farmer_id,
       outlet_id = excluded.outlet_id,
       area_ha = excluded.area_ha,
       soil = excluded.soil,
       lat = excluded.lat,
       lon = excluded.lon`,
    plot.id,
    plot.farmer_id,
    plot.outlet_id,
    plot.area_ha,
    plot.soil,
    plot.lat,
    plot.lon,
  );
}

/** SCHEMA NOTE: `status` is not in the DO UPDATE clause — later events own it, so a re-registration cannot regress it. */
function cropPlanUpsert(
  plan: Extract<JadalEvent, { type: "farmer.registered" }>["crop_plans"][number],
): ProjectionStatement {
  return stmt(
    `INSERT INTO crop_plan (id, plot_id, crop, sowing_date, area_fraction, application_efficiency, rice_practice, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       plot_id = excluded.plot_id,
       crop = excluded.crop,
       sowing_date = excluded.sowing_date,
       area_fraction = excluded.area_fraction,
       application_efficiency = excluded.application_efficiency,
       rice_practice = excluded.rice_practice`,
    plan.id,
    plan.plot_id,
    plan.crop,
    plan.sowing_date,
    plan.area_fraction,
    plan.application_efficiency,
    nullable(plan.rice_practice),
    plan.status,
  );
}

function entitlementUpsert(
  entitlement: Extract<JadalEvent, { type: "season.approved" | "entitlement.proposed" }>["entitlements"][number],
): ProjectionStatement {
  return stmt(
    `INSERT INTO entitlement (id, farmer_id, crop_plan_id, week_start, volume_m3, net_irrigation_mm, status, explanation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       farmer_id = excluded.farmer_id,
       crop_plan_id = excluded.crop_plan_id,
       week_start = excluded.week_start,
       volume_m3 = excluded.volume_m3,
       net_irrigation_mm = excluded.net_irrigation_mm,
       status = excluded.status,
       explanation = excluded.explanation`,
    entitlement.id,
    entitlement.farmer_id,
    entitlement.crop_plan_id,
    entitlement.week_start,
    entitlement.volume_m3,
    entitlement.net_irrigation_mm,
    entitlement.status,
    nullable(entitlement.explanation),
  );
}

function releaseWindowUpsert(
  window: Extract<JadalEvent, { type: "release_window.announced" }>["window"],
): ProjectionStatement {
  return stmt(
    `INSERT INTO release_window (id, canal_id, start, end, discharge_m3s)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       canal_id = excluded.canal_id,
       start = excluded.start,
       end = excluded.end,
       discharge_m3s = excluded.discharge_m3s`,
    window.id,
    window.canal_id,
    window.start,
    window.end,
    window.discharge_m3s,
  );
}

function rosterUpsert(roster: Extract<JadalEvent, { type: "roster.proposed" }>["roster"], at: string): ProjectionStatement {
  return stmt(
    `INSERT INTO roster (id, canal_id, release_window_id, status, shortfall, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       canal_id = excluded.canal_id,
       release_window_id = excluded.release_window_id,
       status = excluded.status,
       shortfall = excluded.shortfall,
       created_at = excluded.created_at`,
    roster.id,
    roster.canal_id,
    roster.release_window_id,
    roster.status,
    json(roster.shortfall_m3),
    at,
  );
}

function turnUpsert(turn: Extract<JadalEvent, { type: "roster.proposed" }>["roster"]["turns"][number]): ProjectionStatement {
  return stmt(
    `INSERT INTO turn (id, roster_id, outlet_id, farmer_id, start, end, planned_volume_m3, expected_flow_m3s, lag_h)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       roster_id = excluded.roster_id,
       outlet_id = excluded.outlet_id,
       farmer_id = excluded.farmer_id,
       start = excluded.start,
       end = excluded.end,
       planned_volume_m3 = excluded.planned_volume_m3,
       expected_flow_m3s = excluded.expected_flow_m3s,
       lag_h = excluded.lag_h`,
    turn.id,
    turn.roster_id,
    turn.outlet_id,
    turn.farmer_id,
    turn.start,
    turn.end,
    turn.planned_volume_m3,
    turn.expected_flow_m3s,
    turn.lag_h,
  );
}

/**
 * SCHEMA NOTE: `escalated` is not in the DO UPDATE clause — it is escalation-ladder state owned by the caller agent. */
function contactUpsert(contact: Extract<JadalEvent, { type: "contact.updated" }>["contact"]): ProjectionStatement {
  return stmt(
    `INSERT INTO contact (id, farmer_id, channel, purpose, status, attempt, message_te, message_en, at, transcript, escalated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (id) DO UPDATE SET
       farmer_id = excluded.farmer_id,
       channel = excluded.channel,
       purpose = excluded.purpose,
       status = excluded.status,
       attempt = excluded.attempt,
       message_te = excluded.message_te,
       message_en = excluded.message_en,
       at = excluded.at,
       transcript = excluded.transcript`,
    contact.id,
    contact.farmer_id,
    contact.channel,
    contact.purpose,
    contact.status,
    contact.attempt,
    contact.message_te,
    contact.message_en,
    contact.at,
    nullable(contact.transcript),
  );
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * The statements that apply `event` to the projection tables, in dependency order.
 *
 * Order matters: `db.batch()` runs statements sequentially inside one transaction, and the schema
 * declares real foreign keys (`plot.farmer_id`, `crop_plan.plot_id`, `turn.roster_id`, …), so a parent
 * row is always written before its children.
 */
export function projectionsFor(event: JadalEvent): ProjectionStatement[] {
  switch (event.type) {
    case "farmer.registered": {
      const out: ProjectionStatement[] = [farmerUpsert(event)];
      for (const plot of event.plots) out.push(plotUpsert(plot));
      for (const plan of event.crop_plans) out.push(cropPlanUpsert(plan));
      return out;
    }

    case "registration.verified":
      // Only `verified` plans advance. A plan still awaiting verification must not be activated by
      // the farmer's verification event, which is a different gate.
      return [
        stmt("UPDATE farmer SET verified = 1 WHERE id = ?", event.farmer_id),
        stmt(
          `UPDATE crop_plan SET status = 'active'
           WHERE status = 'verified'
             AND plot_id IN (SELECT id FROM plot WHERE farmer_id = ?)`,
          event.farmer_id,
        ),
      ];

    case "season.approved": {
      const out: ProjectionStatement[] = [];
      for (const entitlement of event.entitlements) out.push(entitlementUpsert(entitlement));
      out.push(
        // `tolerance_m3` is a conservation-check policy, not event data, so it is seeded from the
        // migration default (0.5 m³) on insert and preserved on update — re-declaring a season must
        // not silently change the auditor's threshold.
        stmt(
          `INSERT INTO season (canal_id, season_supply_m3, declared_at, tolerance_m3)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (canal_id) DO UPDATE SET
             season_supply_m3 = excluded.season_supply_m3,
             declared_at = excluded.declared_at`,
          event.canal_id,
          event.season_supply_m3,
          event.at,
          DEFAULT_TOLERANCE_M3,
        ),
      );
      return out;
    }

    case "entitlement.proposed":
      return event.entitlements.map(entitlementUpsert);

    case "entitlement.approved":
      // The guard keeps approval idempotent and stops it resurrecting an entitlement the coordinator
      // has since hand-edited back to `edited` unless it is edited again.
      return event.entitlement_ids.map((id) =>
        stmt("UPDATE entitlement SET status = 'approved' WHERE id = ? AND status IN ('proposed', 'edited')", id),
      );

    case "release_window.announced":
      return [releaseWindowUpsert(event.window)];

    case "roster.proposed": {
      const out: ProjectionStatement[] = [rosterUpsert(event.roster, event.at)];
      for (const turn of event.roster.turns) out.push(turnUpsert(turn));
      return out;
    }

    case "roster.approved":
      return [
        stmt("UPDATE roster SET status = 'approved' WHERE id = ?", event.roster_id),
        // The window's release_window_id is read back through a subquery rather than taken from the
        // caller, so the statement stays a pure function of the event id.
        stmt(
          `UPDATE roster SET status = 'superseded'
           WHERE release_window_id = (SELECT release_window_id FROM roster WHERE id = ?)
             AND id <> ?
             AND status = 'proposed'`,
          event.roster_id,
          event.roster_id,
        ),
      ];

    case "turn.delivered":
      // SCHEMA NOTE: the migration has no delivered flag or delivered volume on `turn`, `entitlement`
      // or `farmer`, so there is nowhere to project a delivery. The movement itself is recorded in
      // the same batch by `ledger.entriesFor` (quota → delivered, plus conveyance loss), and
      // `repo.getLedgerEntries` is the read path. Denormalising it here would need a migration.
      return [];

    case "request.raised": {
      const request = event.request;
      return [
        stmt(
          `INSERT INTO request (id, farmer_id, crop_plan_id, type, volume_m3, reason, channel, status, raised_at,
                                triage_score, agent_recommendation, coordinator_decision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             farmer_id = excluded.farmer_id,
             crop_plan_id = excluded.crop_plan_id,
             type = excluded.type,
             volume_m3 = excluded.volume_m3,
             reason = excluded.reason,
             channel = excluded.channel,
             status = excluded.status,
             raised_at = excluded.raised_at,
             triage_score = excluded.triage_score,
             agent_recommendation = excluded.agent_recommendation,
             coordinator_decision = excluded.coordinator_decision`,
          request.id,
          request.farmer_id,
          nullable(request.crop_plan_id),
          request.type,
          request.volume_m3,
          request.reason,
          request.channel,
          request.status,
          request.raised_at,
          nullable(request.triage_score),
          nullable(request.agent_recommendation === undefined ? undefined : json(request.agent_recommendation)),
          nullable(request.coordinator_decision === undefined ? undefined : json(request.coordinator_decision)),
        ),
      ];
    }

    case "request.triaged":
      return [
        stmt("UPDATE request SET status = 'triaged', triage_score = ? WHERE id = ?", event.triage_score, event.request_id),
      ];

    case "request.recommended":
      return [
        stmt(
          "UPDATE request SET status = 'recommended', agent_recommendation = ? WHERE id = ?",
          json(event.recommendation),
          event.request_id,
        ),
      ];

    case "request.decided":
      return [
        stmt(
          "UPDATE request SET status = ?, coordinator_decision = ? WHERE id = ?",
          event.decision === "approve" ? "approved" : "rejected",
          json({ decision: event.decision, volume_m3: event.volume_m3, ...(event.note === undefined ? {} : { note: event.note }), at: event.at }),
          event.request_id,
        ),
      ];

    case "week.released_to_buffer":
      // SCHEMA NOTE: `entitlement.status` is CHECK-limited to proposed/approved/edited, so there is no
      // terminal "released" value to move an entitlement to. The authoritative effect — that week's
      // quota leaving the farmer for the buffer — is the ledger entry written in the same batch.
      return [];

    case "crop.harvested":
      return [stmt("UPDATE crop_plan SET status = 'harvested' WHERE id = ?", event.crop_plan_id)];

    case "rain.replanned":
      // SCHEMA NOTE: `by_farmer_m3` is keyed by farmer, but `entitlement` rows are keyed by
      // (crop_plan_id, week_start). Deciding which weeks absorb the saving is crop arithmetic, which
      // belongs in `src/core/` and would need a migration to record per-week results. The ledger
      // entry for this event records the saving as quota → buffer.
      return [];

    case "contact.updated":
      return [contactUpsert(event.contact)];

    default:
      return assertNever(event, "type");
  }
}