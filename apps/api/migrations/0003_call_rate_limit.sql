-- 0003_call_rate_limit.sql: the outbound-call counter, in D1, so it can be incremented atomically.
--
-- Why this migration exists
-- -------------------------
-- The rate-limit guard (`apps/api/src/noloop.ts`) shipped with its counter in KV. KV has no atomic
-- increment, so two callers that read the same counter in the same instant both wrote `1` and both
-- were allowed: N simultaneous `POST /api/alerts` requests all dialled, and repeated rapid button
-- presses produced a continuous stream of calls. That is the reported defect, and it is a property of
-- the store, not of the guard's arithmetic — it cannot be fixed with a better read-then-write.
--
-- D1 is SQLite. A single `INSERT ... ON CONFLICT DO UPDATE ... WHERE n < ?` is one statement executed
-- inside one SQLite write transaction, so the check and the increment cannot interleave with another
-- request's. D1 is already bound as `env.DB` and already required for the app to function, so this
-- adds no binding and no new dependency.
--
-- Shape
-- -----
-- One row per (destination digits, window). Two counters are kept per row on purpose:
--
--   * `n`       — calls counted in THIS window. The budget is `n < max`, enforced in the statement.
--   * `not_live`— calls counted for the PREVIOUS window of the same destination. It exists so that a
--                 refusal can name the instant the window frees up (`retryAfterAt`) without a second
--                 store read and without a row for an expired window having to survive.
--
-- Keying by the window start rather than by "one row per destination, reset in place" is what makes
-- the table self-limiting: a burst that spans a window boundary writes one extra row per boundary and
-- nothing else. No scheduled prune is required for the table to stay bounded — see the guard's
-- docstring in `apps/api/src/noloop.ts` for the full argument, and
-- `pruneCallRateWindows` for the opportunistic delete that keeps the boundary rows from accumulating
-- across a long-lived database.
--
-- Additive only: no existing table is created, altered or dropped.

CREATE TABLE IF NOT EXISTS call_rate_window (
  -- Destination identity: digits only, so `+91 90000 00001`, `+919000000001` and `tel:+919000000001`
  -- share one budget. Matches `destinationKey()` in `apps/api/src/noloop.ts`.
  destination  TEXT    NOT NULL,
  -- Window start, as epoch milliseconds, floored to the window: `key = floor(now / (window*1000))`.
  -- Nothing absolute is stored because the window length is a runtime env var that an operator may
  -- change during an incident; the instant is reconstructed as `key * window * 1000`.
  window_key   INTEGER NOT NULL,
  -- Calls counted in this window. Incremented ONLY by the guard's single atomic statement.
  n            INTEGER NOT NULL DEFAULT 0 CHECK (n >= 0),
  -- Calls counted in the immediately preceding window of this destination, frozen at the moment this
  -- row was created. Used only to report `retryAfterAt`.
  not_live     INTEGER NOT NULL DEFAULT 0 CHECK (not_live >= 0),
  PRIMARY KEY (destination, window_key)
) WITHOUT ROWID;

-- The primary key already indexes (destination, window_key) and therefore serves the guard's single
-- lookup by exact key. This second index serves `pruneCallRateWindows`, which deletes by age across
-- every destination, and any operator query of the shape "what is this handset's recent history".
CREATE INDEX IF NOT EXISTS idx_call_rate_window_key ON call_rate_window (window_key);
