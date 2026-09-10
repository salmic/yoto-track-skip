CREATE TABLE IF NOT EXISTS skip_profiles (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL UNIQUE,
  card_title TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  skip_track_keys TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_cache (
  card_id TEXT PRIMARY KEY,
  content_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  card_id TEXT NOT NULL,
  card_title TEXT NOT NULL,
  skipped_track_key TEXT NOT NULL,
  skipped_track_title TEXT NOT NULL,
  jumped_to_track_key TEXT NOT NULL,
  jumped_to_track_title TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp DESC);
