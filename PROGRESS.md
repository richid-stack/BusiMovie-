# BusiMovie — progress & handoff

Branch: `claude/audit-fixes` (GitHub `richid-stack/BusiMovie-`). Plan: `implementation_plan.md` in the Claude project ("busimovie").
Run: `npm i && npm run dev` · Tests: `npm test` (136 passing) · Typecheck: `npx tsc --noEmit` (clean).
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

**Phase 5 — admin console** (rebuilt, `src/admin/`)
- Old 3,100-line dashboard deleted. New sidebar console at `/admin/*` (mobile: top bar + sheet; `Ctrl/⌘ K` jump palette) with a small shared design system (`src/admin/ui/`: buttons, badges, cards, tables, drawers, confirm dialogs, toasts, empty states, charts) and react-query for data. Ember gradient is used only for the one main action per screen and the active-nav marker; status colours are separate.
- Pages: **Overview** (needs-attention list, stats, files-added chart, crawler results), **Library** (movies/series grouped, search, expandable episodes, add/remove file, export, re-check series), **Requests** (fetch now / mark ready), **Crawl jobs** (filters + trace drawer + try again), **Search bots** (add/edit/enable, per-bot scope movies/series/both, test drawer with press-a-button), **Source channels** (add from joined channels, watch toggle, backfill, activity), **Batch import** (CSV/TXT/MD/TSV/PDF or paste, scheduler settings, queue, emergency stop), **Connections** (bot webhook/polling, database, userbot sign-in or session string, vault channels), **Messaging** (announcement, spotlight).
- Every old admin feature is kept; `window.confirm/alert` replaced by in-app dialogs and toasts. Tables hide secondary columns on phones.

**Storefront Top 10** — anonymous per-title weekly view counter (`src/db/views.ts`, `POST /api/library/view`, de-duplicated per viewer per 30 min and rate limited); `/api/library` returns `views`, so "Top 10 this week" appears once titles are opened.

**Quality policy** (`src/crawler/quality.ts`, `settings.ts`)
- Keep every quality so the viewer chooses (720p is the smaller download). Anything below 720p is never accepted, and 4K is not wanted: both are rejected in the navigator, the season collector, `acquire` and channel ingest. Quality is read from the video's width/height first, then the file name; unknown is allowed through and labelled with the asked quality (or "HD").
- Two qualities per title: setting `second_quality` (Admin → Search bots → Quality): `off` / `requested` (default) / `all`. After a title is saved, a quiet companion job (source `companion`, cron priority, one try per title+quality, never merged with viewer jobs, no user notification) asks for the missing 1080p↔720p tier. Batch imports queue a companion for titles already held when the mode is `all`.

**Live channel watching** (`src/crawler/channels.ts`, `ingest.ts`)
- Source channels are watched live (new-message listener, reconcile every 5 min and whenever targets change), with catch-up from `last_seen_id` after downtime. Every post goes through one sequential ingest path (mutex + 1.5 s pacer, `channel_ingest` idempotency): quality gate, min size, generic-name skip, dedupe, vault copy, index. Sources page shows Live / error / paused, saved vs skipped (with top skip reason), a quality filter and a backfill of 20–1000 posts (over 100 runs in the background).

**Series wishlist** (`src/crawler/wishlist.ts`, Admin → Batch import → Series wishlist)
- Ask for a show as everything, everything + new episodes (follows it, re-checks every 12 h) or chosen seasons. A runner (every 3 min, one show at a time) asks the series bot for the seasons and episodes (cached 24 h), compares with what the library holds, and submits one season job at a time (source `wishlist`, cron priority). A season is left alone for 6 h after a failure and after 3 tries in 24 h; a show pauses after 8 empty lookups. Progress (held / offered per season), status and a plain-English note are shown per show; pause, check now, remove.
- Batch lists accept series lines: "Severance S2", "Dark S1-S3", "Breaking Bad complete series", "series: Succession", "Show (series)". They go to the wishlist; other lines stay in the movie queue.
- API: `GET/POST /api/crawler/wishlist`, `PUT/DELETE /api/crawler/wishlist/:id`, `POST /api/crawler/wishlist/:id/run`.

**Hang protection** (`src/crawler/lock.ts`, `engine.ts`, `service.ts`)
- Every conversation with a bot has a hard ceiling (movie 4 min, episode 8, season 25) and every whole job too (15 / 25 / 45 min). A stalled Telegram call is cut off, the connection closed, the next bot tried and the queue moves on. Jobs stuck "running" for over an hour are swept to failed. `/api/status` returns `worker` health (current job, stalled, failure streak); the admin Overview shows it.
- The previous author's hard-coded vault channel ids are gone. With no storage channel set, the crawler says so in plain words (Admin → Connections); series fall back to the movie vault.

**Alerts and admin from Telegram** (`src/services/alerts.ts`, `src/bot/adminCommands.ts`)
- Admins (`ADMIN_TELEGRAM_IDS`, after pressing Start once) get a Telegram message for: a stuck/timed-out job, a job that needs you (bot wants something the crawler can't do), 5 failures in a row, the userbot signed out, a required channel the bot can't read. Identical alerts are rate limited.
- Admin-only commands: `/admin`, `/health`, `/queue`, `/fetch <title>` (you're messaged when it's done), `/wish <title> [S1-S3|follow]`, `/wishlist`, `/requests` (grouped, with Fetch / Ready buttons that tell every requester), `/gate` (on/off).

**Required channels / join gate** (`src/bot/gate.ts`, `gateFlow.ts`, Admin → Required channels)
- List your discussion channel, a community group or sponsor/ad channels. Before a file is delivered (Watch, episode, season, deep link) a viewer who isn't in them sees one Join button per channel plus "I've joined", and their request is remembered. The moment they join (Telegram `chat_member` update, a join-request approval, or the button) the remembered request is completed in their chat automatically (a pressed button is replayed, so it behaves exactly as if they had tapped it again). Telegram cannot move a user's screen; they get the file as a message plus a "Thanks for joining" note.
- Needs the bot to be an admin of each channel (invite-users permission). Admins are never gated; browsing/searching is never gated; a channel the bot can't read never blocks anyone (admin is alerted). Join style "open" or "join request" (bot approves). Recheck window 1h–1w. Stats: asked / joined / completed automatically / waiting.

**Viewer features** (`src/bot/viewerFeatures.ts`, `follow.ts`, `prefs.ts`, `reports.ts`)
- After every delivery a small follow-up message: ⏭ Next episode, 💿 the other quality, 🔔 follow the series, ⚠️ wrong file.
- Follow a series: one message when new episodes land; a whole season arriving is one message. `/following` to manage.
- Wrong-file report: an admin gets Remove & re-fetch / Keep buttons; 3 different viewers (or an admin) removes the copy, queues a repair job at admin priority and tells the reporters when it lands. The exact file is remembered in the blocklist so a re-fetch can't bring the same copy back.
- `/quality`: ask each time / best quality / smaller download.
- Demand-first queue: when several viewers ask for the same title, it jumps ahead of less-wanted jobs of the same priority.

**Inline mode and groups** (`src/bot/discovery.ts`, `reach.ts`)
- `@bot title` in any chat searches the library first (then metadata) with a Watch/Request button; an empty query shows recent additions.
- Add the bot to a group (button in the welcome message). In groups it answers `/movie`, `/search`, `@bot title` and replies to it; plain chat is ignored; one answer per 3 s; every result is a button that opens the title in a private chat, so files are never dropped into a group. Admin commands still work there.

**Round 3 — caveats closed, safety, resilience, discovery**
- *Legacy crawler retired.* The Search-bots playground and "forward" button now run on the new engine (`probeBot`, `pressBotButton` in `src/crawler/service.ts`); the old ~2,000-line legacy search/forward code is deleted (`crawlerService.ts` keeps only login/session, targets/bots CRUD, logging and the CSV batch queue).
- *Blocklist* (`src/crawler/blocklist.ts`). Reported or removed files are remembered by file name + size (±1%); taken-down titles by normalised title (+year). Checked when a bot file is about to be stored, when a source channel post is ingested, when the vault is rebuilt, and before a job runs. Admin → Safety lists it with a Lift button.
- *Takedown* (`src/services/moderation.ts`, Admin → Safety, `/takedown <title>` in Telegram with a confirm button): deletes every file of the title, deletes the vault copies through the userbot (best effort, failures are reported), cancels its queued jobs, pauses wishlist entries, blocks it for good.
- *Abuse controls:* ban / unban by id or @username (banned viewers get nothing; admins can't be banned) and a per-viewer daily file cap (0 = off, resets 00:00 UTC, refunded when a delivery fails, admins exempt). Admin → Safety, `/ban`, `/unban`, `/cap`.
- *Bot health auto-pause* (`src/crawler/botHealth.ts`): judged from the job traces. A bot whose last 4 meaningful attempts all broke (≥5 of the last 8) is skipped for ~3 h, you get a Telegram alert, and it gets one probation try afterwards; a success clears it. "Not found" and "wrong file" never count against a bot, and a kind of title is never left with no bot. Search bots page shows Paused / Struggling / Another try badges.
- *Rebuild library from vault* (`src/crawler/rebuild.ts`, Admin → Connections): re-reads the vault channel(s) and re-indexes every film/episode from the file names. Already-indexed files are skipped, the blocklist is respected, followers aren't notified.
- *Smart finder* (`src/bot/finder.ts`, needs `GEMINI_API_KEY`): a viewer can describe a film, send a voice note or a poster/screenshot and tap one of up to 4 suggested titles, which then runs a normal search. Typed searches that find nothing and read like a description fall into it too. 12 smart searches per viewer per day (admins unlimited).
- *Weekly digest* (`src/bot/digest.ts`, Admin → Messaging, `/digest on|off|now`): "new this week" list, Friday 16:00+ UTC, once a week, off until you switch it on. Every message has "Stop weekly updates"; `/weekly` toggles it; people who blocked the bot are dropped automatically.
- Tests: 155 passing (blocklist, moderation, bot health, rebuild, finder, digest added).

**Phase 6 — hygiene**
- One lockfile (`package-lock.json`), package renamed `busimovie`, stray test scripts and the old AI Studio plan removed.
- Real app icons (they were mislabelled SVGs), PWA manifest now "BusiMovie" with ink/ember colours, README rewritten, `GEMINI_MODEL` setting (default `gemini-flash-latest`), `.env.example` cleaned (no Radarr/Sonarr).

## Next
1. First live crawler run: read the traces (Admin → Crawl jobs) of the first few jobs and tune per-bot behaviour. Nothing has run against the real Apple/Delta/EzPz/Quinson bots yet.
2. Make the bot an admin in each required channel, press Test on the Required channels page, then switch the gate on.
3. Billboard uses the poster (the zero-key metadata sources give no wide backdrops). A `TMDB_API_KEY` would allow real backdrops.
4. Ideas not built yet (ask if wanted): group movie-night polls, per-title "also removed from the vault" confirmation in the UI, navigator-level skipping of a blocked result (today a blocked file is refused when it arrives and the next bot is tried).
5. Optional later: mirror mode, persisted learned advisor rules.

## Do these yourself
- Rotate/revoke the Telegram userbot session that was committed earlier; purge it from git history.
- Set secrets in AI Studio: `ADMIN_PASSWORD`, `ADMIN_TELEGRAM_IDS`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TELEGRAM_USER_SESSION` (the session is no longer mirrored anywhere).
- Firestore is no longer used at all; you can delete the Firestore database / rules in the Firebase console.
- Start the bot once from your own Telegram account (admin ids in `ADMIN_TELEGRAM_IDS`) so it can send you alerts.
- Optional: `GEMINI_API_KEY` (and `GEMINI_MODEL`) enables the AI advisor for unfamiliar bot screens and the viewers' smart finder (description / voice / poster).
- Decide the daily cap (Admin → Safety) and whether to switch on the weekly digest (Admin → Messaging); both start off.
- Make the userbot able to delete in the vault channel(s) (admin with "delete messages") so takedowns also remove the stored copies.
