-- 0004_call_rate_hit.sql: replace the fixed-window counter with a sliding window of per-call rows.
--
-- Why this migration exists
-- -------------------------
-- 0003 counted calls in one row per (destination, window start). That makes the limit a FIXED window:
-- a burst straddling a window boundary could place max calls in each of two adjacent windows, reaching
-- 2 x max. It also made releaseCall a decrement of a shared counter, which is not a rollback of one
-- call: giving a slot back could hand back a slot another caller had just taken.
--
-- This table stores ONE ROW PER COUNTED CALL. The budget is a COUNT over the rows newer than
-- now - window, and a release deletes exactly one row by id. The consume is still a single statement,
-- so it is still atomic:
--
--   INSERT INTO call_rate_hit (destination, at)
--   SELECT ?1, ?2
--    WHERE (SELECT COUNT(*) FROM call_rate_hit
--            WHERE destination = ?1 AND at > ?2 - ?3) < ?4
--   RETURNING id, (...the same count...) AS n
--
-- The window is measured backwards from each attempt, so it slides: a spent slot frees exactly one
-- window after the call that spent it, not at an arbitrary wall-clock boundary.
--
-- `at` is epoch milliseconds. `id` is the rollback token the guard returns and releaseCall deletes.
-- Additive only: 0003 and its table are left in place; `call_rate_window` is simply no longer read.

CREATE TABLE IF NOT EXISTS call_rate_hit (
  -- The rollback token: identifies the one call a release is undoing. AUTOINCREMENT so an id is never
  -- reused even after a prune, which keeps a stale release from deleting a different caller's slot.
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Destination identity: digits only, so `+91 90000 00001`, `+919000000001` and `tel:+919000000001`
  -- share one budget. Matches `destinationKey()` in `apps/api/src/noloop.ts`.
  destination TEXT    NOT NULL,
  -- The instant of the call, epoch milliseconds. The window is `at > now - windowMs`.
  at          INTEGER NOT NULL
);

-- Serves the guard's sliding count (destination plus an `at` range). Without it the subquery is a
-- full table scan under load.
CREATE INDEX IF NOT EXISTS idx_call_rate_hit_destination_at ON call_rate_hit (destination, at);

-- Serves pruneCallRateHits, which deletes by age across every destination.
CREATE INDEX IF NOT EXISTS idx_call_rate_hit_at ON call_rate_hit (at);
