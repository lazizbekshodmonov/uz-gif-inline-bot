-- YANGI O'RNATISH uchun. Mavjud baza bo'lsa migration.sql dan foydalaning.
--   wrangler d1 execute gifs --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS gifs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id        TEXT    NOT NULL,          -- Telegram file_id (shu bot uchun)
    file_unique_id TEXT    NOT NULL,          -- fayl o'zgarmas identifikatori
    title          TEXT    NOT NULL,          -- ko'rinadigan nom
    search_key     TEXT    NOT NULL,          -- normallashtirilgan nom
    uses           INTEGER NOT NULL DEFAULT 0,
    added_by       INTEGER,
    added_by_name  TEXT,
    status         TEXT    NOT NULL DEFAULT 'ok',   -- 'ok' | 'hidden'
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),

    -- MUHIM: unique juftlik bo'yicha, ya'ni bitta GIF bir nechta nom bilan
    -- turishi mumkin, lekin bir xil nom ikki marta yozilmaydi.
    -- search_key ishlatiladi (title emas), aks holda "Yiqilmoq" va
    -- "yiqilmoq'" alohida yozuv bo'lib qolardi.
    UNIQUE (file_unique_id, search_key)
);

CREATE INDEX IF NOT EXISTS idx_gifs_search  ON gifs(search_key);
CREATE INDEX IF NOT EXISTS idx_gifs_uses    ON gifs(uses DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_gifs_author  ON gifs(added_by, created_at);
CREATE INDEX IF NOT EXISTS idx_gifs_unique  ON gifs(file_unique_id);

-- "GIF yuborildi, nom kutilyapti" holati (Worker xotira saqlamaydi)
CREATE TABLE IF NOT EXISTS pending (
    user_id        INTEGER PRIMARY KEY,
    file_id        TEXT NOT NULL,
    file_unique_id TEXT NOT NULL,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Bloklangan foydalanuvchilar
CREATE TABLE IF NOT EXISTS bans (
    user_id   INTEGER PRIMARY KEY,
    reason    TEXT,
    banned_at INTEGER NOT NULL DEFAULT (unixepoch())
);
