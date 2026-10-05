# BusiMovie Cinema Intelligence & High-Fidelity TV Series Architecture

## Title & Summary
Complete architectural upgrade and logic overhaul for BusiMovie. Eliminates the single-file crawler cutoff to support true multi-episode and "Get All Episodes" batch ingestion from Quinson, removes the dangerous channel fallback that caused incorrect title deliveries (e.g., *The Gifted*), resolves the S1E1 catalog lockout trap through a hybrid blueprint hierarchy, enforces strict crawler isolation between Movies and Series, and establishes persistent callback state.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Confirmed Architectural Directions:**
> 1. **Direct Quinson-Style Navigation (Zero-Extra-Clicks):** Keeping the direct season grid when a TV series is opened rather than inserting a redundant intermediary presentation card. Show metadata, poster, rating, and season buttons render together in one unified view.
> 2. **Multi-Episode & Batch Ingestion ("Get All Episodes"):** Replacing the `if (filesIngested > 0) break;` cutoff with a continuous ingestion buffer that waits for and indexes all incoming episode documents from `@quinsonnbot`.
> 3. **Episode-Level Hybrid Catalog:** The catalog distinguishes between a show's structure (all seasons and episodes) and what is locally archived. Having S01E01 downloaded will no longer hide Seasons 2–5 or Episodes 2–8. Unarchived episodes display live fetch buttons (`⚡ E02`).
> 4. **Strict Media Type Boundary:** TV series queries are hard-locked to TV Series Relays (`@quinsonnbot`) and will never route through movie scrapers (`@Apple_moviebot`, `@iPapkornDeltaBot`, `@iPapkornEzPzBot`).

---

## 1. Overview & Core Concept

- **What It Does**: Upgrades the Telegram bot and GramJS auxiliary crawler into an intelligent, enterprise-grade media retrieval system. Users can browse movies and TV series, view real season and episode structures, stream ready episodes in 0.1s from private storage (`-1003983385552`), or autonomously trigger on-demand ingestion for single episodes or entire seasons from `@quinsonnbot`.
- **Target Audience**: BusiMovie Telegram community members looking for seamless movie streaming and episodic TV series downloads.
- **Key Value**: 100% accurate file deliveries, zero title cross-contamination, full visibility of all seasons and episodes, and batch episode acquisition.

---

## 2. User Experience & Flows

### A. TV Series Search & Immediate Season Grid (Direct Quinson UX)
1. **Search**: User types `"Stranger Things"` or `/search Stranger Things`.
2. **Result List**: Results display with clear media badges:
   - `📺 Stranger Things (2016–2025)`
   - `📺 Stranger Things: Tales from '85 (2026–)`
   - `🎬 Some Related Movie (2020)`
3. **Direct Season Selector**: Tapping `📺 Stranger Things` opens the show card directly with poster art and season buttons (no redundant intermediate tap):
   ```text
   📺 Stranger Things (2016–2025)
   ⭐ 8.7/10 • 5 Seasons • Sci-Fi / Mystery / Drama

   Please choose a season:
   [ 🗓️ Season 1 ]   [ 🗓️ Season 2 ]
   [ 🗓️ Season 3 ]   [ 🗓️ Season 4 ]
   [ 🗓️ Season 5 ]
   [ 🎬 Official Trailer ]   [ ◀️ Back to Search ]
   ```

### B. Episode Browser (Hybrid Availability Display)
When the user taps `🗓️ Season 1`:
- The bot retrieves Season 1's episode list (Episodes 1 to 8).
- Each button clearly shows its real status:
  - `✅ E01 • Ready to Stream` ➔ Instant delivery (0.1s) from storage channel.
  - `⚡ E02 • Get Episode (PSA 720p)` ➔ Not in storage yet; live on-demand fetch.
  - `⚡ E03 • Get Episode (PSA 720p)` ➔ Live on-demand fetch.
  - ...
  - `⚡ E08 • Get Episode (PSA 720p)` ➔ Live on-demand fetch.
- Bottom Action Row:
  - `[ 📦 Ingest Full Season 1 (All 8 Episodes) ]`
  - `[ ◀️ Back to Seasons ]`

### C. True Batch Ingestion ("Get All Episodes")
When the user taps `[ 📦 Ingest Full Season 1 ]`:
1. Bot sends an interactive progress notification:
   `📺 Ingesting Season 1 (0/8 episodes captured)...`
2. Crawler navigates Quinson (`sv_*` ➔ `se_*` ➔ triggers batch/episodes).
3. The ingestion loop listens for all incoming video documents, tracking progress:
   `📺 Ingesting Season 1 (3/8 episodes forwarded & indexed)...`
4. All 8 episodes are forwarded into Channel `-1003983385552` and registered in SQLite with exact message IDs.
5. All 8 episodes are delivered to the user in their chat.
6. The season view automatically updates all buttons to `✅ Ready to Stream`.

---

## 3. Forensic Weaknesses Uncovered & Architectural Solutions

### Weakness 1: The Single-File Loop Break Bug
- **Current Defect**: In `crawlerService.ts` line 1767:
  ```ts
  if (filesIngested > 0) break;
  ```
  The crawler forcibly terminated after receiving a single video file, even when Quinson sent a full batch or when the user requested all episodes.
- **Architectural Solution**: Remove the premature `break`. Implement a streaming buffer that collects incoming media files until all target episodes are received or a configurable idle timeout (6s with no new media) elapses.

### Weakness 2: Random Channel Message Fallback ("The Gifted" Incident)
- **Current Defect**: In `bot/index.ts` lines 602–615:
  When `file.telegram_message_id` was empty, the code executed:
  `SELECT telegram_message_id FROM media_files WHERE telegram_channel_id = ? ORDER BY id DESC LIMIT 1`
  This retrieved the last unrelated video in that channel (Message 30, which happened to be *The Gifted*), and delivered it with a *Stranger Things* caption.
- **Architectural Solution**:
  1. Remove this fallback completely.
  2. Implement strict extraction of `UpdateNewChannelMessage` in GramJS `client.forwardMessages()` so the exact channel message ID is always recorded.
  3. If delivery cannot verify the real message ID, fail safely with an actionable retry button rather than serving incorrect media.

### Weakness 3: The S1E1 Ingestion Lockout Trap
- **Current Defect**: `getSeriesSeasons()` and `getSeriesSeasonEpisodes()` only inspected local SQLite rows. If S01E01 was present, `seasons.length > 0` was true, preventing Quinson from ever being queried for Seasons 2–5 or Episodes 2–8.
- **Architectural Solution**: Decouple the show's canonical season/episode blueprint from local file records. The blueprint tracks the total seasons and episode count, while SQLite tracks which specific episodes have been archived. Missing episodes remain visible with on-demand acquisition buttons.

### Weakness 4: TV Series Leaking into Movie Search Bots
- **Current Defect**: When Quinson had not yet ingested an episode, `triggerAutonomousCrawlerFlow` fell through to movie scrapers (`@Apple_moviebot`, `@iPapkornDeltaBot`, `@iPapkornEzPzBot`), broadcasting movie relay messages for TV queries.
- **Architectural Solution**: Strict isolation. Queries tagged as TV series only route to TV Series Relays (`@quinsonnbot`). If Quinson is temporarily busy, the bot informs the user and offers a retry without touching movie bots.

### Weakness 5: Hardcoded `🎬` Emojis on Series Menus
- **Current Defect**: Inline query mode, season titles, episode menus, and delivery alerts used hardcoded `🎬` emojis.
- **Architectural Solution**: Centralized `getMediaBadge(isSeries)` helper: `📺` for TV Series, `🎬` for Movies.

### Weakness 6: Volatile In-Memory Maps
- **Current Defect**: Callback hashes (`ser_s1`, `req_q_q1`) stored in JS `Map`s were wiped on server restart, rendering older buttons unclickable.
- **Architectural Solution**: Persist callback identifiers in a SQLite `callback_cache` table with a 7-day TTL.

### Weakness 7: Auxiliary Client Concurrency Race Conditions
- **Current Defect**: A single GramJS MTProto client was shared across all user searches and background tasks, risking message cross-talk in external bot chats.
- **Architectural Solution**: Implement a per-bot mutex (`withBotLock("@quinsonnbot", async () => { ... })`) to ensure external bot interactions are serialized and atomic.

---

## 4. Technical Architecture & System Diagram

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        User Search on Telegram                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                         ┌──────────┴──────────┐
                         │  executeMovieSearch │
                         └──────────┬──────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
   [Movie Flow (🎬)]                                 [TV Series Flow (📺)]
           │                                                 │
           ▼                                                 ▼
┌──────────────────────┐                           ┌───────────────────┐
│ getVaultMovieCatalog │                           │ Show Blueprint    │
│ + Online Metadata    │                           │ (Seasons 1..N)    │
└──────────┬───────────┘                           └─────────┬─────────┘
           │                                                 │
           ▼                                                 ▼
┌──────────────────────┐                           ┌───────────────────┐
│ Movie Card (🎬)      │                           │ Direct Season     │
│ Qualities / Trailer  │                           │ Grid (📺)         │
└──────────────────────┘                           └─────────┬─────────┘
                                                             │
                                                             ▼
                                                   ┌───────────────────┐
                                                   │ Episode Browser   │
                                                   │ ✅ Local Ready    │
                                                   │ ⚡ On-Demand Fetch│
                                                   │ 📦 Ingest Season  │
                                                   └─────────┬─────────┘
                                                             │
                                                             ▼
                                                   ┌───────────────────┐
                                                   │ withBotLock       │
                                                   │ (@quinsonnbot)    │
                                                   └─────────┬─────────┘
                                                             │
                                                             ▼
                                                   ┌───────────────────┐
                                                   │ Ingestion Buffer  │
                                                   │ Waits for ALL eps │
                                                   └─────────┬─────────┘
                                                             │
                                                             ▼
                                                   ┌───────────────────┐
                                                   │ Forward & Index   │
                                                   │ TV Channel        │
                                                   │ (-1003983385552)  │
                                                   └─────────┬─────────┘
                                                             │
                                                             ▼
                                                   ┌───────────────────┐
                                                   │ Zero-Bandwidth    │
                                                   │ Delivery to User  │
                                                   └───────────────────┘
```

---

## 5. Verification Plan

1. **Season & Episode Integrity**: Search `"Stranger Things"` ➔ Verify that all 5 seasons are visible and accessible even when only S01E01 is in the database.
2. **On-Demand Episode Ingestion**: Tap an unarchived episode (e.g. S01E02) ➔ Verify that Quinson navigates to S01E02, forwards it to `-1003983385552`, records the genuine message ID, and delivers it cleanly.
3. **Multi-Episode Batch Test**: Trigger `"Ingest Full Season 1"` ➔ Verify that the crawler does NOT break after 1 file, ingests all incoming episodes, and updates the library.
4. **Incorrect Delivery Prevention**: Verify that no fallback copies arbitrary files from the storage channel; test error handling when message IDs are missing.
5. **Emoji & Badge Verification**: Verify `📺` appears across inline queries, season cards, episode buttons, and delivery notifications for all TV series.
6. **Crawler Isolation**: Verify that requesting an unindexed TV series never mentions or queries `@Apple_moviebot`, `@iPapkornDeltaBot`, or `@iPapkornEzPzBot`.
