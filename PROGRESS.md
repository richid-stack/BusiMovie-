# BusiMovie — progress & handoff

Branch: `claude/audit-fixes` (GitHub `richid-stack/BusiMovie-`). Plan: `implementation_plan.md` in the Claude project ("busimovie").
Run: `npm i && npm run dev` · Tests: `npm test` (73 passing) · Typecheck: `npx tsc --noEmit` (clean).
Storefront design preview with demo data: open `/?demo=1` (add `&nosplash` to skip the splash).

## Done
**Phase 0 — lock-down** (commit 68ec3bd)
- Every `/api` route is admin-only unless listed in `PUBLIC_ROUTES` (src/server/auth.ts). Admin login = password (`ADMIN_PASSWORD`) or Telegram Login (`ADMIN_TELEGRAM_IDS`).
- Telegram webhook verified with a secret token. Bot `/broadcast`, `/stats` and DM indexing are admin-only.
- Public API no longer leaks internal ids / file ids / bot token links. Secrets are no longer mirrored to Firestore/JSON.
- Torrent + arr code and dependencies removed. Live Telegram session scrubbed from `settings_backup.json`; backups gitignored.
- Turso (hosted libsql) supported via `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`; `DISABLE_FIRESTORE=1` to run on one database.

**Phase 1 — stop the wrong files** (commits d4da8cb, 223a3c4)
- One canonical parser (`src/services/seriesParser.ts`); the bot, DB and CSV importer all delegate to it. Fixes digit titles (300, 1917, 2012), "Blade Runner 2049", commas in titles.
- CSV queue no longer deletes rows; dedupe is by title + year; vault duplicate check respects year.
- Button matcher refuses to guess (no "first button" fallback, never a Back button); nav detection no longer eats titles like "Home Alone".
- Verification gate: a downloaded file is compared with the request (title / year / season / episode) before it is forwarded.
- No blind index clicks, no "latest vault message" id guesses, no fake E1 fallback, no invented 1–8 episode list or fake Season 1.
- Boot no longer forces search bots inactive. One request limit (`DAILY_REQUEST_LIMIT`, default 5). Notifications match titles exactly.
- All bot copy lives in `src/bot/messages.ts` (no channel ids, bot names, "relay" jargon, fake progress, or raw errors).

**Phase 4 (started) — storefront** (commit 8f2ca8f)
- New Netflix-style storefront in `src/storefront/*` + `src/pages/UserStorefront.tsx`: grain-gradient splash, rotating billboard, rows, Top 10 (only once view counts exist), My List, "pick up where you left off", detail popup (episodes / versions), search with "request this title", mobile bottom nav. Fonts are bundled (no Google Fonts).
- Play opens the Telegram bot deep link (the site never exposes file URLs).

**Phase 2 — one database** (commit 910daa8)
- Firestore and every JSON mirror removed. SQLite/libsql (Turso in production) is the only store. `callback_cache` has a TTL and a purge; button/title caches persist with random keys; ephemeral 2-minute deletion only applies to delivered media.

**Phase 3 — crawler engine** (commits up to b0b7114) — code in `src/crawler/`
- `screen.ts` / `classify.ts`: the bot's current screen (text, buttons, file) is read and classified: results list, quality list, seasons, episodes, join-gate, throttled, empty, "still searching", file.
- `navigator.ts`: bounded walk (≤7 steps, loop detection, pagination, waits for edited messages). Every click is confidence-gated; Back/ads/join links are never pressed; a wrong film or wrong file is rejected. When rules cannot decide, an AI advisor (`geminiAdvisor.ts`) may suggest a button; the suggestion is safety-checked and the file is verified anyway.
- Join-gates: joins required channels (invite links, @names; never bots), presses "I joined", continues; gives up cleanly as `needs_admin`.
- `gramTransport.ts`: event-driven (new + edited messages), callback answers, flood-wait handling, pacing; `vault.ts`: forwards to the vault and confirms the exact vault message id before indexing (no guessing).
- `jobs.ts`: durable `crawl_jobs` queue (user > admin > cron, identical requests share one job, restart-safe) and `crawl_traces` (7-day retention, one step-by-step trace per bot attempt).
- `engine.ts`: per-job failover across all suitable bots including acquisition; movies never use series bots and vice versa; rate-limited bots cool down.
- `season.ts`: whole-season delivery — takes files as they arrive, numbers episodes from the file name, skips episodes already held, stops at the expected count or after the bot goes quiet; the bot then sends the full season in order with a real progress message.
- `browse.ts`: season/episode lists with pagination and a 24h `series_blueprint` cache.
- The bot (movie, episode, season), the web request route, the admin "fetch now" and the CSV/cron indexer all use this one engine. Old Quinson/dispatch code was deleted. Admin API: `GET /api/crawler/jobs`, `GET /api/crawler/jobs/:id` (job + traces).
- Tested with scripted fake bots (Delta-like, Apple-like, Quinson-like, gates, empty, throttled, loops, wrong file, pagination). **Not yet verified against the real external bots** — first live run needs the Telegram session; check the trace of the first few jobs.
- Not built (by choice, small value for now): "mirror mode" (re-skinning the external bot's options for the viewer) and persistent learned rules for the AI advisor. The old manual "Search Bot Playground" endpoints still use the legacy helpers.

**Phase 5 (partly) — admin**
- New **Crawl Jobs** tab (`src/pages/admin/CrawlJobs.tsx`): job list with filters, and a side panel with the step-by-step trace per bot (what the bot showed, what was pressed, why) plus "Try again". The rest of the 3,100-line admin is not yet split or redesigned.

**Phase 6 — hygiene**
- One lockfile (`package-lock.json`), package renamed `busimovie`, stray test scripts and the old AI Studio plan removed.
- Real app icons (they were mislabelled SVGs), PWA manifest now "BusiMovie" with ink/ember colours, README rewritten, `GEMINI_MODEL` setting (default `gemini-flash-latest`), `.env.example` cleaned (no Radarr/Sonarr).

## Next (see plan §6)
1. Pick one of the three wordmarks (shared separately) and I apply it to the splash, nav, favicon and PWA icon.
2. Finish the storefront (view counter for Top 10, real backdrops) and split/redesign the rest of the admin.
3. First live crawler run: read the traces of the first jobs and tune per-bot behaviour.

## Do these yourself
- Rotate/revoke the Telegram userbot session that was committed earlier; purge it from git history.
- Set secrets in AI Studio: `ADMIN_PASSWORD`, `ADMIN_TELEGRAM_IDS`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TELEGRAM_USER_SESSION` (the session is no longer mirrored anywhere).
- Firestore is no longer used at all; you can delete the Firestore database / rules in the Firebase console.
- Optional: `GEMINI_API_KEY` (and `GEMINI_MODEL`) enables the AI advisor for unfamiliar bot screens.
