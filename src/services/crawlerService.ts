import stringSimilarity from "string-similarity";
import { addMediaFile, logChannelEvent, markRequestsFulfilled, db, getSetting, setSetting, deleteSetting } from "../db/index.js";
import { searchMovies } from "./movieProvider.js";
import { getOfficialTrailer } from "./trailerService.js";
import { parseMediaTitleAndSeriesInfo, normalizeQuality } from "./seriesParser.js";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import axios from "axios";
import fs from "fs";
import path from "path";

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
import { withBotLock } from "../crawler/lock.js";

export async function getEffectiveVaultChannelId(isSeries?: boolean): Promise<string> {
  if (isSeries) {
    const customSeries = await getSetting("telegram_series_vault_channel_id");
    if (customSeries && customSeries.trim()) return customSeries.trim();
    if (process.env.TELEGRAM_SERIES_VAULT_CHANNEL_ID && process.env.TELEGRAM_SERIES_VAULT_CHANNEL_ID.trim()) {
      return process.env.TELEGRAM_SERIES_VAULT_CHANNEL_ID.trim();
    }
    return "-1003983385552"; // Dedicated BusiMovie TV Series Storage Channel
  }

  // Movies Storage Channel
  const custom = await getSetting("telegram_vault_channel_id");
  if (custom && custom.trim()) return custom.trim();
  if (process.env.TELEGRAM_VAULT_CHANNEL_ID && process.env.TELEGRAM_VAULT_CHANNEL_ID.trim()) {
    return process.env.TELEGRAM_VAULT_CHANNEL_ID.trim();
  }
  return "-1004314551318"; // Dedicated BusiMovie Movies Storage Channel
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

  let authResult: any;
  try {
    authResult = await pendingClient.invoke(
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
      authResult = await pendingClient.signInWithPassword(
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
}): Promise<SearchBot> {
  const res = await db.execute({
    sql: "INSERT INTO search_bots (bot_username, bot_type, command_template, status, priority) VALUES (?, ?, ?, 'active', ?)",
    args: [
      bot.bot_username.trim(),
      bot.bot_type || "inline",
      bot.command_template || "/search {query}",
      bot.priority || 1
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

export async function getSearchJobs(): Promise<SearchJob[]> {
  const rows = (await db.execute("SELECT * FROM search_jobs ORDER BY created_at DESC LIMIT 50")).rows;
  searchJobs = rows as unknown as SearchJob[];
  return searchJobs;
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
}> {
  const target = (await db.execute({
    sql: "SELECT * FROM crawler_targets WHERE id = ?",
    args: [targetId]
  })).rows[0] as unknown as CrawlerTarget;

  if (!target) throw new Error("Target channel not found");

  const client = await getConnectedClient();
  if (!client) {
    throw new Error("Auxiliary Telegram account is not connected. Please connect your auxiliary account first in the setup card above.");
  }

  const vaultId = await getEffectiveVaultChannelId();
  if (!vaultId) {
    throw new Error("No private vault channel configured. Please verify your Vault Channel ID.");
  }

  // Mark target as syncing
  await db.execute({
    sql: "UPDATE crawler_targets SET status = 'syncing' WHERE id = ?",
    args: [targetId]
  });

  logActivity({
    type: "channel_crawl",
    source: target.channel_identifier,
    title: `Started Live MTProto Crawl (${messageLimit} msgs)`,
    details: `Scanning real video messages on ${target.title}...`,
    status: "success"
  });

  let scanned = 0;
  let ingested = 0;
  let filtered = 0;
  const titlesFound: string[] = [];

  try {
    const targetEntity = await client.getEntity(target.channel_identifier);
    const vaultEntity = await client.getEntity(vaultId);

    const msgs = await client.getMessages(targetEntity, { limit: messageLimit });
    const minBytes = (target.min_file_size_mb || 300) * 1024 * 1024;

    for (const m of msgs) {
      scanned++;
      const isVideo = Boolean(
        m.media && (
          m.media.className === "MessageMediaDocument" ||
          m.document?.mimeType?.startsWith("video/") ||
          m.document?.attributes?.some((a: any) => 
            a.className === "DocumentAttributeVideo" || 
            a.fileName?.match(/\.(mp4|mkv|avi|mov|webm|flv|ts)$/i)
          )
        )
      );

      if (!isVideo) {
        continue;
      }

      const size = Number((m.document as any)?.size || 0);
      if (size < minBytes) {
        filtered++;
        continue;
      }

      const fnAttr = ((m.document as any)?.attributes || []).find((a: any) => a.className === "DocumentAttributeFilename") as any;
      const filename = fnAttr?.fileName || m.message || `Video_${m.id}.mp4`;

      // Check quality filter if specified
      if (target.quality_filter !== "all") {
        const qualityTarget = target.quality_filter.toLowerCase();
        const textToTest = `${filename} ${m.message || ""}`.toLowerCase();
        if (!textToTest.includes(qualityTarget)) {
          filtered++;
          continue;
        }
      }

      // Forward directly into private vault channel
      try {
        const fwdRes = await client.forwardMessages(vaultEntity, {
          messages: [m.id],
          fromPeer: targetEntity
        });

        ingested++;
        titlesFound.push(filename);

        const newFwdMsg = Array.isArray(fwdRes) ? fwdRes[0] : fwdRes;
        const newMsgId = newFwdMsg?.id ? String(newFwdMsg.id) : "";

        const parsedInfo = parseMediaTitleAndSeriesInfo(filename);
        const parsedTitle = parsedInfo.cleanTitle || filename.replace(/\.[a-zA-Z0-9]+$/, "").trim();
        const year = parsedInfo.year || "";
        const quality = parsedInfo.quality || "1080p";

        try {
          if (newMsgId) {
            await addMediaFile({
              movie_id: `tg_${Date.now()}`,
              movie_title: parsedTitle,
              year,
              telegram_file_id: String(m.id),
              telegram_channel_id: vaultId,
              telegram_message_id: newMsgId,
              file_name: filename,
              file_size: size,
              quality,
              language: "English",
              mime_type: (m.document as any)?.mimeType || "video/mp4",
              season: parsedInfo.isSeries ? (parsedInfo.season ?? 1) : null,
              episode: parsedInfo.isSeries ? (parsedInfo.episode ?? null) : null
            });
          }
        } catch (_) {}

        logActivity({
          type: "vault_forward",
          source: target.channel_identifier,
          title: `Forwarded to Vault: ${parsedTitle}${parsedInfo.isSeries && parsedInfo.season ? ` (S${parsedInfo.season}E${parsedInfo.episode || '?'})` : ''}`,
          details: `Forwarded "${filename}" to ${(vaultEntity as any)?.title || "Vault channel"} and indexed as "${parsedTitle}".`,
          status: "success"
        });

        // Respect Telegram anti-flood pace
        await new Promise(r => setTimeout(r, 1400));
      } catch (fwdErr: any) {
        console.warn(`[Backfill] Failed to forward message ${m.id}:`, fwdErr.message);
      }
    }
  } catch (err: any) {
    logActivity({
      type: "channel_crawl",
      source: target.channel_identifier,
      title: `Crawl Failed: ${target.title}`,
      details: err.message,
      status: "error"
    });
    await db.execute({
      sql: "UPDATE crawler_targets SET status = 'active' WHERE id = ?",
      args: [targetId]
    });
    throw err;
  }

  // Update target stats
  await db.execute({
    sql: "UPDATE crawler_targets SET status = 'active', last_crawled_at = CURRENT_TIMESTAMP, total_files_found = total_files_found + ? WHERE id = ?",
    args: [ingested, targetId]
  });

  return { scanned, ingested, filtered, titlesFound };
}

/**
 * Real-time MTProto Search Bot Query.
 * Sends the real search query to an external bot via Telegram MTProto,
 * captures the reply text, download buttons, and media options.
 */
export async function testQuerySearchBot(botUsername: string, query: string): Promise<{
  bot: string;
  query: string;
  found: boolean;
  replyText?: string;
  messageId?: number;
  hasDirectMedia?: boolean;
  buttons?: Array<{
    text: string;
    row: number;
    col: number;
    data?: string;
    url?: string;
    isDownload?: boolean;
  }>;
  match?: {
    title: string;
    year: string;
    quality: string;
    file_size_bytes: number;
    file_name: string;
  };
  duration_ms: number;
  error?: string;
}> {
  const startTime = Date.now();
  const cleanQuery = query.trim();

  const client = await getConnectedClient();
  if (!client) {
    throw new Error("Auxiliary Telegram account is not connected. Please connect your auxiliary Telegram account in the dashboard above.");
  }

  const cleanUsername = botUsername.trim().startsWith("@") ? botUsername.trim() : `@${botUsername.trim()}`;
  let botEntity: any;
  try {
    botEntity = await client.getEntity(cleanUsername);
  } catch (err: any) {
    throw new Error(`Could not reach bot ${cleanUsername}: ${err.message}. Ensure the username is correct.`);
  }

  // Record baseline message ID from this bot before sending query
  const prevMsgs = await client.getMessages(botEntity, { limit: 1 });
  const lastId = prevMsgs[0]?.id || 0;

  // Send search command/query to bot
  await client.sendMessage(botEntity, { message: cleanQuery });

  // Poll for up to 10 seconds for bot reply
  let replyMsg: any = null;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const recent = await client.getMessages(botEntity, { limit: 5 });
    const unread = recent.filter((m: any) => !m.out && m.id > lastId);
    if (unread.length > 0) {
      replyMsg = unread[0];
      break;
    }
  }

  const duration = Date.now() - startTime;

  if (!replyMsg) {
    return {
      bot: cleanUsername,
      query: cleanQuery,
      found: false,
      duration_ms: duration,
      error: `Bot ${cleanUsername} did not reply within 10 seconds. It may be sleeping or rate-limited.`
    };
  }

  // Attempt auto-joining public channels if the bot asks to join channels
  if (replyMsg.message && /join\s*@/i.test(replyMsg.message)) {
    const channelMatches = replyMsg.message.match(/@([a-zA-Z0-9_]+)/g) || [];
    for (const cm of channelMatches) {
      const chName = cm.replace("@", "");
      if (chName.toLowerCase() !== cleanUsername.replace("@", "").toLowerCase()) {
        try {
          const chEnt = await client.getEntity(chName);
          await client.invoke(new Api.channels.JoinChannel({ channel: chEnt }));
        } catch (_) {}
      }
    }
  }

  // Parse inline buttons from the bot response
  const buttons: Array<{
    text: string;
    row: number;
    col: number;
    data?: string;
    url?: string;
    isDownload?: boolean;
  }> = [];

  if (replyMsg.replyMarkup?.rows) {
    replyMsg.replyMarkup.rows.forEach((row: any, rIdx: number) => {
      row.buttons.forEach((btn: any, cIdx: number) => {
        const isNav = /^\d+\/\d+$/.test(btn.text.trim()) || /^(next|back|previous|close)\s*[❯❮>|<]?$/i.test(btn.text.trim());
        const isDl = !isNav && (
          /\b(GB|MB|KB|1080p|720p|480p|4K|2160p|mkv|mp4|download|get)\b/i.test(btn.text) ||
          (btn.data && btn.data.toString().startsWith("get_"))
        );
        buttons.push({
          text: btn.text,
          row: rIdx,
          col: cIdx,
          data: btn.data ? (Buffer.isBuffer(btn.data) ? btn.data.toString("utf8") : String(btn.data)) : undefined,
          url: btn.url,
          isDownload: isDl
        });
      });
    });
  }

  const hasDirectMedia = Boolean(
    replyMsg.media && (
      replyMsg.media.className === "MessageMediaDocument" ||
      replyMsg.media.className === "MessageMediaVideo" ||
      replyMsg.document?.mimeType?.startsWith("video/")
    )
  );

  const isNegativeReply = Boolean(
    replyMsg.message && (
      /no results? (found|matched)/i.test(replyMsg.message) ||
      /not found/i.test(replyMsg.message) ||
      /could not find/i.test(replyMsg.message) ||
      /❌/i.test(replyMsg.message) ||
      /nothing found/i.test(replyMsg.message) ||
      /no matches/i.test(replyMsg.message)
    )
  );

  const downloadButtons = buttons.filter(b => b.isDownload || /\b(1080p|720p|480p|4K|2160p|GB|MB|Download|Get)\b/i.test(b.text));
  let isFound = !isNegativeReply && (downloadButtons.length > 0 || hasDirectMedia);

  // Multi-Step Bot Auto-Resolver (e.g. for bots like @iPapkornEzPzBot, @iPapkornDeltaBot, @cinemagic_hd_bot where Step 1 is a movie title list)
  if (!isFound && !hasDirectMedia && buttons.length > 0 && !isNegativeReply) {
    const titleCandidates = buttons.filter(b => !isBackOrNavButton(b.text));
    const bestTitleBtn = selectBestMatchingButton(titleCandidates, cleanQuery);

    if (bestTitleBtn) {
      console.log(`[Two-Step Auto-Resolver] Clicking title button "${bestTitleBtn.text}" on ${cleanUsername}...`);
      try {
        if (replyMsg.replyMarkup?.rows[bestTitleBtn.row]?.buttons[bestTitleBtn.col]) {
          await replyMsg.click(replyMsg.replyMarkup.rows[bestTitleBtn.row].buttons[bestTitleBtn.col]);
        } else {
          throw new Error("The button is no longer on the bot's screen; refusing to click blind.");
        }

        // Wait up to 6 seconds for step 2 (quality list or new message)
        for (let i = 0; i < 6; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const recent = await client.getMessages(botEntity, { limit: 4 });
          const step2Msg = recent.find((m: any) => !m.out && m.id >= replyMsg.id && (m.id > replyMsg.id || m.editDate));
          if (step2Msg) {
            // Check if step 2 directly returned media
            const step2HasMedia = Boolean(
              step2Msg.media && (
                (step2Msg.media as any).className === "MessageMediaDocument" ||
                (step2Msg.media as any).className === "MessageMediaVideo" ||
                step2Msg.document?.mimeType?.startsWith("video/")
              )
            );

            if (step2HasMedia) {
              return {
                bot: cleanUsername,
                query: cleanQuery,
                found: true,
                replyText: step2Msg.message,
                messageId: step2Msg.id,
                hasDirectMedia: true,
                buttons: [],
                duration_ms: Date.now() - startTime
              };
            }

            if ((step2Msg.replyMarkup as any)?.rows) {
              const step2Buttons: CandidateButton[] = [];
              (step2Msg.replyMarkup as any).rows.forEach((row: any, rIdx: number) => {
                row.buttons.forEach((btn: any, cIdx: number) => {
                  const isNav = isBackOrNavButton(btn.text);
                  const isDl = !isNav && (
                    /\b(GB|MB|KB|1080p|720p|480p|4K|2160p|mkv|mp4|download|get|stream|watch)\b/i.test(btn.text) ||
                    (btn.data && (btn.data.toString().startsWith("get_") || btn.data.toString().startsWith("dl_") || btn.data.toString().startsWith("file_")))
                  );
                  step2Buttons.push({
                    text: btn.text,
                    row: rIdx,
                    col: cIdx,
                    data: btn.data ? (Buffer.isBuffer(btn.data) ? btn.data.toString("utf8") : String(btn.data)) : undefined,
                    url: btn.url,
                    isDownload: isDl
                  });
                });
              });

              if (step2Buttons.length > 0) {
                return {
                  bot: cleanUsername,
                  query: cleanQuery,
                  found: true,
                  replyText: step2Msg.message,
                  messageId: step2Msg.id,
                  hasDirectMedia: false,
                  buttons: step2Buttons,
                  duration_ms: Date.now() - startTime
                };
              }
            }
          }
        }
      } catch (clickErr: any) {
        console.warn("[Two-Step Auto-Resolver] Click warning:", clickErr?.message);
      }
    }
  }

  // Increment bot success count if found
  if (isFound) {
    await db.execute({
      sql: "UPDATE search_bots SET success_count = success_count + 1, last_queried_at = CURRENT_TIMESTAMP WHERE bot_username = ?",
      args: [cleanUsername]
    });
  }

  logActivity({
    type: "bot_search",
    source: cleanUsername,
    title: `Queried Bot: "${cleanQuery}"`,
    details: `Response in ${duration}ms. ${buttons.length} buttons, media: ${hasDirectMedia ? "Yes" : "Buttons"}, found: ${isFound}`,
    status: isFound ? "success" : "filtered"
  });

  const firstDownloadBtn = downloadButtons[0] || (hasDirectMedia ? { text: replyMsg.message || cleanQuery } : null);
  const fnMatch = firstDownloadBtn?.text || cleanQuery;

  return {
    bot: cleanUsername,
    query: cleanQuery,
    found: isFound,
    replyText: replyMsg.message,
    messageId: replyMsg.id,
    hasDirectMedia,
    buttons,
    match: isFound ? {
      title: cleanQuery,
      year: fnMatch.match(/\b(19\d\d|20\d\d)\b/)?.[1] || "",
      quality: fnMatch.match(/\b(2160p|4K|1080p|720p|480p)\b/i)?.[1]?.toUpperCase() || "HD",
      file_size_bytes: 1000000000,
      file_name: fnMatch
    } : undefined,
    duration_ms: duration
  };
}

export { type CandidateButton, isBackOrNavButton, selectBestMatchingButton } from "../crawler/buttons.js";
import { type CandidateButton, isBackOrNavButton, selectBestMatchingButton } from "../crawler/buttons.js";

/**
 * Fetch a specific file from a search bot response and forward it directly to the Vault channel.
 * Real MTProto: Clicks the download button on Telegram, waits for the media document,
 * forwards it to your private channel, where your bot indexes it for users!
 */
export async function fetchAndForwardBotMedia(params: {
  botUsername: string;
  messageId: number;
  buttonRow?: number;
  buttonCol?: number;
  userTelegramId?: string | number;
  isSeries?: boolean;
  /** What the caller asked for; the downloaded file is checked against it before anything is forwarded. */
  expect?: DownloadExpectation;
}): Promise<{
  success: boolean;
  message: string;
  fileName?: string;
  fileSizeBytes?: number;
  mediaFileId?: number;
  channelMessageId?: string;
  deliveredDirectly?: boolean;
}> {
  const client = await getConnectedClient();
  if (!client) {
    throw new Error("Auxiliary Telegram account is not connected.");
  }

  const vaultId = await getEffectiveVaultChannelId(params.isSeries);
  if (!vaultId) {
    throw new Error("No private storage channel configured.");
  }

  const vaultEntity = await client.getEntity(vaultId);
  const cleanUsername = params.botUsername.trim().startsWith("@") ? params.botUsername.trim() : `@${params.botUsername.trim()}`;
  const botEntity = await client.getEntity(cleanUsername);

  let mediaMsgToForward: any = null;

  if (params.buttonRow !== undefined) {
    // Click the specific download button
    const msgs = await client.getMessages(botEntity, { ids: [params.messageId] });
    if (!msgs || msgs.length === 0) {
      throw new Error("Original bot reply message not found.");
    }

    try {
      const msg = msgs[0] as any;
      if (msg.replyMarkup?.rows && msg.replyMarkup.rows[params.buttonRow]) {
        const btn = msg.replyMarkup.rows[params.buttonRow].buttons[params.buttonCol || 0];
        if (btn) {
          await msg.click(btn);
        } else {
          throw new Error("The button is no longer on the bot's screen; refusing to click blind.");
        }
      } else {
        throw new Error("The button is no longer on the bot's screen; refusing to click blind.");
      }
    } catch (clickErr: any) {
      console.warn("Button click error:", clickErr.message);
    }

    // Autonomous Intelligent Eye: Monitors bot state, automatically recognizes release file buttons,
    // follows multi-step menus (Source -> Release File -> Media), and secures the media document.
    let followUpClicks = 0;
    const maxFollowUpClicks = 3;
    const clickedMsgButtonKeys = new Set<string>();

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const recent = await client.getMessages(botEntity, { limit: 8 });

      // 1. Check if media document has arrived
      const found = recent.find((m: any) => !m.out && m.id >= params.messageId && (
        (m.media as any)?.className === "MessageMediaDocument" ||
        (m.media as any)?.className === "MessageMediaVideo" ||
        (m.document as any)?.mimeType?.startsWith("video/") ||
        (m.document as any)?.attributes?.some((a: any) => a.className === "DocumentAttributeVideo")
      ));
      if (found) {
        mediaMsgToForward = found;
        break;
      }

      // 2. Intelligent Eye Menu Inspector:
      // If no media yet, inspect any new or updated messages containing inline buttons
      if (followUpClicks < maxFollowUpClicks) {
        const candidateMsg = recent.find((m: any) => 
          !m.out && 
          m.id >= params.messageId && 
          (m.replyMarkup as any)?.rows?.length > 0 &&
          (m.id > params.messageId || m.editDate)
        );

        if (candidateMsg) {
          const allButtons: Array<{ text: string; row: number; col: number; data?: string; score: number }> = [];

          (candidateMsg.replyMarkup as any).rows.forEach((row: any, rIdx: number) => {
            row.buttons.forEach((btn: any, cIdx: number) => {
              if (isBackOrNavButton(btn.text)) return;
              const text = btn.text || "";
              const dataStr = btn.data ? (Buffer.isBuffer(btn.data) ? btn.data.toString("utf8") : String(btn.data)) : "";

              // Skip if back / cancel / report
              if (/\b(go\s*back|back|cancel|report|issue|help|close)\b/i.test(text)) return;

              let score = 0;
              // File name with video extension (.mp4, .mkv, .avi)
              if (/\.(mp4|mkv|avi|webm)\b/i.test(text)) score += 50;
              // File size indicators (e.g. "908.54MB", "1.4GB", "700MB")
              if (/\b\d+(\.\d+)?\s*(GB|MB|KB)\b/i.test(text)) score += 40;
              // Encoding / Quality tags (WEBRip, BluRay, 1080p, 720p, 480p, x264, x265, HEVC)
              if (/\b(1080p|720p|480p|4K|2160p|webrip|bluray|web-dl|x264|x265|hevc|dvdrip)\b/i.test(text)) score += 30;
              // Action verbs
              if (/\b(download|get file|start|send|download now|get)\b/i.test(text)) score += 20;
              // Callback data patterns
              if (/^(get_|dl_|file_|down_|f_)/i.test(dataStr)) score += 20;

              if (score > 0) {
                allButtons.push({ text, row: rIdx, col: cIdx, data: dataStr, score });
              }
            });
          });

          // Sort by highest score (files with size/extension take precedence)
          allButtons.sort((a, b) => b.score - a.score);

          if (allButtons.length > 0) {
            const targetBtn = allButtons[0];
            const clickKey = `${candidateMsg.id}:${targetBtn.row}:${targetBtn.col}`;

            if (!clickedMsgButtonKeys.has(clickKey)) {
              clickedMsgButtonKeys.add(clickKey);
              followUpClicks++;
              console.log(`[Intelligent Eye] Auto-advancing step ${followUpClicks}: Clicking "${targetBtn.text}" (score: ${targetBtn.score}) on ${cleanUsername}...`);

              try {
                if ((candidateMsg.replyMarkup as any).rows[targetBtn.row]?.buttons[targetBtn.col]) {
                  await candidateMsg.click((candidateMsg.replyMarkup as any).rows[targetBtn.row].buttons[targetBtn.col]);
                } else {
                  await candidateMsg.click({ i: targetBtn.row, j: targetBtn.col } as any);
                }
              } catch (stepErr: any) {
                console.warn("[Intelligent Eye] Follow-up click error:", stepErr?.message);
              }
            }
          }
        }
      }
    }
  } else {
    // Message already has direct media
    const msgs = await client.getMessages(botEntity, { ids: [params.messageId] });
    if (msgs && msgs[0]?.media) {
      mediaMsgToForward = msgs[0];
    }
  }

  if (!mediaMsgToForward) {
    throw new Error("The bot did not return a video media message. If the bot required joining a channel, try clicking again now that channels are joined.");
  }

  // 0. Verification gate: refuse to store a file that is clearly not what was requested.
  {
    const preAttr = ((mediaMsgToForward.document as any)?.attributes || []).find((a: any) => a.className === "DocumentAttributeFilename") as any;
    const preName = preAttr?.fileName || "";
    const check = verifyDownloadedFile(params.expect, preName, mediaMsgToForward.message);
    if (!check.ok) {
      logActivity({
        type: "vault_forward",
        source: cleanUsername,
        title: `Rejected wrong file from ${cleanUsername}`,
        details: `${check.reason} (file: "${preName || "unnamed"}")`,
        status: "failed"
      } as any);
      return { success: false, message: `The file from ${cleanUsername} did not match the request. ${check.reason}` };
    }
  }

  // 1. Forward the real file into the storage channel for catalog preservation
  const forwardedResult = await client.forwardMessages(vaultEntity, {
    messages: [mediaMsgToForward.id],
    fromPeer: botEntity
  });

  // Robustly extract the real channel message ID
  let realChannelMsgId = "";
  if (forwardedResult) {
    if ((forwardedResult as any).updates && Array.isArray((forwardedResult as any).updates)) {
      for (const u of (forwardedResult as any).updates) {
        if (u.message?.id) {
          realChannelMsgId = String(u.message.id);
          break;
        }
        if (u.id) {
          realChannelMsgId = String(u.id);
          break;
        }
      }
    }
    if (!realChannelMsgId && (forwardedResult as any).id) {
      realChannelMsgId = String((forwardedResult as any).id);
    }
    if (!realChannelMsgId && Array.isArray(forwardedResult) && forwardedResult[0]?.id) {
      realChannelMsgId = String(forwardedResult[0].id);
    }
  }

  // No guessing: without a confirmed channel message id the file could not be delivered reliably,
  // and a wrong id would deliver someone else's upload — so we stop here instead.
  if (!realChannelMsgId) {
    return { success: false, message: "The file was sent but its storage position could not be confirmed. Please try again." };
  }

  // Ingest media to storage channel (our bot will deliver to user cleanly without external peer tags)
  let deliveredDirectly = false;

  const fnAttr = ((mediaMsgToForward.document as any)?.attributes || []).find((a: any) => a.className === "DocumentAttributeFilename") as any;
  const fileName = fnAttr?.fileName || mediaMsgToForward.message || "Video.mp4";
  const size = Number((mediaMsgToForward.document as any)?.size || 0);

  const parsedInfo = parseMediaTitleAndSeriesInfo(fileName);
  const parsedMovieTitle = parsedInfo.cleanTitle || fileName.replace(/\.[a-zA-Z0-9]+$/, "").trim();
  const year = parsedInfo.year || "";
  const quality = parsedInfo.quality || "1080p";

  let newFileId: number | undefined;
  try {
    const existing = realChannelMsgId ? (await db.execute({
      sql: "SELECT id FROM media_files WHERE telegram_channel_id = ? AND telegram_message_id = ? LIMIT 1",
      args: [vaultId, realChannelMsgId]
    })).rows : [];

    if (existing.length === 0) {
      newFileId = await addMediaFile({
        movie_id: `tg_${Date.now()}`,
        movie_title: parsedMovieTitle,
        year,
        telegram_file_id: String(mediaMsgToForward.id),
        telegram_channel_id: vaultId,
        telegram_message_id: realChannelMsgId,
        file_name: fileName,
        file_size: size,
        quality,
        language: "English",
        mime_type: (mediaMsgToForward.document as any)?.mimeType || "video/mp4",
        season: parsedInfo.isSeries ? (parsedInfo.season ?? 1) : null,
        episode: parsedInfo.isSeries ? (parsedInfo.episode ?? null) : null
      });
      console.log(`[CrawlerService] Direct indexed forwarded media "${parsedMovieTitle}" as ID ${newFileId} with channel msg ${realChannelMsgId}`);
    } else {
      newFileId = Number(existing[0].id);
      // Ensure telegram_message_id is updated if previously empty
      if (realChannelMsgId) {
        await db.execute({
          sql: "UPDATE media_files SET telegram_message_id = ? WHERE id = ?",
          args: [realChannelMsgId, newFileId]
        });
      }
    }
  } catch (idxErr: any) {
    console.warn("Direct index in fetchAndForwardBotMedia error:", idxErr.message);
  }

  logActivity({
    type: "vault_forward",
    source: cleanUsername,
    title: `Forwarded from ${cleanUsername}: ${parsedMovieTitle}${parsedInfo.isSeries && parsedInfo.season ? ` (S${parsedInfo.season}E${parsedInfo.episode || '?'})` : ''}`,
    details: `Forwarded "${fileName}" to ${(vaultEntity as any)?.title || "Vault channel"} and indexed as "${parsedMovieTitle}".`,
    status: "success"
  });

  return {
    success: true,
    message: `Forwarded "${parsedMovieTitle}" (${quality}) to BusiMovie channel and indexed!`,
    fileName,
    fileSizeBytes: size,
    mediaFileId: newFileId,
    channelMessageId: realChannelMsgId,
  };
}

/**
 * Dedicated Hierarchical TV Series Crawler Engine for @quinsonnbot:
 * Intelligently navigates the 3-step hierarchy (Series -> Season -> Episode),
 * auto-downloads requested episodes or seasons, forwards to storage channel,
 * and indexes them with full Season & Episode metadata in BusiMovie library!
 */
export async function fetchSeriesFromQuinson(params: {
  seriesTitle: string;
  seasonNum?: number;
  episodeNum?: number;
  allEpisodes?: boolean;
  onProgress?: (count: number, latestTitle: string) => Promise<void>;
}): Promise<{
  success: boolean;
  message: string;
  filesIngested: number;
  firstMediaFileId?: number;
  allMediaFileIds?: number[];
}> {
  return withBotLock("@quinsonnbot", async () => {
    const client = await getConnectedClient();
    if (!client) throw new Error("Auxiliary client not connected.");

    const vaultId = await getEffectiveVaultChannelId(true);
    if (!vaultId) throw new Error("No TV series private storage channel configured.");

    const vaultEntity = await client.getEntity(vaultId);
    const botEntity = await client.getEntity("@quinsonnbot");

    console.log(`[QuinsonEngine] Searching series: "${params.seriesTitle}" (Season: ${params.seasonNum || 'All'}, Episode: ${params.episodeNum || (params.allEpisodes ? 'All' : '1')})...`);

    // Step 1: Send search query to @quinsonnbot
    const sentMsg = await client.sendMessage(botEntity, { message: params.seriesTitle.trim() });
    
    // Wait up to 5s for reply
    let step1Reply: any = null;
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const msgs = await client.getMessages(botEntity, { limit: 4 });
      const found = msgs.find((m: any) => !m.out && m.id > sentMsg.id);
      if (found) {
        step1Reply = found;
        break;
      }
    }

    if (!step1Reply || !step1Reply.replyMarkup?.rows) {
      return { success: false, message: `No series match found for "${params.seriesTitle}".`, filesIngested: 0 };
    }

    // Parse candidate series buttons
    const seriesButtons: CandidateButton[] = [];
    step1Reply.replyMarkup.rows.forEach((row: any, rIdx: number) => {
      row.buttons.forEach((btn: any, cIdx: number) => {
        seriesButtons.push({
          text: btn.text,
          row: rIdx,
          col: cIdx,
          data: btn.data ? (Buffer.isBuffer(btn.data) ? btn.data.toString("utf8") : String(btn.data)) : undefined
        });
      });
    });

    const bestSeriesBtn = selectBestMatchingButton(seriesButtons, params.seriesTitle);
    if (!bestSeriesBtn) {
      return { success: false, message: `Could not match series "${params.seriesTitle}".`, filesIngested: 0 };
    }

    // Step 2: Click the Series button (sv_*)
    console.log(`[QuinsonEngine] Clicking series button: "${bestSeriesBtn.text}"...`);
    if (step1Reply.replyMarkup?.rows[bestSeriesBtn.row]?.buttons[bestSeriesBtn.col]) {
      await step1Reply.click(step1Reply.replyMarkup.rows[bestSeriesBtn.row].buttons[bestSeriesBtn.col]);
    } else {
      throw new Error("The button is no longer on the bot's screen; refusing to click blind.");
    }

    // Wait up to 5s for Season grid
    let seasonReply: any = null;
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const msgs = await client.getMessages(botEntity, { limit: 4 });
      const found = msgs.find((m: any) => !m.out && m.id >= step1Reply.id && (m.id > step1Reply.id || m.editDate));
      if (found) {
        seasonReply = found;
        break;
      }
    }

    if (!seasonReply || !seasonReply.replyMarkup?.rows) {
      return { success: false, message: "Season grid did not load.", filesIngested: 0 };
    }

    // Parse season buttons
    const targetSeasonNum = params.seasonNum || 1;
    const targetSeasonPattern = new RegExp(`\\b(s0?${targetSeasonNum}|season\\s*0?${targetSeasonNum})\\b`, "i");
    
    let targetSeasonBtn: CandidateButton | null = null;
    seasonReply.replyMarkup.rows.forEach((row: any, rIdx: number) => {
      row.buttons.forEach((btn: any, cIdx: number) => {
        if (targetSeasonPattern.test(btn.text) || (btn.data && btn.data.includes(`_${targetSeasonNum}|`))) {
          targetSeasonBtn = { text: btn.text, row: rIdx, col: cIdx, data: btn.data?.toString() };
        }
      });
    });

    if (!targetSeasonBtn) {
      targetSeasonBtn = { text: `Season ${targetSeasonNum}`, row: 0, col: 0 };
    }

    // Step 3: Click the Season button (se_*)
    console.log(`[QuinsonEngine] Clicking season button: "${(targetSeasonBtn as any).text}"...`);
    if (seasonReply.replyMarkup?.rows[(targetSeasonBtn as any).row]?.buttons[(targetSeasonBtn as any).col]) {
      await seasonReply.click(seasonReply.replyMarkup.rows[(targetSeasonBtn as any).row].buttons[(targetSeasonBtn as any).col]);
    } else {
      throw new Error("The button is no longer on the bot's screen; refusing to click blind.");
    }

    // Wait up to 5s for Episode grid
    let epReply: any = null;
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const msgs = await client.getMessages(botEntity, { limit: 4 });
      const found = msgs.find((m: any) => !m.out && m.id >= seasonReply.id && (m.id > seasonReply.id || m.editDate));
      if (found) {
        epReply = found;
        break;
      }
    }

    if (!epReply || !epReply.replyMarkup?.rows) {
      return { success: false, message: "Episode list did not load.", filesIngested: 0 };
    }

    // Step 4: Click Episode button or Send All button
    let clickedAction = false;

    if (params.allEpisodes) {
      // Look for a "Send All" / "All Episodes" / "Get All" / "Zip" / "sa_*" button
      let sendAllBtn: any = null;
      epReply.replyMarkup.rows.forEach((row: any, rIdx: number) => {
        row.buttons.forEach((btn: any, cIdx: number) => {
          const text = btn.text || "";
          const dataStr = btn.data ? (Buffer.isBuffer(btn.data) ? btn.data.toString("utf8") : String(btn.data)) : "";
          if (!sendAllBtn && (dataStr.startsWith("sa_") || /\b(send\s*all|all\s*episodes?|get\s*all|download\s*all)\b/i.test(text))) {
            sendAllBtn = { text, row: rIdx, col: cIdx, data: dataStr };
          }
        });
      });

      if (sendAllBtn) {
        console.log(`[QuinsonEngine] Triggering batch season delivery via "${sendAllBtn.text}" (data: ${sendAllBtn.data})...`);
        if (epReply.replyMarkup.rows[sendAllBtn.row]?.buttons[sendAllBtn.col]) {
          await epReply.click(epReply.replyMarkup.rows[sendAllBtn.row].buttons[sendAllBtn.col]);
          clickedAction = true;
        }
      }
    }

    if (!clickedAction) {
      // Select single target episode button
      let targetEpBtn: any = null;
      if (params.episodeNum) {
        const epPattern = new RegExp(`\\b(e0?${params.episodeNum}|ep\\s*0?${params.episodeNum}|episode\\s*0?${params.episodeNum})\\b`, "i");
        epReply.replyMarkup.rows.forEach((row: any, rIdx: number) => {
          row.buttons.forEach((btn: any, cIdx: number) => {
            const dataStr = btn.data ? (Buffer.isBuffer(btn.data) ? btn.data.toString("utf8") : String(btn.data)) : "";
            const isMatchByData = dataStr.includes("epsel_") && (dataStr.endsWith(`_${params.episodeNum}`) || dataStr.includes(`_${targetSeasonNum}_${params.episodeNum}`));
            const isMatchByText = epPattern.test(btn.text);
            if (!targetEpBtn && !isBackOrNavButton(btn.text) && (isMatchByData || isMatchByText)) {
              targetEpBtn = { text: btn.text, row: rIdx, col: cIdx, data: dataStr };
            }
          });
        });
      }

      if (!targetEpBtn) {
        // Never substitute a different episode: a wrong file is worse than an honest "not available".
        throw new Error(params.episodeNum
          ? `Episode ${params.episodeNum} was not found on the series bot's episode list.`
          : "No episode was specified and none could be matched on the bot's screen.");
      }

      console.log(`[QuinsonEngine] Clicking episode button: "${targetEpBtn.text}" (data: ${targetEpBtn.data})...`);
      if (epReply.replyMarkup?.rows[targetEpBtn.row]?.buttons[targetEpBtn.col]) {
        await epReply.click(epReply.replyMarkup.rows[targetEpBtn.row].buttons[targetEpBtn.col]);
      } else {
        throw new Error("The button is no longer on the bot's screen; refusing to click blind.");
      }
    }

    // Ingestion Buffer: Wait for media document(s) to arrive
    // For single episode: max 20 seconds. For batch: max 55 seconds.
    const maxWaitSec = params.allEpisodes ? 55 : 20;
    let filesIngested = 0;
    let firstMediaFileId: number | undefined;
    const allMediaFileIds: number[] = [];
    const processedMsgIds = new Set<number>();
    let silentRounds = 0;

    for (let i = 0; i < maxWaitSec; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const recent = await client.getMessages(botEntity, { limit: 12 });

      // Check if intermediate quality confirmation prompt appeared
      const qualityPrompt = recent.find((m: any) => !m.out && m.id >= epReply.id && (m.replyMarkup as any)?.rows);
      if (qualityPrompt) {
        const qBtn = (qualityPrompt.replyMarkup as any).rows
          .flatMap((r: any, rIdx: number) => r.buttons.map((b: any, cIdx: number) => ({ ...b, rIdx, cIdx })))
          .find((b: any) => /\b(1080p|720p|480p|fast|stream|download|get)\b/i.test(b.text));
        if (qBtn) {
          try {
            await qualityPrompt.click((qualityPrompt.replyMarkup as any).rows[qBtn.rIdx].buttons[qBtn.cIdx]);
          } catch (_) {}
        }
      }

      // Filter unread media documents
      const newMediaMsgs = recent.filter((m: any) => !m.out && m.id >= epReply.id && !processedMsgIds.has(m.id) && (
        (m.media as any)?.className === "MessageMediaDocument" ||
        (m.media as any)?.className === "MessageMediaVideo" ||
        (m.document as any)?.mimeType?.startsWith("video/") ||
        (m.document as any)?.attributes?.some((a: any) => a.className === "DocumentAttributeVideo")
      ));

      if (newMediaMsgs.length > 0) {
        silentRounds = 0;
        for (const m of newMediaMsgs) {
          processedMsgIds.add(m.id);

          // Forward to dedicated TV Series storage channel
          const fwd = await client.forwardMessages(vaultEntity, {
            messages: [m.id],
            fromPeer: botEntity
          });

          // Accurately extract the real channel message ID
          let realChannelMsgId = "";
          if (Array.isArray(fwd)) {
            for (const item of fwd) {
              if (item?.id) { realChannelMsgId = String(item.id); break; }
            }
          }
          if (!realChannelMsgId && fwd && typeof fwd === "object") {
            if (Array.isArray((fwd as any).updates)) {
              for (const u of (fwd as any).updates) {
                if (u.message?.id) { realChannelMsgId = String(u.message.id); break; }
                if (u.id && (u.className === "UpdateNewChannelMessage" || u.className === "UpdateNewMessage")) {
                  realChannelMsgId = String(u.id); break;
                }
              }
            }
            if (!realChannelMsgId && (fwd as any).id) {
              realChannelMsgId = String((fwd as any).id);
            }
          }

          const fnAttr = ((m.document as any)?.attributes || []).find((a: any) => a.className === "DocumentAttributeFilename") as any;
          const fileName = fnAttr?.fileName || m.message || `${params.seriesTitle}.S${targetSeasonNum}E${params.episodeNum || (filesIngested + 1)}.mp4`;
          const size = Number((m.document as any)?.size || 0);

          const parsedInfo = parseMediaTitleAndSeriesInfo(fileName);
          const cleanSeriesTitle = parsedInfo.cleanTitle || params.seriesTitle;
          const detectedSeason = parsedInfo.season || targetSeasonNum;
          const detectedEpisode = params.episodeNum || parsedInfo.episode || (filesIngested + 1);

          const newId = await addMediaFile({
            movie_id: `tg_series_${cleanSeriesTitle.toLowerCase().replace(/[^a-z0-9]/g, '_')}_s${detectedSeason}_e${detectedEpisode}`,
            movie_title: cleanSeriesTitle,
            year: parsedInfo.year || "",
            telegram_file_id: String(m.id),
            telegram_channel_id: vaultId,
            telegram_message_id: realChannelMsgId || "",
            file_name: fileName,
            file_size: size,
            quality: parsedInfo.quality || "720p",
            language: "English",
            mime_type: (m.document as any)?.mimeType || "video/mp4",
            season: detectedSeason,
            episode: detectedEpisode
          });

          if (!firstMediaFileId) firstMediaFileId = newId;
          allMediaFileIds.push(newId);
          filesIngested++;

          if (params.onProgress) {
            await params.onProgress(filesIngested, cleanSeriesTitle).catch(() => {});
          }
        }

        // If user requested single episode only, we stop after first successful video
        if (!params.allEpisodes && filesIngested > 0) {
          break;
        }
      } else {
        if (filesIngested > 0) {
          silentRounds++;
          // 6 seconds of silence after files arrived means the batch transmission is complete
          if (silentRounds >= 6) {
            break;
          }
        }
      }
    }

    return {
      success: filesIngested > 0,
      message: filesIngested > 0 ? `Ingested ${filesIngested} episode(s) for "${params.seriesTitle}".` : "No video file was delivered.",
      filesIngested,
      firstMediaFileId,
      allMediaFileIds
    };
  });
}

/**
 * Dynamic Quinson TV Series Season Inspector:
 * Queries @quinsonnbot for series seasons and returns the list of available season numbers.
 */
export async function getQuinsonSeriesSeasons(seriesTitle: string): Promise<number[]> {
  return withBotLock("@quinsonnbot", async () => {
    try {
      const client = await getConnectedClient();
      if (!client) return [];
      const botEntity = await client.getEntity("@quinsonnbot");

      const sentMsg = await client.sendMessage(botEntity, { message: seriesTitle.trim() });
      let step1Reply: any = null;
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const msgs = await client.getMessages(botEntity, { limit: 4 });
        const found = msgs.find((m: any) => !m.out && m.id > sentMsg.id);
        if (found) { step1Reply = found; break; }
      }

      if (!step1Reply || !(step1Reply.replyMarkup as any)?.rows) return [];

      const seriesButtons: CandidateButton[] = [];
      (step1Reply.replyMarkup as any).rows.forEach((row: any, rIdx: number) => {
        row.buttons.forEach((btn: any, cIdx: number) => {
          seriesButtons.push({
            text: btn.text,
            row: rIdx,
            col: cIdx,
            data: btn.data ? (Buffer.isBuffer(btn.data) ? btn.data.toString("utf8") : String(btn.data)) : undefined
          });
        });
      });

      const bestSeriesBtn = selectBestMatchingButton(seriesButtons, seriesTitle);
      if (!bestSeriesBtn) return [];

      // Click series button
      if ((step1Reply.replyMarkup as any)?.rows[bestSeriesBtn.row]?.buttons[bestSeriesBtn.col]) {
        await step1Reply.click((step1Reply.replyMarkup as any).rows[bestSeriesBtn.row].buttons[bestSeriesBtn.col]);
      } else {
        throw new Error("The button is no longer on the bot's screen; refusing to click blind.");
      }

      let seasonReply: any = null;
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const msgs = await client.getMessages(botEntity, { limit: 4 });
        const found = msgs.find((m: any) => !m.out && m.id >= step1Reply.id && (m.id > step1Reply.id || m.editDate));
        if (found) { seasonReply = found; break; }
      }

      if (!seasonReply || !(seasonReply.replyMarkup as any)?.rows) return [];

      const seasons: number[] = [];
      (seasonReply.replyMarkup as any).rows.forEach((row: any) => {
        row.buttons.forEach((btn: any) => {
          const match = btn.text.match(/\b(Season\s*|s0?|S0?)(\d+)\b/i);
          if (match && match[2]) {
            const sNum = parseInt(match[2], 10);
            if (!seasons.includes(sNum)) seasons.push(sNum);
          } else if (btn.data && typeof btn.data === "string") {
            const dMatch = btn.data.match(/_(\d+)\|/);
            if (dMatch && dMatch[1]) {
              const sNum = parseInt(dMatch[1], 10);
              if (!seasons.includes(sNum)) seasons.push(sNum);
            }
          }
        });
      });

      return seasons.sort((a, b) => a - b);
    } catch (e: any) {
      console.warn("[QuinsonEngine] getQuinsonSeriesSeasons error:", e?.message);
      return [];
    }
  });
}

export interface QuinsonEpisodeItem {
  episodeNum: number;
  label: string;
}

/**
 * Dynamic Quinson TV Series Episode Inspector:
 * Queries @quinsonnbot for a specific season and returns the list of available episodes.
 */
export async function getQuinsonSeasonEpisodes(seriesTitle: string, seasonNum: number = 1): Promise<QuinsonEpisodeItem[]> {
  return withBotLock("@quinsonnbot", async () => {
    try {
      const client = await getConnectedClient();
      if (!client) return [];
      const botEntity = await client.getEntity("@quinsonnbot");

      const sentMsg = await client.sendMessage(botEntity, { message: seriesTitle.trim() });
      let step1Reply: any = null;
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const msgs = await client.getMessages(botEntity, { limit: 4 });
        const found = msgs.find((m: any) => !m.out && m.id > sentMsg.id);
        if (found) { step1Reply = found; break; }
      }

      if (!step1Reply || !(step1Reply.replyMarkup as any)?.rows) return [];

      const seriesButtons: CandidateButton[] = [];
      (step1Reply.replyMarkup as any).rows.forEach((row: any, rIdx: number) => {
        row.buttons.forEach((btn: any, cIdx: number) => {
          seriesButtons.push({
            text: btn.text,
            row: rIdx,
            col: cIdx,
            data: btn.data ? (Buffer.isBuffer(btn.data) ? btn.data.toString("utf8") : String(btn.data)) : undefined
          });
        });
      });

      const bestSeriesBtn = selectBestMatchingButton(seriesButtons, seriesTitle);
      if (!bestSeriesBtn) return [];

      if ((step1Reply.replyMarkup as any)?.rows[bestSeriesBtn.row]?.buttons[bestSeriesBtn.col]) {
        await step1Reply.click((step1Reply.replyMarkup as any).rows[bestSeriesBtn.row].buttons[bestSeriesBtn.col]);
      } else {
        throw new Error("The button is no longer on the bot's screen; refusing to click blind.");
      }

      let seasonReply: any = null;
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const msgs = await client.getMessages(botEntity, { limit: 4 });
        const found = msgs.find((m: any) => !m.out && m.id >= step1Reply.id && (m.id > step1Reply.id || m.editDate));
        if (found) { seasonReply = found; break; }
      }

      if (!seasonReply || !(seasonReply.replyMarkup as any)?.rows) return [];

      const targetSeasonPattern = new RegExp(`\\b(s0?${seasonNum}|season\\s*0?${seasonNum})\\b`, "i");
      let targetSeasonBtn: CandidateButton | null = null;
      (seasonReply.replyMarkup as any).rows.forEach((row: any, rIdx: number) => {
        row.buttons.forEach((btn: any, cIdx: number) => {
          if (targetSeasonPattern.test(btn.text) || (btn.data && btn.data.includes(`_${seasonNum}|`))) {
            targetSeasonBtn = { text: btn.text, row: rIdx, col: cIdx, data: btn.data?.toString() };
          }
        });
      });

      if (!targetSeasonBtn) {
        targetSeasonBtn = { text: `Season ${seasonNum}`, row: 0, col: 0 };
      }

      if ((seasonReply.replyMarkup as any)?.rows[(targetSeasonBtn as any).row]?.buttons[(targetSeasonBtn as any).col]) {
        await seasonReply.click((seasonReply.replyMarkup as any).rows[(targetSeasonBtn as any).row].buttons[(targetSeasonBtn as any).col]);
      } else {
        throw new Error("The button is no longer on the bot's screen; refusing to click blind.");
      }

      let epReply: any = null;
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const msgs = await client.getMessages(botEntity, { limit: 4 });
        const found = msgs.find((m: any) => !m.out && m.id >= seasonReply.id && (m.id > seasonReply.id || m.editDate));
        if (found) { epReply = found; break; }
      }

      if (!epReply || !(epReply.replyMarkup as any)?.rows) return [];

      const epList: QuinsonEpisodeItem[] = [];
      const seenEps = new Set<number>();

      (epReply.replyMarkup as any).rows.forEach((row: any) => {
        row.buttons.forEach((btn: any) => {
          if (isBackOrNavButton(btn.text)) return;
          const textLower = btn.text.toLowerCase();
          const dataStr = btn.data ? (Buffer.isBuffer(btn.data) ? btn.data.toString("utf8") : String(btn.data)) : "";

          // Exclude batch controls, trailer, more options, and back buttons
          if (
            textLower.includes("send all") ||
            textLower.includes("all episodes") ||
            textLower.includes("download all") ||
            textLower.includes("continue") ||
            textLower.includes("trailer") ||
            textLower.includes("option") ||
            textLower.includes("back") ||
            dataStr.startsWith("sa_") ||
            dataStr.startsWith("srtr_") ||
            dataStr.startsWith("soptions_") ||
            dataStr.startsWith("svlist_")
          ) {
            return;
          }

          // Extract episode number from text (e.g., "E01 🎞", "Episode 2") or callback data ("epsel_539_1_2")
          let epNum: number | null = null;
          const textMatch = btn.text.match(/\b(?:e0?|ep\s*0?|episode\s*0?)(\d+)\b/i);
          if (textMatch && textMatch[1]) {
            epNum = parseInt(textMatch[1], 10);
          } else if (dataStr) {
            const dataMatch = dataStr.match(/epsel_\d+_\d+_(\d+)/) || dataStr.match(/_e0?(\d+)/i);
            if (dataMatch && dataMatch[1]) {
              epNum = parseInt(dataMatch[1], 10);
            }
          }

          if (epNum && !seenEps.has(epNum)) {
            seenEps.add(epNum);
            epList.push({
              episodeNum: epNum,
              label: btn.text.trim()
            });
          }
        });
      });

      return epList.sort((a, b) => a.episodeNum - b.episodeNum);
    } catch (e: any) {
      console.warn("[QuinsonEngine] getQuinsonSeasonEpisodes error:", e?.message);
      return [];
    }
  });
}

/**
 * On-demand automated bot search fulfillment.
 * Triggered when a user requests a movie that is missing from the Vault.
 * Queries highest-priority active bots, downloads/clicks file into Vault,
 * marks request fulfilled, and sends notification to user!
 */
export async function dispatchAutomatedSearch(query: string, userTelegramId?: string, botInstance?: any): Promise<{
  success: boolean;
  jobId: number;
  title: string;
  botUsed?: string;
  mediaFileId?: number;
  message: string;
}> {
  const cleanTitle = query.trim();
  const userId = userTelegramId || "admin_direct";

  // Create search job
  const jobRes = await db.execute({
    sql: "INSERT INTO search_jobs (query, user_telegram_id, status) VALUES (?, ?, 'searching')",
    args: [cleanTitle, userId]
  });
  const jobId = Number(jobRes.lastInsertRowid);

  // Pick top priority active bot
  const topBot = (await db.execute("SELECT * FROM search_bots WHERE status = 'active' ORDER BY priority ASC LIMIT 1")).rows[0] as unknown as SearchBot;
  const botToUse = topBot?.bot_username || "@Apple_moviebot";

  logActivity({
    type: "bot_search",
    source: botToUse,
    title: `Dispatched On-Demand Search: "${cleanTitle}"`,
    details: `User: ${userId} | Target Bot: ${botToUse}`,
    status: "success"
  });

  try {
    const searchRes = await testQuerySearchBot(botToUse, cleanTitle);
    if (!searchRes.found) {
      await db.execute({
        sql: "UPDATE search_jobs SET status = 'failed', error = ? WHERE id = ?",
        args: [searchRes.error || "No results from bot", jobId]
      });
      return { success: false, jobId, title: cleanTitle, message: searchRes.error || "File could not be found across external bots." };
    }

    // Select the best matching download button using semantic scoring
    const bestBtn = selectBestMatchingButton(searchRes.buttons, cleanTitle);
    if (searchRes.messageId && !bestBtn && !searchRes.hasDirectMedia) {
      const msg = "The bot answered, but none of its results confidently matched the title.";
      await db.execute({ sql: "UPDATE search_jobs SET status = 'failed', error = ? WHERE id = ?", args: [msg, jobId] });
      return { success: false, jobId, title: cleanTitle, message: msg };
    }
    if (searchRes.messageId) {
      try {
        const fwdRes = await fetchAndForwardBotMedia({
          botUsername: botToUse,
          messageId: searchRes.messageId,
          buttonRow: bestBtn?.row,
          buttonCol: bestBtn?.col,
          expect: { title: cleanTitle }
        });
        if (!fwdRes.success) {
          await db.execute({ sql: "UPDATE search_jobs SET status = 'failed', error = ? WHERE id = ?", args: [fwdRes.message, jobId] });
          return { success: false, jobId, title: cleanTitle, message: fwdRes.message };
        }

        // Update job to fulfilled
        await db.execute({
          sql: `UPDATE search_jobs SET 
            status = 'fulfilled', 
            bot_used = ?, 
            file_name = ?, 
            fulfilled_at = CURRENT_TIMESTAMP 
          WHERE id = ?`,
          args: [botToUse, fwdRes.fileName || cleanTitle, jobId]
        });

        // Check if there are corresponding user requests in 'requests' table
        const matchingReqs = (await db.execute({
          sql: "SELECT id, telegram_id FROM requests WHERE LOWER(title) = LOWER(?) AND status = 'pending'",
          args: [cleanTitle]
        })).rows;

        if (matchingReqs.length > 0) {
          const reqIds = matchingReqs.map((r: any) => Number(r.id));
          await markRequestsFulfilled(reqIds);

          if (botInstance) {
            for (const r of matchingReqs) {
              try {
                const safeTitle = cleanTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                await botInstance.telegram.sendMessage(
                  (r as any).telegram_id,
                  `🎉 <b>Your request is ready</b>\n\n🎬 <b>${safeTitle}</b> has been added. Tap /webapp to watch now.`,
                  { parse_mode: "HTML" }
                );
              } catch (e) {
                console.warn("Could not send fulfillment message to user:", e);
              }
            }
          }
        }

        return {
          success: true,
          jobId,
          title: cleanTitle,
          botUsed: botToUse,
          mediaFileId: fwdRes.mediaFileId,
          message: fwdRes.message
        };
      } catch (fwdErr: any) {
        console.warn("Automated forward error:", fwdErr.message);
      }
    }

    return {
      success: true,
      jobId,
      title: cleanTitle,
      botUsed: botToUse,
      message: `Found results for "${cleanTitle}". Select an exact quality release from the Search Bot Playground to forward.`
    };
  } catch (err: any) {
    await db.execute({
      sql: "UPDATE search_jobs SET status = 'failed', error = ? WHERE id = ?",
      args: [err.message, jobId]
    });
    return { success: false, jobId, title: cleanTitle, message: err.message };
  }
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
import { type DownloadExpectation, normalizeTitleFuzzy, verifyDownloadedFile } from "../crawler/verify.js";


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

    // Get active search bots ordered strictly by priority (P1: @Apple_moviebot, P2: @iPapkornEzPzBot, P3: @iPapkornDeltaBot)
    // Ignore TV-only bots like @quinsonnbot for movie searches
    const activeBots = (await db.execute("SELECT * FROM search_bots WHERE status = 'active' AND LOWER(bot_username) NOT LIKE '%quinson%' ORDER BY priority ASC")).rows as unknown as SearchBot[];
    const botList = activeBots.length > 0 ? activeBots : DEFAULT_SEARCH_BOTS.map((b, i) => ({ ...b, id: i + 1, status: "active" as const, success_count: 0, last_queried_at: null, created_at: "" }));

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
        await db.execute({
          sql: "UPDATE crawler_batch_queue SET status = 'duplicate_skipped', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          args: [dupCheck.reason || "Duplicate found in Vault", item.id]
        });
        skipped++;
        logs.push(`⏭️ Skipped "${searchQuery}": ${dupCheck.reason}`);
        continue;
      }

      let itemFulfilled = false;
      let lastErr = "";

      // Try bots strictly sequentially in failover priority order: P1 (@Apple_moviebot) -> P2 (@iPapkornEzPzBot) -> P3 (@iPapkornDeltaBot)
      for (const bot of botList) {
        if (!cronConfig.isEnabled && !isManualTrigger) {
          logs.push("Cron job stopped by user mid-query.");
          break;
        }

        if (bot.bot_username.toLowerCase().includes("quinson")) {
          console.log(`[CronCrawler] Skipping ${bot.bot_username} (TV Series bot only).`);
          continue;
        }

        try {
          logs.push(`🔍 Querying Priority ${bot.priority} Main Bot (${bot.bot_username}) for "${searchQuery}"...`);
          const searchRes = await testQuerySearchBot(bot.bot_username, searchQuery);

          if (searchRes.found && searchRes.messageId) {
            // Intelligently select best matching candidate button based on Sequel, Year, and Quality
            const bestBtn = selectBestMatchingButton(
              searchRes.buttons,
              item.clean_title || searchQuery,
              item.year || undefined,
              item.requested_quality || "1080p"
            );
            if (!bestBtn && !searchRes.hasDirectMedia) {
              logs.push(`⚠️ ${bot.bot_username}: no result confidently matched "${item.clean_title}" — trying the next bot.`);
              continue;
            }
            const fwdRes = await fetchAndForwardBotMedia({
              botUsername: bot.bot_username,
              messageId: searchRes.messageId,
              buttonRow: bestBtn?.row,
              buttonCol: bestBtn?.col,
              expect: { title: item.clean_title, year: item.year || undefined }
            });
            if (!fwdRes.success) {
              logs.push(`⚠️ ${bot.bot_username}: ${fwdRes.message}`);
              continue;
            }

            if (fwdRes.success) {
              itemFulfilled = true;
              fulfilled++;

              // Auto-discover Release Year from bot button or forwarded media file name
              let discoveredYear = item.year;
              if (!discoveredYear) {
                const fnMatch = fwdRes.fileName?.match(/\b(19\d{2}|20\d{2})\b/);
                const btnMatch = bestBtn?.text?.match(/\b(19\d{2}|20\d{2})\b/);
                discoveredYear = fnMatch?.[1] || btnMatch?.[1];
                if (!discoveredYear) {
                  discoveredYear = await lookupMovieYear(searchQuery);
                }
              }

              await db.execute({
                sql: `UPDATE crawler_batch_queue SET 
                      status = 'completed', 
                      bot_used = ?, 
                      year = COALESCE(year, ?),
                      media_file_id = ?, 
                      last_error = NULL, 
                      updated_at = CURRENT_TIMESTAMP 
                      WHERE id = ?`,
                args: [bot.bot_username, discoveredYear || null, fwdRes.mediaFileId || null, item.id]
              });

              // Ensure Vault media_files record is updated with discovered year
              if (discoveredYear && fwdRes.mediaFileId) {
                await db.execute({
                  sql: "UPDATE media_files SET year = ? WHERE id = ? AND (year IS NULL OR year = '')",
                  args: [discoveredYear, fwdRes.mediaFileId]
                });
              }

              logs.push(`✅ Successfully uploaded "${searchQuery}" ${discoveredYear ? `(${discoveredYear}) ` : ""}to Vault via ${bot.bot_username}!`);
              break; // SUCCESS! Stop querying other fallback bots immediately!
            }
          } else {
            lastErr = searchRes.error || "No results returned";
          }
        } catch (botErr: any) {
          lastErr = botErr.message || "Bot query failed";
          logs.push(`⚠️ Fallover from ${bot.bot_username} on "${searchQuery}": ${lastErr}`);

          // Check if FloodWait error
          if (botErr.message?.includes("FLOOD_WAIT") || botErr.seconds) {
            const waitSec = Number(botErr.seconds) || 30;
            floodWaitCooldownUntil = Date.now() + (waitSec * 1000);
            logs.push(`⏳ Telegram FloodWait activated: pausing for ${waitSec}s.`);
            break;
          }
        }

        // Pacing delay before attempting fallback bot
        await new Promise(r => setTimeout(r, 2000));
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


