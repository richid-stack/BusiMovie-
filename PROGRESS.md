# BusiMovie — progress & handoff

Branch: `claude/audit-fixes` (GitHub `richid-stack/BusiMovie-`). Plan: `implementation_plan.md` in the Claude project ("busimovie").
Run: `npm i && npm run dev` · Tests: `npm test` (41 passing) · Typecheck: `npx tsc --noEmit` (clean).
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

## Next (see plan §6)
1. **Phase 2** — Turso as the only store; drop Firestore + JSON mirrors; `callback_cache` TTL; close Firestore rules; ephemeral-delete allowlist (L12).
2. **Phase 3** — crawler engine: screen classifier + gate handler, per-bot profiles, bounded navigator, Gemini fallback "eye", optional mirror mode, `crawl_jobs` queue with failover, Quinson blueprint + pagination, full-season delivery "as they arrive", trace viewer.
3. **Phase 4–5** — finish storefront (views counter for Top 10, real backdrops) and redesign the admin (3157-line AdminDashboard).
4. **Phase 6** — single lockfile, PWA name/icons (still "Telegram Movie Vault"), README.
5. Three original wordmark options for Richie to pick from (current one is a placeholder).

## Do these yourself
- Rotate/revoke the Telegram userbot session that was committed earlier; purge it from git history.
- Set secrets in AI Studio: `ADMIN_PASSWORD`, `ADMIN_TELEGRAM_IDS`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TELEGRAM_USER_SESSION` (the session is no longer mirrored anywhere).
- Close the Firestore rules only after Turso is configured (boot-time restore still reads Firestore until Phase 2).
