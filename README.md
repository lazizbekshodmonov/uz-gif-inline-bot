# uz-gif-inline-bot

[![Bot](https://img.shields.io/badge/Telegram-%40gifizlabot-2AABEE?logo=telegram&logoColor=white)](https://t.me/gifizlabot)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

O'zbekcha harakat nomlari bo'yicha GIF izlaydigan inline Telegram bot.
Cloudflare Workers + D1 ustida ishlaydi — bepul rejada, uxlab qolmasdan.

**Ishlab turgan bot:** [@gifizlabot](https://t.me/gifizlabot)

Istalgan chatda `@gifizlabot yiqilmoq` deb yozasiz va kerakli GIF chiqadi.
Bot guruhga qo'shilishi shart emas.

## Imkoniyatlar

- **Inline qidiruv** — har qanday guruh yoki shaxsiy chatda ishlaydi
- **Ochiq to'plam** — har bir foydalanuvchi GIF qo'sha oladi
- **O'zbekcha normalizatsiya** — kirill/lotin va apostrof turlari (`o'`, `oʻ`, `o\``) bir xil qidiriladi
- **Ko'p nomli GIF** — bitta GIF `yiqilmoq`, `qulamoq`, `ag'darilmoq` deb izlansa ham topiladi
- **Moderatsiya** — har yangi GIF adminlarga o'chirish/ban tugmalari bilan yuboriladi
- **Kunlik limit** — spamdan himoya

## Texnologiya

| Qism | Nima ishlatilgan |
|------|------------------|
| Runtime | Cloudflare Workers |
| Baza | Cloudflare D1 (SQLite) |
| Kutubxona | grammY |
| Til | TypeScript |

## O'rnatish

### 1. BotFather

```
/newbot              -> token oling
/setinline           -> placeholder: "harakat nomini yozing..."
/setinlinefeedback   -> Enabled
```

### 2. Loyihani tayyorlash

```bash
git clone https://github.com/lazizbekshodmonov/uz-gif-inline-bot.git
cd uz-gif-inline-bot
npm install
npx wrangler login
```

### 3. Baza

```bash
npm run db:create      # qaytgan UUID'ni wrangler.jsonc ga qo'ying
npm run db:init
```

### 4. Kalitlar

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET     # openssl rand -hex 16
```

`wrangler.jsonc` ichidagi `ADMINS` ga Telegram ID'ingizni yozing (@userinfobot).

### 5. Deploy va webhook

```bash
npm run deploy
```

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://gif-bot.<sub>.workers.dev/" \
  -d "secret_token=<WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message","inline_query","chosen_inline_result","callback_query"]'
```

> `allowed_updates` ni ko'rsatish majburiy — aks holda moderatsiya tugmalari
> va statistika ishlamaydi.

Tekshirish: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`

## Env qiymatlari

| Nom | Turi | Qayerda | Repoga tushadimi |
|-----|------|---------|------------------|
| `BOT_TOKEN` | secret | Cloudflare Secrets | ❌ |
| `WEBHOOK_SECRET` | secret | Cloudflare Secrets | ❌ |
| `ADMINS` | var | `wrangler.jsonc` | ✅ |
| `DB` | binding | `wrangler.jsonc` | ✅ |

Lokal sinov uchun `.dev.vars.example` ni `.dev.vars` deb nusxalang.

## Buyruqlar

| Buyruq | Kim uchun |
|--------|-----------|
| `/start`, `/help` | hamma |
| `/mine` | o'zi qo'shgan GIF'lar |
| `/del <id>` | o'zinikini o'chirish (admin — istalganini) |
| `/stats` | umumiy statistika |

## Baza mantig'i

Unikallik `UNIQUE (file_unique_id, search_key)` juftligi bo'yicha:

- bitta GIF **bir nechta nom** bilan tura oladi
- bitta nom **bir nechta GIF**ga tegishli bo'la oladi
- aynan bir xil juftlik ikki marta saqlanmaydi

`file_id` emas, `file_unique_id` ishlatiladi — birinchisi bir xil fayl uchun
ham har xil kelishi mumkin. `title` emas, `search_key` — aks holda
"Yiqilmoq" va "yiqilmoq'" alohida yozuv bo'lib qolardi.

## Eslatmalar

**Zaxira.** GIF fayllari Telegram serverida, lekin `file_id` va o'zbekcha
nomlar D1'da. Vaqti-vaqti bilan `npm run db:backup`.

**`file_id` bot tokeniga bog'langan.** Token qayta yaratilsa, eski
`file_id`'lar ishlamay qoladi.

**Limitlar.** Workers: 100 000 so'rov/kun. D1: 5 mln satr o'qish, 100 000 satr
yozish, 5 GB. Bir necha ming GIF uchun ortig'i bilan yetadi.

**Qidiruv `LIKE` orqali.** GIF soni 5000 dan oshsa, FTS5 ga o'ting.

## Litsenziya

MIT
