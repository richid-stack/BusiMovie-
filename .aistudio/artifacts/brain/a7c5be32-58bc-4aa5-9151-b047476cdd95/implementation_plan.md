# Feasibility Assessment & Architecture Plan: Autonomous Userbot Crawler & Bot-to-Bot Search Pipeline

## Executive Summary: Is It Doable?
**Yes, absolutely.** Both features are 100% technically feasible and are widely used in large-scale Telegram media ecosystems. 

By integrating an MTProto client (Userbot running on your Telegram API credentials via `api_id` and `api_hash`), we bypass the strict limitations of the standard Telegram Bot API (which cannot see historical channel messages and cannot communicate with other bots). Your existing setup—the private vault channel, the Bot API indexer, Firestore, and the Netflix-style web app—remains the central hub and single source of truth.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Because an MTProto userbot acts on behalf of a real Telegram account, Telegram enforces strict FloodWait rate limits and anti-spam measures. We recommend starting with a dedicated auxiliary Telegram account (not your primary personal chat account) for the userbot worker.

- **Engine Choice**: **GramJS (Node.js)** integrated directly as a background worker alongside our Express backend, or a standalone **Python (Telethon/Pyrogram)** microservice. GramJS allows everything to run in our unified Node.js environment without additional runtimes.
- **Vault Integration**: The userbot **never** touches user delivery directly; it strictly delivers discovered files into your **Private Vault Channel**. Your existing Bot API indexer handles Firestore indexing and storefront updates seamlessly.
- **Admin Control**: A dedicated **"Automation & Crawlers"** tab in the Admin Console to view active jobs, manage target channels, configure external search bots, and inspect crawler logs.

---

## 1. Overview & Core Concept

### Feature 1: Autonomous Channel Crawler (Historical & Real-Time)
- **Problem**: Manually finding movies in source channels and forwarding them to your private vault is tedious and slow.
- **Solution**: The userbot connects via MTProto, monitors configured source channels in real time, and can also run historical backfill jobs (e.g., paging through the last 500 messages). When it detects video/document media matching target criteria (file size, video extensions, movie names), it automatically forwards or copies the message to your private vault channel.
- **Result**: Files land in the vault, your bot indexes them to Firestore, and they immediately appear in the Netflix storefront.

### Feature 2: On-Demand External Bot Querying (Autonomous Fulfillment)
- **Problem**: When a user searches for a movie not currently in your vault, an admin has to manually open another Telegram search bot, find the file, and forward it.
- **Solution**:
  1. A user searches on your storefront or Telegram bot.
  2. If the title is missing from Firestore, a job is pushed to the `pending_searches` Firestore queue.
  3. The userbot picks up the job and queries target search bots using **Inline Queries** (`@SomeSearchBot Movie Name`) or **Command Queries** (`/search Movie Name`).
  4. The userbot clicks/extracts the file result and forwards it into your private vault channel.
  5. Your bot indexes the new file in Firestore, marks the request fulfilled, and sends the user a direct link/notification.

---

## 2. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TELEGRAM ECOSYSTEM                              │
│                                                                             │
│  Target Channels/Groups            External Search Bots                     │
│  [ Channel A ] [ Channel B ]       [ @SearchBot1 ] [ @SearchBot2 ]          │
│         │              ▲                  │                ▲                │
│         │ (New Posts)  │ (Backfill)       │ (Inline/Cmd)   │                │
│         ▼              │                  ▼                │                │
│  ┌──────────────────────────────────────────────────────────────┐           │
│  │                MTProto Userbot Engine (GramJS)               │           │
│  │  - Channel Listener        - Historical Crawler              │           │
│  │  - Inline Query Dispatcher - FloodWait Backoff Manager       │           │
│  └──────────────────────────────┬───────────────────────────────┘           │
│                                 │ (Forward/Copy Media)                      │
│                                 ▼                                           │
│                 ┌───────────────────────────────┐                           │
│                 │     Private Vault Channel     │                           │
│                 └───────────────┬───────────────┘                           │
│                                 │ (Bot Admin Event)                         │
│                                 ▼                                           │
│                 ┌───────────────────────────────┐                           │
│                 │   Existing Bot API Indexer    │                           │
│                 └───────────────┬───────────────┘                           │
└─────────────────────────────────┼───────────────────────────────────────────┘
                                  │
                                  ▼
           ┌──────────────────────────────────────────────┐
           │             Firestore Database               │
           │  - media_vault / movies (catalog)            │
           │  - crawler_targets (channels to monitor)     │
           │  - search_bots (external bots to query)      │
           │  - crawler_jobs & pending_searches (queues)  │
           └──────────────────────┬───────────────────────┘
                                  │
                                  ▼
           ┌──────────────────────────────────────────────┐
           │        Admin Console & User Storefront       │
           │  - Monitor crawler progress & flood limits   │
           │  - Add/remove channels & bot usernames       │
           │  - Real-time streaming & auto-fulfillment    │
           └──────────────────────────────────────────────┘
```

---

## 3. Implementation Phases & Modules

### Phase 1: MTProto Authentication & Configuration
- Secure credential management for `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and `TELEGRAM_SESSION_STRING`.
- Session persistence to ensure the userbot does not require re-login on server restarts.
- Rate-limit safety module with automatic exponential backoff to handle Telegram's `FloodWaitError`.

### Phase 2: Channel Crawler Engine
- **Target Channels Collection**: Store channel usernames, invite links, status, and filter rules (min file size, allowed extensions, keyword filters).
- **Historical Backfill Worker**: Paginated crawler using `iterMessages` with batch pauses (e.g. 50 messages every 15 seconds) to avoid spam triggers.
- **Real-Time Monitor**: MTProto event listener (`NewMessage`) attached to joined target channels that instantly forwards discovered media to the vault.

### Phase 3: External Bot Search & Auto-Fulfillment
- **Inline Query Engine**: Automated client queries using `client.invoke(new Api.messages.GetInlineBotResults(...))` to search and click files into the vault.
- **Command & Button Handler**: Fallback automation for chat-based bots (`/search <query>` -> click first button -> forward resulting document).
- **Firestore Queue Worker**: Listens for user search requests marked `pending_bot_search`, executes queries across prioritized search bots, and fulfills requests automatically upon vault arrival.

### Phase 4: Admin Console Interface
- **Crawler Controls**:
  - Add/remove source channels with real-time status (Connected, Syncing, Idle).
  - "Run Backfill" action with configurable depth (e.g., 50, 100, 500 messages).
  - Filter criteria settings (e.g. min size 300MB, video files only).
- **Bot Search Registry**:
  - List of active search bots with priority ordering and operational health status.
  - Test query playground to test bot responses directly from the admin UI.
- **Live Audit & Logs**:
  - Real-time log stream showing intercepted files, forwarded messages, and rate limit cooldowns.
