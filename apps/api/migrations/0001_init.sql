-- 0001_init.sql: Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);
