# BusiMovie

A Telegram bot and a Netflix-style web storefront for movies and series. Viewers browse on the site (or in the bot), tap **Watch**, and the file is delivered to them in Telegram. A background crawler fetches missing titles from external Telegram bots into your private vault channels.

## How it fits together

| Part | Where | What it does |
|---|---|---|
| Storefront | `src/storefront`, `src/pages/UserStorefront.tsx` | Public site: billboard, rows, search, "request this title". No file URLs are ever exposed; Play opens the bot. |
| Admin console | `/admin` (`src/pages/AdminDashboard.tsx`) | Library, requests, crawler, broadcasts. Login with `ADMIN_PASSWORD` or Telegram Login. |
| Bot | `src/bot` | Search, requests, season/episode pickers, delivery (copies the file from the vault; deleted after 2 minutes). All wording lives in `src/bot/messages.ts`. |
| Crawler | `src/crawler` | Walks external bots' screens to a file, verifies it, stores it in the vault. See below. |
| Database | `src/db` | SQLite/libsql. Use Turso in production (hosted disks are ephemeral). |

### The crawler in one paragraph
Everything that needs a file goes into one durable queue (`crawl_jobs`): viewer requests, admin clicks, CSV/cron batches. One worker takes jobs (user > admin > cron) and tries each suitable bot in priority order. For each bot it reads the screen the bot is showing, classifies it (results, quality, seasons, episodes, join-gate, throttled, empty, still-searching, file), and presses only a confidently matching button. The file that arrives is checked against the request (title, year, season, episode), forwarded to the vault, the exact vault message id is confirmed, and only then is it indexed. Every attempt leaves a step-by-step trace for 7 days (`GET /api/crawler/jobs/:id`, or the Crawl Jobs panel in the admin). When the rules cannot decide a screen and `GEMINI_API_KEY` is set, Gemini may suggest a button; its suggestion is checked like any other.

## Run it

```bash
npm install
cp .env.example .env   # fill in the values below
npm run dev            # http://localhost:3000
npm test               # crawler, parser, database tests
npx tsc --noEmit       # typecheck
```

Design preview with demo data (no database needed): `/?demo=1` (add `&nosplash` to skip the intro).

## Environment variables

| Variable | Needed for |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the bot (required) |
| `ADMIN_PASSWORD`, `ADMIN_TELEGRAM_IDS`, `SESSION_SECRET` | admin login and admin bot commands |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | persistent database (without them a local file is used and is lost on redeploy) |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_USER_SESSION` | the crawler's Telegram account |
| `TELEGRAM_VAULT_CHANNEL_ID`, `TELEGRAM_SERIES_VAULT_CHANNEL_ID` | where files are stored (can also be set in the admin) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | recommendations and the crawler's AI advisor (optional) |
| `TMDB_API_KEY`, `OMDB_API_KEY` | richer metadata (optional) |
| `DAILY_REQUEST_LIMIT` | requests per viewer per day (default 5) |
| `APP_URL` | public URL for the webhook |

## Polling vs webhook
In development the bot uses long polling. When the app is published (a public `APP_URL`), it switches to a webhook, protected by a secret token. Both are kept.

## Deploy
`npm run build` then `npm start` (port 3000). On Cloud Run / AI Studio set the variables above as secrets, and always set `TURSO_*` so data survives restarts.
