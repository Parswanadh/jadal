-- 0002_jadal.sql: append-only event log, projections, ledger, and the demo clock.
--
-- Design rules (docs/architecture/overview.md §3):
--  * `events` is append-only. Nothing ever updates or deletes a row.
--  * Every entity table is a *projection* rebuilt from the log by apps/api/src/db/projections.ts.
--  * `ledger_entries` is double-entry and written in the SAME db.batch() as the event that
--    caused it, so water cannot move without an event and vice versa.

-- ---------------------------------------------------------------------------
-- Append-only event log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,  -- insertion order; drives demo replay
  id         TEXT    NOT NULL UNIQUE,             -- JadalEvent.id
  at         TEXT    NOT NULL,                   -- IsoTime, event time (simulated clock in demo mode)
  canal_id   TEXT    NOT NULL,
  type       TEXT    NOT NULL,                   -- JadalEvent.type discriminator
  actor_kind TEXT    NOT NULL CHECK (actor_kind IN ('coordinator', 'farmer', 'agent', 'system')),
  actor_id   TEXT    NOT NULL,
  payload    TEXT    NOT NULL CHECK (json_valid(payload)),  -- full event JSON
  logged_at  TEXT    NOT NULL                    -- wall-clock insert time, for the audit trail
);

CREATE INDEX IF NOT EXISTS idx_events_type     ON events (type, seq);
CREATE INDEX IF NOT EXISTS idx_events_at       ON events (at);
CREATE INDEX IF NOT EXISTS idx_events_actor    ON events (actor_kind, actor_id);
CREATE INDEX IF NOT EXISTS idx_events_canal_at ON events (canal_id, at);

-- ---------------------------------------------------------------------------
-- Projections
-- ---------------------------------------------------------------------------

-- The demo scenario defines exactly one canal; a `canal` table keeps the shape uniform so a
-- multi-canal command area only needs new rows, not a schema change.
CREATE TABLE IF NOT EXISTS canal (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  length_m              REAL NOT NULL CHECK (length_m > 0),
  head_discharge_m3s    REAL NOT NULL CHECK (head_discharge_m3s > 0),
  seepage_k_per_m       REAL NOT NULL CHECK (seepage_k_per_m >= 0),
  manning_n             REAL NOT NULL CHECK (manning_n > 0),
  bed_slope             REAL NOT NULL CHECK (bed_slope > 0),
  hydraulic_radius_m    REAL NOT NULL CHECK (hydraulic_radius_m > 0),
  lined                 INTEGER NOT NULL CHECK (lined IN (0, 1))
);

CREATE TABLE IF NOT EXISTS outlet (
  id          TEXT PRIMARY KEY,
  canal_id    TEXT NOT NULL REFERENCES canal (id),
  name        TEXT NOT NULL,
  chainage_m  REAL NOT NULL CHECK (chainage_m >= 0)
);

CREATE INDEX IF NOT EXISTS idx_outlet_canal ON outlet (canal_id, chainage_m);

CREATE TABLE IF NOT EXISTS farmer (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  phone              TEXT NOT NULL,
  language           TEXT NOT NULL,
  preferred_channels TEXT NOT NULL CHECK (json_valid(preferred_channels)),
  has_smartphone     INTEGER NOT NULL CHECK (has_smartphone IN (0, 1)),
  verified           INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  registered_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plot (
  id          TEXT PRIMARY KEY,
  farmer_id   TEXT NOT NULL REFERENCES farmer (id),
  outlet_id   TEXT NOT NULL REFERENCES outlet (id),
  area_ha     REAL NOT NULL CHECK (area_ha > 0),
  soil        TEXT NOT NULL,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plot_farmer ON plot (farmer_id);
CREATE INDEX IF NOT EXISTS idx_plot_outlet ON plot (outlet_id);

CREATE TABLE IF NOT EXISTS crop_plan (
  id                     TEXT PRIMARY KEY,
  plot_id                TEXT NOT NULL REFERENCES plot (id),
  crop                   TEXT NOT NULL,
  sowing_date            TEXT NOT NULL,
  area_fraction          REAL NOT NULL CHECK (area_fraction > 0 AND area_fraction <= 1),
  application_efficiency REAL NOT NULL CHECK (application_efficiency > 0 AND application_efficiency <= 1),
  rice_practice          TEXT,
  status                 TEXT NOT NULL CHECK (status IN ('registered', 'verified', 'active', 'harvested'))
);

CREATE INDEX IF NOT EXISTS idx_crop_plan_plot ON crop_plan (plot_id);

CREATE TABLE IF NOT EXISTS entitlement (
  id                 TEXT PRIMARY KEY,
  farmer_id          TEXT NOT NULL REFERENCES farmer (id),
  crop_plan_id       TEXT NOT NULL REFERENCES crop_plan (id),
  week_start         TEXT NOT NULL,
  volume_m3          REAL NOT NULL CHECK (volume_m3 >= 0),
  net_irrigation_mm  REAL NOT NULL CHECK (net_irrigation_mm >= 0),
  status             TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'edited')),
  explanation        TEXT
);

CREATE INDEX IF NOT EXISTS idx_entitlement_farmer ON entitlement (farmer_id, week_start);
CREATE INDEX IF NOT EXISTS idx_entitlement_status ON entitlement (status, week_start);

CREATE TABLE IF NOT EXISTS release_window (
  id             TEXT PRIMARY KEY,
  canal_id       TEXT NOT NULL REFERENCES canal (id),
  start          TEXT NOT NULL,
  end            TEXT NOT NULL,
  discharge_m3s  REAL NOT NULL CHECK (discharge_m3s > 0),
  CHECK (end > start)
);

CREATE INDEX IF NOT EXISTS idx_release_window_start ON release_window (canal_id, start);

CREATE TABLE IF NOT EXISTS roster (
  id                 TEXT PRIMARY KEY,
  canal_id           TEXT NOT NULL REFERENCES canal (id),
  release_window_id  TEXT NOT NULL REFERENCES release_window (id),
  status             TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'superseded')),
  -- NOTE: the fairness mode (`equal_water` / `equal_hours`) is NOT persisted. The contract's
  -- `Roster` type has no `mode` field and `roster.proposed` does not carry one, so it cannot be
  -- projected from the log. `POST /api/rosters/propose` returns both modes' Gini in its
  -- `comparison` payload; a read-back only sees the turns. Contract gap, raised on issue #2.
  shortfall          TEXT NOT NULL CHECK (json_valid(shortfall)),   -- Record<farmer_id, m3>
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_roster_window ON roster (release_window_id, status);

CREATE TABLE IF NOT EXISTS turn (
  id                 TEXT PRIMARY KEY,
  roster_id          TEXT NOT NULL REFERENCES roster (id),
  outlet_id          TEXT NOT NULL REFERENCES outlet (id),
  farmer_id          TEXT NOT NULL REFERENCES farmer (id),
  start              TEXT NOT NULL,
  end                TEXT NOT NULL,
  planned_volume_m3  REAL NOT NULL CHECK (planned_volume_m3 >= 0),
  expected_flow_m3s  REAL NOT NULL CHECK (expected_flow_m3s >= 0),
  lag_h              REAL NOT NULL CHECK (lag_h >= 0),
  CHECK (end > start)
);

CREATE INDEX IF NOT EXISTS idx_turn_roster  ON turn (roster_id, start);
CREATE INDEX IF NOT EXISTS idx_turn_farmer  ON turn (farmer_id);

CREATE TABLE IF NOT EXISTS request (
  id                   TEXT PRIMARY KEY,
  farmer_id            TEXT NOT NULL REFERENCES farmer (id),
  crop_plan_id         TEXT REFERENCES crop_plan (id),
  type                 TEXT NOT NULL CHECK (type IN ('urgent', 'buffer', 'release_to_buffer', 'harvest_exit')),
  volume_m3            REAL NOT NULL CHECK (volume_m3 >= 0),
  reason               TEXT NOT NULL,
  channel              TEXT NOT NULL CHECK (channel IN ('voice', 'whatsapp', 'sms', 'portal')),
  status               TEXT NOT NULL CHECK (status IN ('raised', 'triaged', 'recommended', 'approved',
                                                       'rejected', 'scheduled', 'released', 'delivered',
                                                       'confirmed', 'cancelled', 'expired')),
  raised_at            TEXT NOT NULL,
  triage_score         REAL CHECK (triage_score IS NULL OR (triage_score >= 0 AND triage_score <= 1)),
  agent_recommendation TEXT CHECK (agent_recommendation IS NULL OR json_valid(agent_recommendation)),
  coordinator_decision TEXT CHECK (coordinator_decision IS NULL OR json_valid(coordinator_decision))
);

CREATE INDEX IF NOT EXISTS idx_request_farmer ON request (farmer_id, raised_at);
CREATE INDEX IF NOT EXISTS idx_request_status ON request (status);

CREATE TABLE IF NOT EXISTS contact (
  id           TEXT PRIMARY KEY,
  farmer_id    TEXT NOT NULL REFERENCES farmer (id),
  channel      TEXT NOT NULL CHECK (channel IN ('voice', 'whatsapp', 'sms', 'portal')),
  purpose      TEXT NOT NULL CHECK (purpose IN ('roster_change', 'release_warning', 'request_update', 'reminder')),
  status       TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'acknowledged', 'failed', 'escalated')),
  attempt      INTEGER NOT NULL CHECK (attempt > 0),
  message_te   TEXT NOT NULL,
  message_en   TEXT NOT NULL,
  at           TEXT NOT NULL,
  transcript   TEXT,
  -- Escalation ladder state: how many times the farmer was contacted before this attempt.
  escalated    INTEGER NOT NULL DEFAULT 0 CHECK (escalated IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_contact_farmer ON contact (farmer_id, at);
CREATE INDEX IF NOT EXISTS idx_contact_status ON contact (status);

-- ---------------------------------------------------------------------------
-- Double-entry volume ledger
-- ---------------------------------------------------------------------------
-- One movement = one row with equal-and-opposite from/to. `season_supply_m3` records the
-- authoritative season volume so checkConservation() can verify mass balance independently of
-- the sum of entries.
CREATE TABLE IF NOT EXISTS ledger_entry (
  id           TEXT PRIMARY KEY,
  at           TEXT NOT NULL,
  from_account TEXT NOT NULL,
  to_account   TEXT NOT NULL,
  volume_m3    REAL NOT NULL CHECK (volume_m3 > 0),
  reason       TEXT NOT NULL,
  event_id     TEXT NOT NULL REFERENCES events (id),
  CHECK (from_account <> to_account)
);

CREATE INDEX IF NOT EXISTS idx_ledger_event    ON ledger_entry (event_id);
CREATE INDEX IF NOT EXISTS idx_ledger_from     ON ledger_entry (from_account);
CREATE INDEX IF NOT EXISTS idx_ledger_to       ON ledger_entry (to_account);
CREATE INDEX IF NOT EXISTS idx_ledger_at       ON ledger_entry (at);

CREATE TABLE IF NOT EXISTS season (
  canal_id            TEXT PRIMARY KEY REFERENCES canal (id),
  season_supply_m3    REAL NOT NULL CHECK (season_supply_m3 >= 0),
  declared_at         TEXT NOT NULL,
  -- Tolerance for checkConservation. ASSUMED: 0.5 m³ — below the resolution of any irrigation
  -- meter, so a larger gap is a real conservation violation rather than float noise.
  tolerance_m3        REAL NOT NULL DEFAULT 0.5
);

-- ---------------------------------------------------------------------------
-- Demo clock and weather cache
-- ---------------------------------------------------------------------------
-- Simulated time. Present so POST /api/demo/advance can move the world forward and so every
-- timestamp in the log is reproducible for the demo and for tests.
CREATE TABLE IF NOT EXISTS clock (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  now    TEXT NOT NULL,
  offset_h REAL NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO clock (id, now, offset_h) VALUES (1, '2026-09-14T00:30:00Z', 0);

-- Raw Open-Meteo responses, cached in KV at runtime; this table keeps the deterministic copy
-- the tests and the offline demo replay from.
CREATE TABLE IF NOT EXISTS weather_day (
  canal_id  TEXT NOT NULL REFERENCES canal (id),
  date      TEXT NOT NULL,
  et0_mm    REAL NOT NULL CHECK (et0_mm >= 0),
  rain_mm   REAL NOT NULL CHECK (rain_mm >= 0),
  tmax_c    REAL,
  tmin_c    REAL,
  PRIMARY KEY (canal_id, date)
);