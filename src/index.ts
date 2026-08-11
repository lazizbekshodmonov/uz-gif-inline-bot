import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import type { InlineQueryResult } from "grammy/types";

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;      // wrangler secret put BOT_TOKEN
  WEBHOOK_SECRET: string; // wrangler secret put WEBHOOK_SECRET
  ADMINS: string;         // vars: "123456789,987654321"
  RESULT_STYLE?: string;  // "list" = nomlar bilan ro'yxat, "grid" = to'r
}

const PAGE_SIZE = 40;        // Telegram bir so'rovga maks 50 ta natija oladi
const DAILY_LIMIT = 15;      // bitta foydalanuvchi bir kunda qo'sha oladigan GIF
const MAX_NAMES = 5;         // bitta GIF uchun maks nom soni
const MAX_TITLE_LEN = 40;

/* ------------------------------------------------------------------ */
/*  O'zbekcha normalizatsiya                                           */
/* ------------------------------------------------------------------ */

const CYR: [RegExp, string][] = [
  [/ш/g, "sh"], [/ч/g, "ch"], [/нг/g, "ng"], [/ё/g, "yo"], [/ю/g, "yu"],
  [/я/g, "ya"], [/ъ/g, "'"], [/ў/g, "o'"], [/ғ/g, "g'"], [/қ/g, "q"],
  [/ҳ/g, "h"], [/а/g, "a"], [/б/g, "b"], [/в/g, "v"], [/г/g, "g"],
  [/д/g, "d"], [/е/g, "e"], [/ж/g, "j"], [/з/g, "z"], [/и/g, "i"],
  [/й/g, "y"], [/к/g, "k"], [/л/g, "l"], [/м/g, "m"], [/н/g, "n"],
  [/о/g, "o"], [/п/g, "p"], [/р/g, "r"], [/с/g, "s"], [/т/g, "t"],
  [/у/g, "u"], [/ф/g, "f"], [/х/g, "x"], [/ц/g, "s"], [/ь/g, ""],
  [/э/g, "e"],
];

/** "Yiqilmoq", "ЙИҚИЛМОҚ", "yiqilmoq'" -> hammasi "yiqilmoq". */
export function normalize(text: string): string {
  let t = text.toLowerCase().trim();
  for (const [re, rep] of CYR) t = t.replace(re, rep);
  t = t.replace(/[\u2018\u2019\u02BB\u02BC`\u00B4']/g, "");
  t = t.replace(/[^\p{L}\p{N}\s]/gu, " ");
  return t.replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/*  Baza                                                               */
/* ------------------------------------------------------------------ */

interface GifRow {
  id: number;
  file_id: string;
  title: string;
  names: string | null; // shu GIF'ning barcha nomlari, vergul bilan
}

const NAMES_SUBQUERY =
  "(SELECT GROUP_CONCAT(t.title, ', ') FROM gifs t " +
  "WHERE t.file_unique_id = g.file_unique_id AND t.status = 'ok') AS names";

/**
 * Bitta GIF bir nechta nom bilan turgani uchun natijalarda takrorlanishi
 * mumkin. Ichki so'rov har bir faylning eng eski yozuvini tanlaydi.
 */
async function searchGifs(db: D1Database, query: string, offset: number): Promise<GifRow[]> {
  const words = normalize(query).split(" ").filter(Boolean);

  if (words.length === 0) {
    const { results } = await db
      .prepare(
        `SELECT g.id, g.file_id, g.title, ${NAMES_SUBQUERY} FROM gifs g
         WHERE g.status = 'ok' AND g.id IN (
           SELECT MIN(id) FROM gifs WHERE status = 'ok' GROUP BY file_unique_id
         )
         ORDER BY g.uses DESC, g.id DESC LIMIT ? OFFSET ?`
      )
      .bind(PAGE_SIZE, offset)
      .all<GifRow>();
    return results ?? [];
  }

  const cond = words.map(() => "search_key LIKE ?").join(" AND ");
  const { results } = await db
    .prepare(
      `SELECT g.id, g.file_id, g.title, ${NAMES_SUBQUERY} FROM gifs g
       WHERE g.status = 'ok' AND g.id IN (
         SELECT MIN(id) FROM gifs WHERE status = 'ok' AND ${cond}
         GROUP BY file_unique_id
       )
       ORDER BY g.uses DESC, g.id DESC LIMIT ? OFFSET ?`
    )
    .bind(...words.map((w) => `%${w}%`), PAGE_SIZE, offset)
    .all<GifRow>();
  return results ?? [];
}

/** Vergul bilan ajratilgan nomlarni alohida yozuv qilib saqlaydi. */
async function saveNames(
  db: D1Database,
  fileId: string,
  uniqueId: string,
  rawTitles: string,
  userId: number,
  userName: string
): Promise<{ added: string[]; duplicate: string[] }> {
  const seen = new Set<string>();
  const titles = rawTitles
    .split(",")
    .map((s) => s.trim().slice(0, MAX_TITLE_LEN))
    .filter((s) => {
      const key = normalize(s);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_NAMES);

  const added: string[] = [];
  const duplicate: string[] = [];

  for (const title of titles) {
    // INSERT OR IGNORE — UNIQUE(file_unique_id, search_key) buzilsa
    // xato bermay o'tkazib yuboradi.
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO gifs
           (file_id, file_unique_id, title, search_key, added_by, added_by_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      )
      .bind(fileId, uniqueId, title, normalize(title), userId, userName)
      .run();

    if (res.meta.changes > 0) added.push(title);
    else duplicate.push(title);
  }

  return { added, duplicate };
}

/* ------------------------------------------------------------------ */
/*  Bot                                                                */
/* ------------------------------------------------------------------ */

let bot: Bot | undefined;
let env: Env;

function adminIds(): number[] {
  return env.ADMINS.split(",").map((x) => Number(x.trim())).filter(Boolean);
}

function isAdmin(userId: number | undefined): boolean {
  return !!userId && adminIds().includes(userId);
}

async function isBanned(userId: number): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS x FROM bans WHERE user_id = ?")
    .bind(userId)
    .first<{ x: number }>();
  return !!row;
}

async function addedToday(userId: number): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM gifs WHERE added_by = ? AND created_at > unixepoch() - 86400"
  )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Yangi GIF haqida adminlarga xabar + moderatsiya tugmalari. */
async function notifyAdmins(fileId: string, uniqueId: string, titles: string[], user: { id: number; name: string }) {
  const kb = new InlineKeyboard()
    .text("✅ Qabul qilish", "ok")
    .row()
    .text("🗑 O'chirish", `rm:${uniqueId}`)
    .text("🚫 Ban", `ban:${user.id}`);

  const caption =
    `🆕 ${titles.join(", ")}\n` +
    `👤 ${user.name} (${user.id})`;

  for (const id of adminIds()) {
    try {
      await bot!.api.sendAnimation(id, fileId, { caption, reply_markup: kb });
    } catch {
      // admin botni bloklagan bo'lishi mumkin — jimgina o'tkazamiz
    }
  }
}

function buildBot(): Bot {
  const b = new Bot(env.BOT_TOKEN);

  /* ---------------------------- inline ---------------------------- */

  b.on("inline_query", async (ctx) => {
    const raw = ctx.inlineQuery.offset;
    const offset = /^\d+$/.test(raw) ? parseInt(raw, 10) : 0;
    const rows = await searchGifs(env.DB, ctx.inlineQuery.query, offset);

    // "list" -> document turi: Telegram ro'yxat ko'rinishida chizadi va
    // sarlavha bilan tavsifni ko'rsatadi.
    // "grid"  -> gif turi: klassik media to'ri, nom ko'rinmaydi.
    const listStyle = (env.RESULT_STYLE ?? "list") === "list";

    const results: InlineQueryResult[] = rows.map((r) =>
      listStyle
        ? {
            type: "document",
            id: String(r.id),
            document_file_id: r.file_id,
            title: r.title,
            description: r.names && r.names !== r.title ? r.names : undefined,
          }
        : {
            type: "gif",
            id: String(r.id),
            gif_file_id: r.file_id,
            title: r.title,
          }
    );

    await ctx.answerInlineQuery(results, {
      cache_time: 10,
      is_personal: true,
      next_offset: rows.length === PAGE_SIZE ? String(offset + PAGE_SIZE) : "",
      button: { text: "➕ O'z GIF'ingizni qo'shing", start_parameter: "add" },
    });
  });

  b.on("chosen_inline_result", async (ctx) => {
    const id = ctx.chosenInlineResult.result_id;
    if (/^\d+$/.test(id)) {
      await env.DB.prepare("UPDATE gifs SET uses = uses + 1 WHERE id = ?").bind(Number(id)).run();
    }
  });

  /* --------------------------- buyruqlar --------------------------- */

  b.command("start", async (ctx) => {
    await ctx.reply(
      `Salom! Bu bot GIF'larni o'zbekcha nomlar bo'yicha izlaydi.\n\n` +
        `🔍 Izlash: istalgan chatda @${ctx.me.username} yiqilmoq\n` +
        `➕ Qo'shish: menga GIF yuboring, nomini so'rayman\n\n` +
        `/mine — o'zim qo'shganlar\n/help — yordam`
    );
  });

  b.command("help", async (ctx) => {
    await ctx.reply(
      `GIF qo'shish:\n` +
        `1. Menga GIF yuboring\n` +
        `2. Nomini yozing. Bir nechta nomni vergul bilan: yiqilmoq, qulamoq\n\n` +
        `Kunlik limit: ${DAILY_LIMIT} ta.\n` +
        `Bir xil GIF + bir xil nom ikki marta saqlanmaydi.\n\n` +
        `/mine — o'zingiz qo'shganlar\n` +
        `/del <id> — o'zingiznikini o'chirish`
    );
  });

  b.command("mine", async (ctx) => {
    const { results } = await env.DB.prepare(
      "SELECT id, title, uses FROM gifs WHERE added_by = ? ORDER BY id DESC LIMIT 30"
    )
      .bind(ctx.from!.id)
      .all<{ id: number; title: string; uses: number }>();

    if (!results?.length) return void (await ctx.reply("Siz hali GIF qo'shmagansiz."));
    await ctx.reply(
      "Siz qo'shganlar:\n" + results.map((r) => `#${r.id} — ${r.title} (${r.uses})`).join("\n")
    );
  });

  b.command("stats", async (ctx) => {
    const row = await env.DB.prepare(
      `SELECT COUNT(DISTINCT file_unique_id) AS files, COUNT(*) AS names,
              COALESCE(SUM(uses), 0) AS u, COUNT(DISTINCT added_by) AS authors
       FROM gifs WHERE status = 'ok'`
    ).first<{ files: number; names: number; u: number; authors: number }>();

    await ctx.reply(
      `📊 ${row?.files ?? 0} ta GIF, ${row?.names ?? 0} ta nom\n` +
        `${row?.authors ?? 0} ta foydalanuvchi qo'shgan\n` +
        `${row?.u ?? 0} marta yuborilgan`
    );
  });

  // Admin istalganini, oddiy foydalanuvchi faqat o'zinikini o'chiradi
  b.command("del", async (ctx) => {
    const arg = ctx.match.trim();
    if (!/^\d+$/.test(arg)) return void (await ctx.reply("Format: /del 12"));

    const sql = isAdmin(ctx.from?.id)
      ? "DELETE FROM gifs WHERE id = ?"
      : "DELETE FROM gifs WHERE id = ? AND added_by = ?";
    const stmt = isAdmin(ctx.from?.id)
      ? env.DB.prepare(sql).bind(Number(arg))
      : env.DB.prepare(sql).bind(Number(arg), ctx.from!.id);

    const res = await stmt.run();
    await ctx.reply(res.meta.changes ? "🗑 O'chirildi." : "Topilmadi yoki sizniki emas.");
  });

  /* ------------------------ GIF qo'shish oqimi ---------------------- */

  b.on("message:animation", async (ctx) => {
    if (ctx.chat.type !== "private") return; // guruhdagi GIF'larni yig'maymiz
    const userId = ctx.from.id;

    if (await isBanned(userId)) return void (await ctx.reply("Siz GIF qo'sha olmaysiz."));

    const n = await addedToday(userId);
    if (n >= DAILY_LIMIT) {
      return void (await ctx.reply(`Kunlik limit tugadi (${DAILY_LIMIT} ta). Ertaga urinib ko'ring.`));
    }

    const { file_id, file_unique_id } = ctx.message.animation;
    const caption = ctx.message.caption?.trim();

    if (caption) {
      await handleNames(ctx, file_id, file_unique_id, caption);
      return;
    }

    await env.DB.prepare(
      `INSERT INTO pending (user_id, file_id, file_unique_id) VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id) DO UPDATE SET file_id = excluded.file_id,
                                          file_unique_id = excluded.file_unique_id`
    )
      .bind(userId, file_id, file_unique_id)
      .run();

    await ctx.reply(
      "Nomini yozing. Bir nechtasini vergul bilan ajrating:\n" +
        "masalan: yiqilmoq, qulamoq, ag'darilmoq"
    );
  });

  b.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private" || ctx.message.text.startsWith("/")) return;

    const p = await env.DB.prepare("SELECT file_id, file_unique_id FROM pending WHERE user_id = ?")
      .bind(ctx.from.id)
      .first<{ file_id: string; file_unique_id: string }>();

    if (!p) return void (await ctx.reply("Avval GIF yuboring."));
    await handleNames(ctx, p.file_id, p.file_unique_id, ctx.message.text);
    await env.DB.prepare("DELETE FROM pending WHERE user_id = ?").bind(ctx.from.id).run();
  });

  async function handleNames(ctx: any, fileId: string, uniqueId: string, raw: string) {
    const user = {
      id: ctx.from.id,
      name: ctx.from.username ? "@" + ctx.from.username : ctx.from.first_name,
    };

    const { added, duplicate } = await saveNames(env.DB, fileId, uniqueId, raw, user.id, user.name);

    if (added.length === 0) {
      const msg = duplicate.length
        ? `Bu GIF allaqachon shu nom bilan bazada bor: ${duplicate.join(", ")}`
        : "Nom bo'sh bo'lmasin.";
      return void (await ctx.reply(msg));
    }

    let msg = `✅ Saqlandi: ${added.join(", ")}`;
    if (duplicate.length) msg += `\n⚠️ Allaqachon bor edi: ${duplicate.join(", ")}`;
    await ctx.reply(msg);

    if (!isAdmin(user.id)) await notifyAdmins(fileId, uniqueId, added, user);
  }

  /* -------------------------- moderatsiya --------------------------- */

  b.on("callback_query:data", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return void (await ctx.answerCallbackQuery("Ruxsat yo'q"));

    const [action, value] = ctx.callbackQuery.data.split(":");

    // Qabul qilish: GIF bazada qoladi, xabar chatdan o'chadi
    if (action === "ok") {
      await ctx.answerCallbackQuery("✅ Qabul qilindi");
      try {
        await ctx.deleteMessage();
      } catch {
        // 48 soatdan eski xabarni bot o'chira olmaydi
        await ctx.editMessageCaption({ caption: "✅ Qabul qilindi" });
      }
      return;
    }

    if (action === "rm") {
      const res = await env.DB.prepare("DELETE FROM gifs WHERE file_unique_id = ?")
        .bind(value)
        .run();
      await ctx.answerCallbackQuery(`${res.meta.changes} ta yozuv o'chirildi`);
      try {
        await ctx.deleteMessage();
      } catch {
        await ctx.editMessageCaption({ caption: "🗑 O'chirildi" });
      }
      return;
    }

    if (action === "ban") {
      const uid = Number(value);
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO bans (user_id) VALUES (?)").bind(uid),
        env.DB.prepare("DELETE FROM gifs WHERE added_by = ?").bind(uid),
      ]);
      await ctx.answerCallbackQuery("Bloklandi, GIF'lari o'chirildi");
      await ctx.editMessageCaption({ caption: `🚫 ${uid} bloklandi` });
      return;
    }

    await ctx.answerCallbackQuery();
  });

  return b;
}

/* ------------------------------------------------------------------ */
/*  Worker kirish nuqtasi                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request: Request, workerEnv: Env): Promise<Response> {
    env = workerEnv;

    // Diagnostika: bot qurilishidan OLDIN javob beramiz, aks holda
    // BOT_TOKEN yo'q bo'lsa grammY istisno tashlaydi va 1101 chiqadi.
    if (request.method !== "POST") {
      const status = {
        BOT_TOKEN: env.BOT_TOKEN ? "bor" : "YO'Q",
        WEBHOOK_SECRET: env.WEBHOOK_SECRET ? "bor" : "YO'Q",
        ADMINS: env.ADMINS || "YO'Q",
        DB: env.DB ? "ulangan" : "YO'Q",
      };
      const hammasi = !!(env.BOT_TOKEN && env.WEBHOOK_SECRET && env.DB);
      return new Response(
        (hammasi ? "gif-bot ishlayapti\n\n" : "SOZLAMA TO'LIQ EMAS\n\n") +
          JSON.stringify(status, null, 2),
        { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    if (!env.BOT_TOKEN) {
      console.error("BOT_TOKEN secret o'rnatilmagan");
      return new Response("ok", { status: 200 });
    }

    try {
      if (!bot) bot = buildBot();
      const handle = webhookCallback(bot, "cloudflare-mod", {
        secretToken: env.WEBHOOK_SECRET,
      });
      return await handle(request);
    } catch (err) {
      // Telegram 200 olmasa, update'ni qayta-qayta yuboraveradi.
      console.error("Worker xatosi:", err instanceof Error ? err.stack : err);
      return new Response("ok", { status: 200 });
    }
  },
};
