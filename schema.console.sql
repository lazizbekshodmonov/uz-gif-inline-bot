CREATE TABLE IF NOT EXISTS gifs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL,
  file_unique_id TEXT NOT NULL,
  title TEXT NOT NULL,
  search_key TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  added_by INTEGER,
  added_by_name TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (file_unique_id, search_key)
);
CREATE INDEX IF NOT EXISTS idx_gifs_search ON gifs(search_key);
CREATE INDEX IF NOT EXISTS idx_gifs_uses ON gifs(uses DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_gifs_author ON gifs(added_by, created_at);
CREATE INDEX IF NOT EXISTS idx_gifs_unique ON gifs(file_unique_id);
CREATE TABLE IF NOT EXISTS pending (
  user_id INTEGER PRIMARY KEY,
  file_id TEXT NOT NULL,
  file_unique_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS bans (
  user_id INTEGER PRIMARY KEY,
  reason TEXT,
  banned_at INTEGER NOT NULL DEFAULT (unixepoch())
);
