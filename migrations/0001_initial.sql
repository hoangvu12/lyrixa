CREATE TABLE lyrics (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL DEFAULT '',
  duration REAL,
  lyrics_type TEXT NOT NULL,
  source TEXT NOT NULL,
  provider_track_id TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 1,
  instrumental INTEGER NOT NULL DEFAULT 0,
  lines_json TEXT NOT NULL DEFAULT '[]',
  plain_lyrics TEXT NOT NULL DEFAULT '',
  synced_lyrics TEXT NOT NULL DEFAULT '',
  raw_ttml TEXT,
  raw_lrc TEXT,
  quality_flags_json TEXT NOT NULL DEFAULT '[]',
  cached_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_requested_at INTEGER,
  hit_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE lyrics_keys (
  key TEXT PRIMARY KEY,
  lyrics_id TEXT NOT NULL,
  key_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (lyrics_id) REFERENCES lyrics(id)
);

CREATE TABLE lookup_jobs (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE provider_attempts (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  confidence REAL,
  rejected_reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_lyrics_expires_at ON lyrics(expires_at);
CREATE INDEX idx_lyrics_title_artist ON lyrics(title, artist);
CREATE INDEX idx_provider_attempts_key ON provider_attempts(canonical_key);
CREATE INDEX idx_lookup_jobs_status ON lookup_jobs(status, updated_at);
