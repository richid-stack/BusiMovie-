import { db, getSetting, setSetting, deleteSetting } from "../db/index.js";
import { parseMediaTitleAndSeriesInfo, normalizeQuality } from "./seriesParser.js";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import axios from "axios";

export interface CrawlerTarget {
  id: number;
  channel_identifier: string; // e.g. "@MoviesChannel" or "-1001234567890" or "https://t.me/..."
  title: string;
  status: "active" | "paused" | "syncing";
  min_file_size_mb: number;
  quality_filter: string; // "all" | "1080p" | "4k"
  last_crawled_at: string | null;
  total_files_found: number;
  created_at: string;
}

export interface SearchBot {
  id: number;
  bot_username: string; // e.g. "@TGMovieSearchBot"
  bot_type: "inline" | "command"; // "inline" (@bot query) or "command" (/search query)
  command_template: string; // default: "/search {query}"
  status: "active" | "degraded" | "inactive";
  priority: number; // 1 = highest
  success_count: number;
  last_queried_at: string | null;
  created_at: string;
}

export interface SearchJob {
  id: number;
  query: string;
  user_telegram_id: string;
  status: "pending" | "searching" | "fulfilled" | "failed";
  bot_used?: string;
  file_name?: string;
  telegram_file_id?: string;
  file_size?: number;
  quality?: string;
  error?: string;
  created_at: string;
  fulfilled_at?: string;
}

export interface CrawlerActivityLog {
  id: string;
  timestamp: string;
  type: "channel_crawl" | "bot_search" | "vault_forward" | "flood_wait";
  source: string;
  title: string;
  details: string;
  status: "success" | "filtered" | "cooldown" | "error";
}

// In-memory runtime state for fast execution, synced with DB
let targets: CrawlerTarget[] = [];
let searchBots: SearchBot[] = [];
let searchJobs: SearchJob[] = [];
const activityLogs: CrawlerActivityLog[] = [];
let floodWaitCooldownUntil: number | null = null;
let isWorkerRunning = false;

// Default initial targets if database is empty
const DEFAULT_TARGET_CHANNELS = [
  { identifier: "@Apple_Movies101", title: "Apple movies 🍿™", minSize: 300, quality: "all" },
  { identifier: "@applemovies101", title: "Apple Movies🍿™", minSize: 300, quality: "all" },
  { identifier: "@F5_FILMS", title: "F5 FILMS", minSize: 300, quality: "all" },
  { identifier: "@Series_index_y", title: "TV/WEB SERIES INDEX", minSize: 200, quality: "all" },
  { identifier: "@Netflex_series", title: "Tv Series Index", minSize: 200, quality: "all" }
];

const DEFAULT_SEARCH_BOTS = [
  { bot_username: "@Apple_moviebot", bot_type: "command" as const, command_template: "/search {query}", priority: 1 },
  { bot_username: "@iPapkornDeltaBot", bot_type: "command" as const, command_template: "{query}", priority: 2 },
  { bot_username: "@iPapkornEzPzBot", bot_type: "command" as const, command_template: "{query}", priority: 3 }
];

export async function initCrawlerService() {
  try {
    // Create SQLite tables if needed
    await db.execute(`
      CREATE TABLE IF NOT EXISTS crawler_targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_identifier TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        min_file_size_mb INTEGER DEFAULT 500,
        quality_filter TEXT DEFAULT 'all',
        last_crawled_at DATETIME,
        total_files_found INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS search_bots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_username TEXT UNIQUE NOT NULL,
        bot_type TEXT DEFAULT 'inline',
        command_template TEXT DEFAULT '/search {query}',
        status TEXT DEFAULT 'active',
        priority INTEGER DEFAULT 1,
        success_count INTEGER DEFAULT 0,
        last_queried_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS search_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        user_telegram_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        bot_used TEXT,
        file_name TEXT,
        telegram_file_id TEXT,
        file_size INTEGER DEFAULT 0,
        quality TEXT DEFAULT '1080p',
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        fulfilled_at DATETIME
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS crawler_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT,
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS crawler_batch_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_title TEXT NOT NULL,
        clean_title TEXT NOT NULL,
        year TEXT,
        requested_quality TEXT DEFAULT '1080p',
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        bot_used TEXT,
        media_file_id INTEGER,
        source_csv TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Resume items that were mid-flight when the server last stopped
    await resetInterruptedQueueItems();

    // Load targets
    const targetRows = (await db.execute("SELECT * FROM crawler_targets ORDER BY id ASC")).rows;
    if (targetRows.length === 0) {
      for (const t of DEFAULT_TARGET_CHANNELS) {
        await db.execute({
          sql: "INSERT INTO crawler_targets (channel_identifier, title, status, min_file_size_mb, quality_filter) VALUES (?, ?, 'active', ?, ?)",
          args: [t.identifier, t.title, t.minSize, t.quality]
        });
      }
      const reloaded = (await db.execute("SELECT * FROM crawler_targets ORDER BY id ASC")).rows;
      targets = reloaded as unknown as CrawlerTarget[];
    } else {
      targets = targetRows as unknown as CrawlerTarget[];
    }

    // Auto-migrate & ensure default priority bots exist
    for (const b of DEFAULT_SEARCH_BOTS) {
      const existing = (await db.execute({
        sql: "SELECT id FROM search_bots WHERE LOWER(bot_username) = LOWER(?)",
        args: [b.bot_username]
      })).rows;
      if (existing.length === 0) {
        await db.execute({
          sql: "INSERT INTO search_bots (bot_username, bot_type, command_template, status, priority) VALUES (?, ?, ?, 'active', ?)",
          args: [b.bot_username, b.bot_type, b.command_template, b.priority]
        });
      }
    }

    // Default priorities apply only to bots the admin has not touched: we never force a bot
    // inactive or reorder it on boot (admin choices in the dashboard are authoritative).
    // Reload search bots
    const botRows = (await db.execute("SELECT * FROM search_bots ORDER BY priority ASC, id ASC")).rows;
    searchBots = botRows as unknown as SearchBot[];

    // Load recent search jobs
    const jobRows = (await db.execute("SELECT * FROM search_jobs ORDER BY created_at DESC LIMIT 50")).rows;
    searchJobs = jobRows as unknown as SearchJob[];

    // Restore persistent Cron Configuration from database
    try {
      const savedCron = await getSetting("cron_config");
      if (savedCron) {
        const parsed = JSON.parse(savedCron);
        configureCronJob(parsed);
        console.log(`[CrawlerService] Restored cron schedule from DB: isEnabled=${parsed.isEnabled}`);
      }
    } catch (e: any) {
      console.warn("[CrawlerService] Cron restore error:", e.message);
    }

    logActivity({
      type: "channel_crawl",
      source: "Engine Boot",
      title: "Crawler & Search Service Ready",
      details: `Initialized with ${targets.length} target channels and ${searchBots.length} external search bots. Cron active: ${cronConfig.isEnabled}.`,
      status: "success"
    });

    isWorkerRunning = true;
    console.log("[CrawlerService] Autonomous Userbot Engine & Search Queue initialized.");
  } catch (err) {
    console.error("[CrawlerService] Initialization error:", err);
  }
}

export function logActivity(log: Omit<CrawlerActivityLog, "id" | "timestamp">) {
  const item: CrawlerActivityLog = {
    id: `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    ...log
  };
  activityLogs.unshift(item);
  if (activityLogs.length > 100) activityLogs.pop();

  // Async persist to SQLite
  db.execute({
    sql: "INSERT INTO crawler_logs (type, source, title, details, status) VALUES (?, ?, ?, ?, ?)",
    args: [item.type, item.source, item.title, item.details, item.status]
  }).catch(() => {});
}

// Pending phone-login state (code request -> verify). These were referenced but never declared,
// which made the dashboard "log in with phone code" flow throw ReferenceError.
let pendingClient: TelegramClient | null = null;
let pendingPhone = "";
let pendingPhoneCodeHash = "";

// Active client instance if logged in
let activeClient: TelegramClient | null = null;
let activeUserInfo: { id?: string; username?: string; firstName?: string; phone?: string } | null = null;

export { withBotLock } from "../crawler/lock.js";

/** The storage channel for movies or series. Empty when none is configured: there is no built-in default any more. */
export async function getEffectiveVaultChannelId(isSeries?: boolean): Promise<string> {
  const movie = async () => {
    const custom = await getSetting("telegram_vault_channel_id");
    if (custom && custom.trim()) return custom.trim();
    return (process.env.TELEGRAM_VAULT_CHANNEL_ID || "").trim();
  };
  if (isSeries) {
    const customSeries = await getSetting("telegram_series_vault_channel_id");
    if (customSeries && customSeries.trim()) return customSeries.trim();
    if (process.env.TELEGRAM_SERIES_VAULT_CHANNEL_ID && process.env.TELEGRAM_SERIES_VAULT_CHANNEL_ID.trim()) return process.env.TELEGRAM_SERIES_VAULT_CHANNEL_ID.trim();
    return movie(); // no separate series channel: keep everything in the movie vault
  }
  return movie();
}

/** Same, but throws a plain-English error when nothing is set up yet. */
export async function requireVaultChannelId(isSeries?: boolean): Promise<string> {
  const id = await getEffectiveVaultChannelId(isSeries);
  if (!id) throw new Error("No storage channel is set up yet. Add one in Admin → Connections.");
  return id;
}

export async function setEffectiveVaultChannelId(channelId: string): Promise<void> {
  await setSetting("telegram_vault_channel_id", channelId.trim());
}

export async function setEffectiveSeriesVaultChannelId(channelId: string): Promise<void> {
  await setSetting("telegram_series_vault_channel_id", channelId.trim());
}

export async function getEffectiveUserSession(): Promise<string> {
  const dbSession = await getSetting("telegram_user_session");
  if (dbSession && dbSession.trim()) return dbSession.trim();
  return process.env.TELEGRAM_USER_SESSION || "";
}

export async function getAuxiliarySessionStatus() {
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  const session = await getEffectiveUserSession();
  const vaultChannelId = await getEffectiveVaultChannelId(false);
  const seriesVaultChannelId = await getEffectiveVaultChannelId(true);

  let connected = false;
  let username = "";
  let firstName = "";
  let phone = "";

  if (activeUserInfo) {
    connected = true;
    username = activeUserInfo.username || "";
    firstName = activeUserInfo.firstName || "";
    phone = activeUserInfo.phone || "";
  } else if (session && apiId && apiHash) {
    try {
      if (!activeClient) {
        activeClient = new TelegramClient(new StringSession(session), Number(apiId), apiHash, {
          connectionRetries: 3
        });
        await activeClient.connect();
      }
      const isAuth = await activeClient.isUserAuthorized();
      if (isAuth) {
        const me = await activeClient.getMe() as any;
        connected = true;
        username = me?.username || "";
        firstName = me?.firstName || "";
        phone = me?.phone || "";
        activeUserInfo = { id: String(me?.id), username, firstName, phone };
      }
    } catch (err: any) {
      console.warn("Could not restore active Telegram auxiliary session:", err.message);
    }
  }

  return {
    apiIdConfigured: !!apiId,
    apiHashConfigured: !!apiHash,
    sessionConfigured: !!session,
    connected,
    username,
    firstName,
    phone,
    hasPendingCode: !!pendingPhoneCodeHash,
    pendingPhone: pendingPhone ? `${pendingPhone.substring(0, 4)}***${pendingPhone.slice(-2)}` : null,
    vaultChannelId,
    seriesVaultChannelId
  };
}

export async function getConnectedClient(): Promise<TelegramClient | null> {
  const session = await getEffectiveUserSession();
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!session || !apiId || !apiHash) return null;

  if (activeClient) {
    try {
      if (!activeClient.connected) {
        await activeClient.connect();
      }
      const isAuth = await activeClient.isUserAuthorized();
      if (isAuth) return activeClient;
    } catch (_) {
      activeClient = null;
    }
  }

  try {
    activeClient = new TelegramClient(new StringSession(session), Number(apiId), apiHash, {
      connectionRetries: 3
    });
    await activeClient.connect();
    const isAuth = await activeClient.isUserAuthorized();
    if (isAuth) {
      const me = await activeClient.getMe() as any;
      activeUserInfo = { id: String(me?.id), username: me?.username || "", firstName: me?.firstName || "", phone: me?.phone || "" };
      return activeClient;
    }
  } catch (err: any) {
    console.warn("Failed to connect GramJS client:", err.message);
  }
  return null;
}

export async function getJoinedDialogs(): Promise<Array<{
  id: string;
  title: string;
  username: string | null;
  isChannel: boolean;
  isGroup: boolean;
}>> {
  const client = await getConnectedClient();
  if (!client) return [];
  try {
    const dialogs = await client.getDialogs({ limit: 40 });
    return dialogs
      .filter((d: any) => d.isChannel || d.isGroup)
      .map((d: any) => {
        let channelId = "";
        try {
          if (d.id?.value !== undefined) {
            channelId = String(d.id.value);
          } else {
            channelId = String(d.id);
          }
        } catch (_) {
          channelId = String(d.id);
        }
        return {
          id: channelId,
          title: d.title || "Untitled Channel",
          username: d.entity?.username ? `@${d.entity.username}` : null,
          isChannel: !!d.isChannel,
          isGroup: !!d.isGroup
        };
      });
  } catch (e: any) {
    console.warn("Error fetching joined dialogs:", e.message);
    return [];
  }
}

export async function requestAuxiliaryLoginCode(phone: string): Promise<{ success: boolean; message: string }> {
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    throw new Error("Telegram API ID and API Hash must be configured in environment secrets.");
  }

  const cleanPhone = phone.trim().replace(/[^\d+]/g, "");
  if (!cleanPhone.startsWith("+") || cleanPhone.length < 8) {
    throw new Error("Please enter a valid international phone number starting with + (e.g. +1234567890).");
  }

  if (pendingClient) {
    try { await pendingClient.disconnect(); } catch (_) {}
    pendingClient = null;
  }

  const client = new TelegramClient(new StringSession(""), Number(apiId), apiHash, {
    connectionRetries: 5,
  });

  await client.connect();

  const sendCodeResult = await client.sendCode(
    { apiId: Number(apiId), apiHash },
    cleanPhone
  );

  pendingClient = client;
  pendingPhone = cleanPhone;
  pendingPhoneCodeHash = sendCodeResult.phoneCodeHash;

  logActivity({
    type: "channel_crawl",
    source: "MTProto Auth",
    title: `Verification code sent to ${cleanPhone.substring(0, 4)}***`,
    details: "Awaiting user input of the Telegram 5-digit verification code.",
    status: "success"
  });

  return {
    success: true,
    message: `Verification code sent! Please check your Telegram app on phone number ${cleanPhone}.`
  };
}

export async function verifyAuxiliaryLoginCode(code: string, password?: string): Promise<{ success: boolean; username: string; message: string }> {
  if (!pendingClient || !pendingPhone || !pendingPhoneCodeHash) {
    throw new Error("No pending login session found. Please enter your phone number and request a code first.");
  }

  const cleanCode = code.trim().replace(/\D/g, "");
  if (!cleanCode) {
    throw new Error("Please provide the numeric verification code sent to your Telegram app.");
  }

  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH!;

  try {
    await pendingClient.invoke(
      new Api.auth.SignIn({
        phoneNumber: pendingPhone,
        phoneCodeHash: pendingPhoneCodeHash,
        phoneCode: cleanCode,
      })
    );
  } catch (err: any) {
    if (err.errorMessage === "SESSION_PASSWORD_NEEDED") {
      if (!password) {
        throw new Error("2FA_PASSWORD_REQUIRED: Two-step verification is enabled on this Telegram account. Please enter your 2FA password.");
      }
      await pendingClient.signInWithPassword(
        { apiId, apiHash },
        { 
          password: () => Promise.resolve(password),
          onError: () => Promise.resolve(false)
        }
      );
    } else {
      throw new Error(`Telegram Login Error: ${err.errorMessage || err.message}`);
    }
  }

  const sessionString = (pendingClient.session as StringSession).save();
  await setSetting("telegram_user_session", sessionString);
  process.env.TELEGRAM_USER_SESSION = sessionString;

  activeClient = pendingClient;
  pendingClient = null;
  pendingPhone = "";
  pendingPhoneCodeHash = "";

  const me = await activeClient.getMe() as any;
  const username = me?.username || me?.firstName || "Telegram Auxiliary User";
  activeUserInfo = {
    id: String(me?.id),
    username: me?.username,
    firstName: me?.firstName,
    phone: me?.phone
  };

  logActivity({
    type: "channel_crawl",
    source: "MTProto Auth",
    title: `Auxiliary Account Authenticated: @${username}`,
    details: "Automated channel crawling and bot querying is now online.",
    status: "success"
  });

  return {
    success: true,
    username,
    message: `Successfully connected auxiliary Telegram account @${username}!`
  };
}

export async function disconnectAuxiliarySession(): Promise<void> {
  if (activeClient) {
    try { await activeClient.disconnect(); } catch (_) {}
    activeClient = null;
  }
  activeUserInfo = null;
  await deleteSetting("telegram_user_session");
  delete process.env.TELEGRAM_USER_SESSION;

  logActivity({
    type: "channel_crawl",
    source: "MTProto Auth",
    title: "Auxiliary Account Disconnected",
    details: "Userbot session cleared from settings.",
    status: "cooldown"
  });
}

export async function saveDirectSessionString(sessionString: string): Promise<void> {
  await setSetting("telegram_user_session", sessionString.trim());
  process.env.TELEGRAM_USER_SESSION = sessionString.trim();
  if (activeClient) {
    try { await activeClient.disconnect(); } catch (_) {}
    activeClient = null;
  }
  activeUserInfo = null;
}

export async function getCrawlerStatus() {
  const isFloodWait = floodWaitCooldownUntil !== null && Date.now() < floodWaitCooldownUntil;
  const cooldownRemaining = isFloodWait ? Math.ceil((floodWaitCooldownUntil! - Date.now()) / 1000) : 0;
  const sessionStatus = await getAuxiliarySessionStatus();

  return {
    workerActive: isWorkerRunning,
    floodWaitActive: isFloodWait,
    floodWaitCooldownSeconds: cooldownRemaining,
    targetsCount: targets.length,
    activeTargets: targets.filter(t => t.status === "active").length,
    searchBotsCount: searchBots.length,
    activeBots: searchBots.filter(b => b.status === "active").length,
    pendingJobsCount: searchJobs.filter(j => j.status === "pending" || j.status === "searching").length,
    fulfilledJobsCount: searchJobs.filter(j => j.status === "fulfilled").length,
    sessionConfigured: sessionStatus.sessionConfigured,
    auxiliarySession: sessionStatus
  };
}

export async function getCrawlerTargets(): Promise<CrawlerTarget[]> {
  const rows = (await db.execute("SELECT * FROM crawler_targets ORDER BY id ASC")).rows;
  targets = rows as unknown as CrawlerTarget[];
  return targets;
}

export async function addCrawlerTarget(target: {
  channel_identifier: string;
  title: string;
  min_file_size_mb?: number;
  quality_filter?: string;
}): Promise<CrawlerTarget> {
  const res = await db.execute({
    sql: "INSERT INTO crawler_targets (channel_identifier, title, status, min_file_size_mb, quality_filter) VALUES (?, ?, 'active', ?, ?)",
    args: [
      target.channel_identifier.trim(),
      target.title.trim() || target.channel_identifier.trim(),
      target.min_file_size_mb || 500,
      target.quality_filter || "all"
    ]
  });
  const newTarget = (await db.execute({
    sql: "SELECT * FROM crawler_targets WHERE id = ?",
    args: [Number(res.lastInsertRowid)]
  })).rows[0] as unknown as CrawlerTarget;

  logActivity({
    type: "channel_crawl",
    source: newTarget.channel_identifier,
    title: `Added Target Channel: ${newTarget.title}`,
    details: `Min size: ${newTarget.min_file_size_mb}MB | Filter: ${newTarget.quality_filter}`,
    status: "success"
  });

  return newTarget;
}

export async function updateCrawlerTarget(id: number, updates: Partial<CrawlerTarget>): Promise<boolean> {
  const fields: string[] = [];
  const args: any[] = [];

  if (updates.status !== undefined) {
    fields.push("status = ?");
    args.push(updates.status);
  }
  if (updates.min_file_size_mb !== undefined) {
    fields.push("min_file_size_mb = ?");
    args.push(updates.min_file_size_mb);
  }
  if (updates.quality_filter !== undefined) {
    fields.push("quality_filter = ?");
    args.push(updates.quality_filter);
  }
  if (updates.title !== undefined) {
    fields.push("title = ?");
    args.push(updates.title);
  }

  if (fields.length === 0) return false;
  args.push(id);

  await db.execute({
    sql: `UPDATE crawler_targets SET ${fields.join(", ")} WHERE id = ?`,
    args
  });
  return true;
}

export async function deleteCrawlerTarget(id: number): Promise<boolean> {
  await db.execute({ sql: "DELETE FROM crawler_targets WHERE id = ?", args: [id] });
  return true;
}

export async function getSearchBots(): Promise<SearchBot[]> {
  const rows = (await db.execute("SELECT * FROM search_bots ORDER BY priority ASC")).rows;
  searchBots = rows as unknown as SearchBot[];
  return searchBots;
}

export async function addSearchBot(bot: {
  bot_username: string;
  bot_type?: "inline" | "command";
  command_template?: string;
  priority?: number;
  scope?: "movie" | "series" | "both";
}): Promise<SearchBot> {
  const res = await db.execute({
    sql: "INSERT INTO search_bots (bot_username, bot_type, command_template, status, priority, profile) VALUES (?, ?, ?, 'active', ?, ?)",
    args: [
      bot.bot_username.trim(),
      bot.bot_type || "inline",
      bot.command_template || "/search {query}",
      bot.priority || 1,
      bot.scope ? JSON.stringify({ scope: bot.scope }) : null
    ]
  });
  const newBot = (await db.execute({
    sql: "SELECT * FROM search_bots WHERE id = ?",
    args: [Number(res.lastInsertRowid)]
  })).rows[0] as unknown as SearchBot;

  logActivity({
    type: "bot_search",
    source: newBot.bot_username,
    title: `Registered Search Bot: ${newBot.bot_username}`,
    details: `Type: ${newBot.bot_type} | Priority: ${newBot.priority}`,
    status: "success"
  });

  return newBot;
}

export async function deleteSearchBot(id: number): Promise<boolean> {
  await db.execute({ sql: "DELETE FROM search_bots WHERE id = ?", args: [id] });
  return true;
}

export async function updateSearchBot(id: number, updates: Partial<SearchBot>): Promise<boolean> {
  const fields: string[] = [];
  const args: any[] = [];

  if (updates.bot_username !== undefined) {
    fields.push("bot_username = ?");
    args.push(updates.bot_username.trim());
  }
  if (updates.bot_type !== undefined) {
    fields.push("bot_type = ?");
    args.push(updates.bot_type);
  }
  if (updates.command_template !== undefined) {
    fields.push("command_template = ?");
    args.push(updates.command_template);
  }
  if (updates.status !== undefined) {
    fields.push("status = ?");
    args.push(updates.status);
  }
  if (updates.priority !== undefined) {
    fields.push("priority = ?");
    args.push(updates.priority);
  }

  if ((updates as any).scope !== undefined) {
    fields.push("profile = ?");
    args.push(JSON.stringify({ scope: (updates as any).scope }));
  }

  if (fields.length === 0) return false;
  args.push(id);

  await db.execute({
    sql: `UPDATE search_bots SET ${fields.join(", ")} WHERE id = ?`,
    args
  });
  return true;
}

export function getCrawlerLogs(): CrawlerActivityLog[] {
  return activityLogs;
}


/**
 * Execute a real MTProto historical backfill on a target channel.
 * Reads channel messages, checks real video attachments, applies size/quality filters,
 * and automatically forwards to private vault channel + indexes in DB via primary bot!
 */
export async function runChannelBackfill(targetId: number, messageLimit: number = 30): Promise<{
  scanned: number;
  ingested: number;
  filtered: number;
  titlesFound: string[];
  skipped?: Record<string, number>;
}> {
  // One shared ingest path (src/crawler/channels.ts): quality floor, duplicate check, right vault, confirmed ids.
  const { backfillTarget } = await import("../crawler/channels.js");
  return backfillTarget(targetId, messageLimit);
}


// =========================================================================
// CSV BATCH CRON INDEXER & DEDUPLICATION ENGINE
// =========================================================================

export interface BatchQueueItem {
  id: number;
  raw_title: string;
  clean_title: string;
  year?: string;
  requested_quality: string;
  status: "pending" | "processing" | "completed" | "duplicate_skipped" | "not_found" | "failed";
  attempts: number;
  last_error?: string;
  bot_used?: string;
  media_file_id?: number;
  source_csv?: string;
  created_at: string;
  updated_at: string;
}

export interface CronConfig {
  isEnabled: boolean;
  batchSize: number; // e.g. 5 items per run
  intervalMinutes: number; // e.g. every 15, 30, or 60 mins
  delayBetweenItemsMs: number; // e.g. 6000ms
  maxRetries: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  isRunningBatch: boolean;
}

let cronConfig: CronConfig = {
  isEnabled: false,
  batchSize: 5,
  intervalMinutes: 15,
  delayBetweenItemsMs: 7000,
  maxRetries: 3,
  lastRunAt: null,
  nextRunAt: null,
  isRunningBatch: false
};

let cronTimerHandle: NodeJS.Timeout | null = null;


/**
 * Clean & normalize messy movie release titles. Delegates to the single canonical parser
 * (seriesParser.ts) so the bot, the database and the batch indexer can never disagree.
 */
export function cleanMovieReleaseTitle(rawInput: string): {
  cleanTitle: string;
  year?: string;
  quality?: string;
  season?: number;
  episode?: number;
} {
  let text = (rawInput || "").trim();
  if (!text) return { cleanTitle: "" };

  // URLs, channel handles and promo tags never belong in a title
  text = text.replace(/https?:\/\/\S+/gi, "");
  text = text.replace(/@\w+/g, "");
  text = text.replace(/(?:Join\s*@|Follow\s*@|Telegram\s*@|Downloaded\s*from\s*|Shared\s*by\s*)[^\s]+/gi, "");
  text = text.trim();
  if (!text) return { cleanTitle: "" };

  const parsed = parseMediaTitleAndSeriesInfo(text);
  return {
    cleanTitle: parsed.cleanTitle || text,
    year: parsed.year,
    quality: parsed.quality || "1080p",
    season: parsed.isSeries ? parsed.season : undefined,
    episode: parsed.isSeries ? parsed.episode : undefined
  };
}

const LINE_HEADER_WORDS = /^(rank|id|no\.?|index|s\.?no\.?|row|#|movie|movies|title|film|year|quality|format|name)$/i;
const LINE_INDEX_CELL = /^(?:row\s*\d+|\d{1,3}|#\s*\d+|no\.?\s*\d+|index\s*\d+|item\s*\d+)$/i;
const LINE_YEAR_CELL = /^(?:19|20)\d{2}$/;
const LINE_QUALITY_CELL = /^(4k|2160p|1080p|720p|480p|hd|sd|uhd|bluray|web-dl)$/i;

/**
 * Robust line parser for Markdown tables, lists, numbered lists, TSV, CSV and plain title lists.
 * Commas are only treated as column separators when every other cell is a year, a quality or a row
 * index — so "Hello, Dolly!" stays one title. Digit-only titles (300, 1917) are kept when they are
 * the whole line.
 */
export function extractLineMovieInfo(line: string): {
  rawTitle: string;
  cleanTitle: string;
  year?: string;
  quality: string;
} {
  const EMPTY = { rawTitle: "", cleanTitle: "", quality: "1080p" };
  let text = (line || "").trim();
  if (!text) return EMPTY;

  // Markdown table divider lines (|---|---|)
  if (/^\|?[\s\-:|]+\|?$/.test(text)) return EMPTY;

  // A header line is one made ONLY of header words ("title,year,quality" / "| # | Movie | Year |")
  const headerCells = text.split(/[|,\t]/).map(c => c.trim()).filter(Boolean);
  if (headerCells.length > 0 && headerCells.every(c => LINE_HEADER_WORDS.test(c))) return EMPTY;

  const fromCells = (cells: string[]) => {
    const isMeta = (c: string) => LINE_INDEX_CELL.test(c) || LINE_YEAR_CELL.test(c) || LINE_QUALITY_CELL.test(c) || LINE_HEADER_WORDS.test(c);
    const titleCell = cells.find(c => !isMeta(c));
    if (!titleCell) return null;
    const yearCell = cells.find(c => c !== titleCell && LINE_YEAR_CELL.test(c));
    const qualityCell = cells.find(c => c !== titleCell && LINE_QUALITY_CELL.test(c));
    return { titleCell, yearCell, qualityCell, others: cells.filter(c => c !== titleCell && !isMeta(c)) };
  };

  let rawTitle = "";
  let cellYear: string | undefined;
  let cellQuality: string | undefined;

  if (text.startsWith("|") && text.endsWith("|")) {
    const cells = text.split("|").map(c => c.trim()).filter(Boolean);
    const r = fromCells(cells);
    if (!r) return EMPTY;
    rawTitle = r.titleCell; cellYear = r.yearCell; cellQuality = r.qualityCell;
  } else {
    // Leading row prefixes: "Row 19:", "19. ", "19) ", "No. 19: ", "#19 ", bullets, checkboxes
    text = text.replace(/^(?:row\s*\d+[\.\)\-:]\s*|no\.?\s*\d+[\.\)\-:]\s*|#\d+[\.\)\-:]\s*|\d{1,3}[\.\)\-:]\s+|[-*•]\s*|\[[\sxX]\]\s*)/i, "").trim();
    // Markdown links and emphasis
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1").replace(/[\*~`]/g, "").trim();
    rawTitle = text;

    const delim = text.includes("\t") ? "\t" : text.includes(",") ? "," : null;
    if (delim) {
      const cells = text.split(delim).map(c => c.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
      const r = fromCells(cells);
      if (!r) return EMPTY; // every cell is an index/year/quality/header — nothing to search for
      // Only a real column layout if no second free-text cell exists (otherwise the comma is part of the title)
      if (r && cells.length > 1 && r.others.length === 0) {
        rawTitle = r.titleCell; cellYear = r.yearCell; cellQuality = r.qualityCell;
      } else if (delim === "\t" && r) {
        rawTitle = r.titleCell; cellYear = r.yearCell; cellQuality = r.qualityCell;
      }
    }
  }

  rawTitle = rawTitle.trim();
  if (!rawTitle) return EMPTY;

  const cleaned = cleanMovieReleaseTitle(rawTitle);
  const wholeLine = (line || "").trim();
  // A bare number is only a title when it IS the whole line (e.g. "300", "1917"); never when it came from a column or row index.
  if (!cleaned.cleanTitle) return EMPTY;
  if (/^\d+$/.test(cleaned.cleanTitle) && cleaned.cleanTitle !== wholeLine) return EMPTY;

  return {
    rawTitle,
    cleanTitle: cleaned.cleanTitle,
    year: cellYear || cleaned.year,
    quality: normalizeQuality(cellQuality || cleaned.quality, "1080p")
  };
}

/**
 * Look up official movie release year from open public metadata catalogs (Cinemeta)
 * with a quick 2.5s timeout. Used when user list does not include the year.
 */
export async function lookupMovieYear(cleanTitle: string): Promise<string | undefined> {
  if (!cleanTitle || cleanTitle.length < 2) return undefined;
  try {
    const res = await axios.get(`https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(cleanTitle)}.json`, {
      timeout: 2500,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const metas = res.data?.metas;
    if (Array.isArray(metas) && metas.length > 0) {
      const best = metas[0];
      const rel = best.releaseInfo || best.year;
      if (rel && /^(19\d{2}|20\d{2})/.test(String(rel))) {
        const match = String(rel).match(/^(19\d{2}|20\d{2})/);
        return match ? match[1] : undefined;
      }
    }
  } catch (err: any) {
    // Silently continue if external catalog is unreachable
  }
  return undefined;
}

export { type DownloadExpectation, normalizeTitleFuzzy, verifyDownloadedFile } from "../crawler/verify.js";
import { normalizeTitleFuzzy } from "../crawler/verify.js";


export interface VaultIndexRow { movie_title: string; year: string | null; quality: string | null }

/** Loads a light snapshot of the vault once so a whole CSV can be de-duplicated without N full-table scans. */
export async function loadVaultIndex(): Promise<VaultIndexRow[]> {
  const rows = (await db.execute("SELECT movie_title, year, quality FROM media_files WHERE season IS NULL")).rows;
  return rows as unknown as VaultIndexRow[];
}

/**
 * Check if a movie is already present in the Vault. ANY quality counts as a duplicate, but the
 * release year is respected: "Dune (1984)" does not block "Dune (2021)".
 */
export async function checkVaultDuplicate(
  cleanTitle: string,
  _requestedQuality: string = "any",
  year?: string,
  index?: VaultIndexRow[]
): Promise<{ isDuplicate: boolean; reason?: string; existingQualities: string[] }> {
  if (!cleanTitle) return { isDuplicate: false, existingQualities: [] };

  try {
    const all = index ?? await loadVaultIndex();
    const targetNorm = normalizeTitleFuzzy(cleanTitle);
    if (!targetNorm || targetNorm.length < 2) return { isDuplicate: false, existingQualities: [] };

    const matched = all.filter(f => {
      if (normalizeTitleFuzzy(f.movie_title || "") !== targetNorm) return false;
      // Different known years => different film
      if (year && f.year && String(f.year) !== String(year)) return false;
      return true;
    });
    if (matched.length === 0) return { isDuplicate: false, existingQualities: [] };

    const existingQualities = Array.from(new Set(matched.map(r => (r.quality || "Unknown").toUpperCase())));
    return { isDuplicate: true, reason: `Already in Vault (${existingQualities.join(", ")})`, existingQualities };
  } catch (err: any) {
    console.warn("[Deduplication] Check error:", err.message);
    return { isDuplicate: false, existingQualities: [] };
  }
}

/**
 * Ingest CSV, Markdown (.md), PDF text, TSV, or plain list into the crawler_batch_queue
 * with automated year resolution and deduplication.
 */
export async function parseAndQueueCsvMovies(csvContent: string, sourceName: string = "batch_upload.csv"): Promise<{
  totalParsed: number;
  queued: number;
  duplicatesSkipped: number;
  items: Array<{ title: string; cleanTitle: string; year?: string; status: string; reason?: string }>;
}> {
  // Ensure table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS crawler_batch_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_title TEXT NOT NULL,
      clean_title TEXT NOT NULL,
      year TEXT,
      requested_quality TEXT DEFAULT '1080p',
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      bot_used TEXT,
      media_file_id INTEGER,
      source_csv TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let totalParsed = 0;
  let queued = 0;
  let duplicatesSkipped = 0;
  const processedItems: Array<{ title: string; cleanTitle: string; year?: string; status: string; reason?: string }> = [];
  const vaultIndex = await loadVaultIndex();

  for (const rawLine of lines) {
    if (/^[\-=#\*_]{3,}$/.test(rawLine)) {
      continue;
    }

    const parsed = extractLineMovieInfo(rawLine);
    if (!parsed.cleanTitle || parsed.cleanTitle.length < 2) continue;

    totalParsed++;
    let finalYear = parsed.year;

    // If year was not in user input, attempt fast open metadata lookup
    if (!finalYear) {
      finalYear = await lookupMovieYear(parsed.cleanTitle);
    }

    // Check if already in current pending queue
    const inQueue = (await db.execute({
      sql: "SELECT id FROM crawler_batch_queue WHERE LOWER(clean_title) = LOWER(?) AND COALESCE(year, '') = COALESCE(?, '') AND status IN ('pending', 'processing', 'completed')",
      args: [parsed.cleanTitle, finalYear || null]
    })).rows;

    if (inQueue.length > 0) {
      duplicatesSkipped++;
      processedItems.push({
        title: parsed.rawTitle,
        cleanTitle: parsed.cleanTitle,
        year: finalYear,
        status: "duplicate_skipped",
        reason: "Already in batch queue"
      });
      continue;
    }

    // Check Vault duplication
    const dupCheck = await checkVaultDuplicate(parsed.cleanTitle, parsed.quality, finalYear, vaultIndex);
    if (dupCheck.isDuplicate) {
      duplicatesSkipped++;
      await db.execute({
        sql: `INSERT INTO crawler_batch_queue (raw_title, clean_title, year, requested_quality, status, last_error, source_csv) 
              VALUES (?, ?, ?, ?, 'duplicate_skipped', ?, ?)`,
        args: [parsed.rawTitle, parsed.cleanTitle, finalYear || null, parsed.quality, dupCheck.reason || "Duplicate in Vault", sourceName]
      });
      processedItems.push({
        title: parsed.rawTitle,
        cleanTitle: parsed.cleanTitle,
        year: finalYear,
        status: "duplicate_skipped",
        reason: dupCheck.reason
      });
    } else {
      queued++;
      await db.execute({
        sql: `INSERT INTO crawler_batch_queue (raw_title, clean_title, year, requested_quality, status, source_csv) 
              VALUES (?, ?, ?, ?, 'pending', ?)`,
        args: [parsed.rawTitle, parsed.cleanTitle, finalYear || null, parsed.quality, sourceName]
      });
      processedItems.push({
        title: parsed.rawTitle,
        cleanTitle: parsed.cleanTitle,
        year: finalYear,
        status: "pending",
        reason: dupCheck.reason || "Queued for cron crawl"
      });
    }
  }

  logActivity({
    type: "channel_crawl",
    source: sourceName,
    title: `Batch Ingested: ${queued} queued, ${duplicatesSkipped} duplicates filtered`,
    details: `Parsed ${totalParsed} titles from ${sourceName}. Missing years automatically resolved.`,
    status: "success"
  });

  return {
    totalParsed,
    queued,
    duplicatesSkipped,
    items: processedItems
  };
}

/**
 * Execute a single batch of queued movies from crawler_batch_queue.
 * Features:
 * - FloodWait resilience & auto-cooldown backoff
 * - Bot failover rotation across active bots
 * - Safe inter-item pacing delays (7s)
 * - Automatic indexing to vault upon discovery
 * - Automatic Release Year extraction & metadata enrichment from bot responses
 */
export function sanitizeSearchQuery(title: string): string {
  const raw = (title || "").trim().replace(/^["']|["']$/g, "").trim();
  if (!raw) return "";
  const stripped = raw.replace(/^(?:row\s*\d+[\.\)\-:]\s*|no\.?\s*\d+[\.\)\-:]\s*|#\d+[\.\)\-:]\s*|\d{1,3}[\.\)\-:]\s+|[-*•]\s*)/i, "").trim();
  const c = cleanMovieReleaseTitle(stripped);
  // Search bots match best on "Title Year"; keep colons/hyphens out because most bots tokenise on them
  const base = c.cleanTitle.replace(/[:\-–—]+/g, " ").replace(/\s+/g, " ").trim();
  return c.year && !base.includes(c.year) ? `${base} ${c.year}` : base;
}

/**
 * Execute a single batch of queued movies from crawler_batch_queue.
 * Features:
 * - FloodWait resilience & auto-cooldown backoff
 * - Sequential Bot failover (Priority 1 @Apple_moviebot -> Priority 2 @iPapkornEzPzBot -> Priority 3 @iPapkornDeltaBot)
 * - Skips TV-only bots like @quinsonnbot for movies
 * - Safe inter-item pacing delays (7s)
 * - Automatic indexing & forwarding to vault upon discovery
 * - Automatic Release Year extraction & metadata enrichment from bot responses
 */
export async function processCronBatch(limit: number = 5, isManualTrigger: boolean = false): Promise<{
  processed: number;
  fulfilled: number;
  failed: number;
  skipped: number;
  floodWaitTriggered: boolean;
  logs: string[];
}> {
  if (cronConfig.isRunningBatch) {
    return { processed: 0, fulfilled: 0, failed: 0, skipped: 0, floodWaitTriggered: false, logs: ["Batch already running."] };
  }

  // Check FloodWait cooldown
  if (floodWaitCooldownUntil !== null && Date.now() < floodWaitCooldownUntil) {
    const remainSec = Math.ceil((floodWaitCooldownUntil - Date.now()) / 1000);
    const msg = `Cron paused: Active FloodWait cooldown (${remainSec}s remaining).`;
    console.warn(`[CronCrawler] ${msg}`);
    return { processed: 0, fulfilled: 0, failed: 0, skipped: 0, floodWaitTriggered: true, logs: [msg] };
  }

  cronConfig.isRunningBatch = true;
  cronConfig.lastRunAt = new Date().toISOString();
  const logs: string[] = [];
  let fulfilled = 0;
  let failed = 0;
  let skipped = 0;

  try {
    // Fetch pending items
    const queueRows = (await db.execute({
      sql: `SELECT * FROM crawler_batch_queue 
            WHERE status = 'pending' OR (status = 'failed' AND attempts < ?) 
            ORDER BY id ASC LIMIT ?`,
      args: [cronConfig.maxRetries, limit]
    })).rows as unknown as BatchQueueItem[];

    if (queueRows.length === 0) {
      logs.push("Queue empty. No pending items to process.");
      cronConfig.isRunningBatch = false;
      return { processed: 0, fulfilled: 0, failed: 0, skipped: 0, floodWaitTriggered: false, logs };
    }

    logs.push(`Starting batch crawl of ${queueRows.length} movies...`);

    for (const item of queueRows) {
      // Re-verify if user paused or stopped cron mid-batch
      if (!cronConfig.isEnabled && !isManualTrigger) {
        logs.push("Cron job stopped by user. Halting batch safely.");
        break;
      }

      // Re-check FloodWait before each query
      if (floodWaitCooldownUntil !== null && Date.now() < floodWaitCooldownUntil) {
        logs.push(`FloodWait cooldown hit. Halting batch safely.`);
        break;
      }

      const searchQuery = sanitizeSearchQuery(item.clean_title);
      if (!searchQuery || searchQuery.length < 2) {
        await db.execute({
          sql: "UPDATE crawler_batch_queue SET status = 'failed', last_error = 'Invalid title name', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          args: [item.id]
        });
        continue;
      }

      // Mark processing
      await db.execute({
        sql: "UPDATE crawler_batch_queue SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        args: [item.id]
      });

      // Quick secondary deduplication check in case it was added in the meantime
      const dupCheck = await checkVaultDuplicate(item.clean_title, item.requested_quality, item.year || undefined);
      if (dupCheck.isDuplicate) {
        let note = dupCheck.reason || "Duplicate found in Vault";
        try {
          // "Second quality for everything": a title we hold in one quality gets a low-priority job for the other one.
          const svc = await import("../crawler/service.js");
          const { getCrawlerSettings } = await import("../crawler/settings.js");
          const { missingTier } = await import("../crawler/quality.js");
          if ((await getCrawlerSettings()).secondQuality === "all") {
            const need = missingTier(await svc.heldQualities(item.clean_title, item.year));
            if (need) {
              await svc.submitJob({ kind: "movie", title: item.clean_title, year: item.year || null, quality: need, priority: svc.PRIORITY.cron, source: "companion" });
              note += `; also looking for ${need}`;
            }
          }
        } catch { /* the skip below still applies */ }
        await db.execute({
          sql: "UPDATE crawler_batch_queue SET status = 'duplicate_skipped', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          args: [note, item.id]
        });
        skipped++;
        logs.push(`⏭️ Skipped "${searchQuery}": ${dupCheck.reason}`);
        continue;
      }

      let itemFulfilled = false;
      let lastErr = "";

      // One job per title: the engine tries every suitable bot (with failover, verification and tracing).
      const { requestAndWait } = await import("../crawler/service.js");
      logs.push(`🔍 Looking for "${searchQuery}"…`);
      const { job } = await requestAndWait(
        { kind: "movie", title: item.clean_title, year: item.year || null, quality: item.requested_quality || null, priority: 2, source: "cron" },
        5 * 60_000
      );

      if (job?.status === "done") {
        let res: any = {};
        try { res = JSON.parse(job.result_json || "{}"); } catch { /* keep empty */ }
        const mediaId = res.mediaFileId ? Number(res.mediaFileId) : null;
        const stored: any = mediaId ? (await db.execute({ sql: "SELECT year FROM media_files WHERE id = ?", args: [mediaId] })).rows[0] : null;
        const discoveredYear = item.year || stored?.year || (await lookupMovieYear(searchQuery)) || null;
        itemFulfilled = true;
        fulfilled++;
        await db.execute({
          sql: `UPDATE crawler_batch_queue SET status = 'completed', bot_used = ?, year = COALESCE(year, ?), media_file_id = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          args: [res.bot || null, discoveredYear, mediaId, item.id]
        });
        if (discoveredYear && mediaId) {
          await db.execute({ sql: "UPDATE media_files SET year = ? WHERE id = ? AND (year IS NULL OR year = '')", args: [discoveredYear, mediaId] });
        }
        logs.push(`✅ Added "${searchQuery}"${discoveredYear ? ` (${discoveredYear})` : ""} via ${res.bot || "a search bot"}.`);
      } else {
        lastErr = job ? (job.error || `ended as ${job.status}`) : "still working; will be picked up again";
      }

      if (!itemFulfilled) {
        failed++;
        const newStatus = (item.attempts + 1) >= cronConfig.maxRetries ? "failed" : "pending";
        await db.execute({
          sql: "UPDATE crawler_batch_queue SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          args: [newStatus, lastErr || "Not found on any search bots", item.id]
        });
        logs.push(`❌ Failed "${item.clean_title}": ${lastErr || "Not found on external bots"}`);
      }

      // Safe delay between items (7s) to protect auxiliary account
      await new Promise(r => setTimeout(r, cronConfig.delayBetweenItemsMs));
    }

    logActivity({
      type: "channel_crawl",
      source: "Cron Scheduler",
      title: `Batch Run Complete (${fulfilled} fulfilled, ${failed} failed, ${skipped} skipped)`,
      details: logs.slice(-3).join(" | "),
      status: fulfilled > 0 ? "success" : "cooldown"
    });

  } catch (batchErr: any) {
    logs.push(`Batch error: ${batchErr.message}`);
    console.error("[CronCrawler] Batch error:", batchErr);
  } finally {
    cronConfig.isRunningBatch = false;
  }

  return {
    processed: fulfilled + failed + skipped,
    fulfilled,
    failed,
    skipped,
    floodWaitTriggered: floodWaitCooldownUntil !== null && Date.now() < floodWaitCooldownUntil,
    logs
  };
}

/**
 * Configure & Start / Stop the recurring background cron job timer
 */
export function configureCronJob(options: Partial<CronConfig>): CronConfig {
  if (options.isEnabled !== undefined) cronConfig.isEnabled = options.isEnabled;
  if (options.batchSize !== undefined) cronConfig.batchSize = Math.max(1, Math.min(25, options.batchSize));
  if (options.intervalMinutes !== undefined) cronConfig.intervalMinutes = Math.max(1, options.intervalMinutes);
  if (options.delayBetweenItemsMs !== undefined) cronConfig.delayBetweenItemsMs = Math.max(3000, options.delayBetweenItemsMs);
  if (options.maxRetries !== undefined) cronConfig.maxRetries = Math.max(1, options.maxRetries);

  if (!cronConfig.isEnabled) {
    floodWaitCooldownUntil = null;
    cronConfig.isRunningBatch = false;
  }

  if (cronTimerHandle) {
    clearInterval(cronTimerHandle);
    cronTimerHandle = null;
  }

  if (cronConfig.isEnabled) {
    const intervalMs = cronConfig.intervalMinutes * 60 * 1000;
    cronConfig.nextRunAt = new Date(Date.now() + intervalMs).toISOString();

    cronTimerHandle = setInterval(async () => {
      console.log(`[CronScheduler] Triggering scheduled batch crawl (${cronConfig.batchSize} items)...`);
      await processCronBatch(cronConfig.batchSize);
      cronConfig.nextRunAt = new Date(Date.now() + (cronConfig.intervalMinutes * 60 * 1000)).toISOString();
    }, intervalMs);

    // Immediately trigger initial batch run upon start so user doesn't have to wait for interval
    setTimeout(async () => {
      if (cronConfig.isEnabled && !cronConfig.isRunningBatch) {
        console.log(`[CronScheduler] Triggering initial batch crawl on cron start...`);
        await processCronBatch(cronConfig.batchSize);
      }
    }, 500);

    console.log(`[CronScheduler] Started cron job: every ${cronConfig.intervalMinutes}m, batch size ${cronConfig.batchSize}.`);
  } else {
    cronConfig.nextRunAt = null;
    console.log("[CronScheduler] Cron job stopped/paused.");
  }

  // Persist settings asynchronously
  setSetting("cron_config", JSON.stringify(cronConfig)).catch(e => {
    console.warn("[CronScheduler] Persist setting error:", e.message);
  });

  return cronConfig;
}

export function stopAllCronJobs(): void {
  cronConfig.isEnabled = false;
  cronConfig.isRunningBatch = false;
  cronConfig.nextRunAt = null;
  floodWaitCooldownUntil = null;
  if (cronTimerHandle) {
    clearInterval(cronTimerHandle);
    cronTimerHandle = null;
  }
  setSetting("cron_config", JSON.stringify(cronConfig)).catch(() => {});
  console.log("[CronScheduler] EMERGENCY STOP: All background cron jobs & batches cancelled.");
}

export async function getCronStatus() {
  // Get queue counts
  let counts = {
    total: 0,
    pending: 0,
    processing: 0,
    completed: 0,
    duplicate_skipped: 0,
    failed: 0
  };

  try {
    const rows = (await db.execute(`
      SELECT status, COUNT(*) as count FROM crawler_batch_queue GROUP BY status
    `)).rows;

    for (const r of rows as any[]) {
      const st = r.status as keyof typeof counts;
      const cnt = Number(r.count) || 0;
      counts.total += cnt;
      if (st in counts) {
        counts[st] = cnt;
      }
    }
  } catch (_) {}

  return {
    config: cronConfig,
    counts,
    floodWaitActive: floodWaitCooldownUntil !== null && Date.now() < floodWaitCooldownUntil,
    floodWaitSeconds: floodWaitCooldownUntil !== null && Date.now() < floodWaitCooldownUntil ? Math.ceil((floodWaitCooldownUntil - Date.now()) / 1000) : 0
  };
}

export async function getCronBatchQueue(status?: string, limit: number = 50): Promise<BatchQueueItem[]> {
  try {
    if (status && status !== "all") {
      const rows = (await db.execute({
        sql: "SELECT * FROM crawler_batch_queue WHERE status = ? ORDER BY id DESC LIMIT ?",
        args: [status, limit]
      })).rows;
      return rows as unknown as BatchQueueItem[];
    }
    const rows = (await db.execute({
      sql: "SELECT * FROM crawler_batch_queue ORDER BY id DESC LIMIT ?",
      args: [limit]
    })).rows;
    return rows as unknown as BatchQueueItem[];
  } catch (_) {
    return [];
  }
}

export async function clearCronBatchQueue(type: "all" | "completed" | "failed" = "completed"): Promise<boolean> {
  try {
    if (type === "all") {
      await db.execute("DELETE FROM crawler_batch_queue");
    } else if (type === "completed") {
      await db.execute("DELETE FROM crawler_batch_queue WHERE status IN ('completed', 'duplicate_skipped')");
    } else if (type === "failed") {
      await db.execute("DELETE FROM crawler_batch_queue WHERE status = 'failed'");
    }
    return true;
  } catch (_) {
    return false;
  }
}

export async function requeueBatchQueue(type: "failed" | "skipped" | "all" = "all"): Promise<number> {
  try {
    let sql = "";
    if (type === "all") {
      sql = "UPDATE crawler_batch_queue SET status = 'pending', attempts = 0, last_error = NULL";
    } else if (type === "failed") {
      sql = "UPDATE crawler_batch_queue SET status = 'pending', attempts = 0, last_error = NULL WHERE status = 'failed'";
    } else if (type === "skipped") {
      sql = "UPDATE crawler_batch_queue SET status = 'pending', attempts = 0, last_error = NULL WHERE status = 'duplicate_skipped'";
    }
    const res = await db.execute(sql);
    return Number(res.rowsAffected) || 0;
  } catch (err: any) {
    console.warn("Re-queue batch error:", err.message);
    return 0;
  }
}


/**
 * On boot, items that were mid-flight when the server stopped go back to 'pending' so the crawl resumes.
 * (The queue lives in the database; there is no disk copy.)
 */
export async function resetInterruptedQueueItems(): Promise<void> {
  try {
    const res = await db.execute("UPDATE crawler_batch_queue SET status = 'pending' WHERE status = 'processing'");
    if (res.rowsAffected > 0) console.log(`[CrawlerQueue] Reset ${res.rowsAffected} interrupted 'processing' items back to 'pending'.`);
  } catch (err: any) {
    console.warn("[CrawlerQueue] Could not reset interrupted items:", err.message);
  }
}


