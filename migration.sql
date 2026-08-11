-- Mavjud bazani yangi sxemaga o'tkazish.
--   wrangler d1 execute gifs --remote --file=./migration.sql
--
-- SQLite'da UNIQUE cheklovini olib tashlab bo'lmaydi, shuning uchun
-- jadval qayta quriladi. Oldin zaxira oling:
--   wrangler d1 export gifs --remote --output=./backup.sql

PRAGMA foreign_keys = OFF;

CREATE TABLE gifs_new (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id        TEXT    NOT NULL,
    file_unique_id TEXT    NOT NULL,
    title          TEXT    NOT NULL,
    search_key     TEXT    NOT NULL,
    uses           INTEGER NOT NULL DEFAULT 0,
    added_by       INTEGER,
    added_by_name  TEXT,
    status         TEXT    NOT NULL DEFAULT 'ok',
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (file_unique_id, search_key)
);

INSERT INTO gifs_new (id, file_id, file_unique_id, title, search_key, uses, added_by, created_at)
SELECT id, file_id, file_unique_id, title, search_key, uses, added_by,
       CAST(strftime('%s', COALESCE(created_at, CURRENT_TIMESTAMP)) AS INTEGER)
FROM gifs;

DROP TABLE gifs;
ALTER TABLE gifs_new RENAME TO gifs;

CREATE INDEX IF NOT EXISTS idx_gifs_search  ON gifs(search_key);
CREATE INDEX IF NOT EXISTS idx_gifs_uses    ON gifs(uses DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_gifs_author  ON gifs(added_by, created_at);
CREATE INDEX IF NOT EXISTS idx_gifs_unique  ON gifs(file_unique_id);

CREATE TABLE IF NOT EXISTS bans (
    user_id   INTEGER PRIMARY KEY,
    reason    TEXT,
    banned_at INTEGER NOT NULL DEFAULT (unixepoch())
);

PRAGMA foreign_keys = ON;
