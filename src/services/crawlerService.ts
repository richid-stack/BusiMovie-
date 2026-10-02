import { addMediaFile, logChannelEvent, markRequestsFulfilled, db, getSetting, setSetting, deleteSetting } from "../db/index.js";
import { searchMovies } from "./movieProvider.js";
import { getOfficialTrailer } from "./trailerService.js";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

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
  { username: "@Apple_moviebot", type: "command" as const, command: "/search {query}", priority: 1 },
  { username: "@cinemagic_hd_bot", type: "command" as const, command: "/search {query}", priority: 1 },
  { username: "@TGMovieSearchBot", type: "inline" as const, command: "/search {query}", priority: 2 },
  { username: "@FilesSearchMasterBot", type: "command" as const, command: "/find {query}", priority: 3 }
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

    // Load search bots
    const botRows = (await db.execute("SELECT * FROM search_bots ORDER BY priority ASC")).rows;
    if (botRows.length === 0) {
      for (const b of DEFAULT_SEARCH_BOTS) {
        await db.execute({
          sql: "INSERT INTO search_bots (bot_username, bot_type, command_template, status, priority) VALUES (?, ?, ?, 'active', ?)",
          args: [b.username, b.type, b.command, b.priority]
        });
      }
      const reloadedBots = (await db.execute("SELECT * FROM search_bots ORDER BY priority ASC")).rows;
      searchBots = reloadedBots as unknown as SearchBot[];
    } else {
      searchBots = botRows as unknown as SearchBot[];
    }

    // Load recent search jobs
    const jobRows = (await db.execute("SELECT * FROM search_jobs ORDER BY created_at DESC LIMIT 50")).rows;
    searchJobs = jobRows as unknown as SearchJob[];

    logActivity({
      type: "channel_crawl",
      source: "Engine Boot",
      title: "Crawler & Search Service Ready",
      details: `Initialized with ${targets.length} target channels and ${searchBots.length} external search bots.`,
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

// Active client instance if logged in
let activeClient: TelegramClient | null = null;
let activeUserInfo: { id?: string; username?: string; firstName?: string; phone?: string } | null = null;

// Temporary state for the 2-step verification
let pendingClient: TelegramClient | null = null;
let pendingPhone: string = "";
let pendingPhoneCodeHash: string = "";

export async function getEffectiveVaultChannelId(): Promise<string> {
  const custom = await getSetting("telegram_vault_channel_id");
  if (custom && custom.trim()) return custom.trim();
  if (process.env.TELEGRAM_VAULT_CHANNEL_ID && process.env.TELEGRAM_VAULT_CHANNEL_ID.trim()) {
    return process.env.TELEGRAM_VAULT_CHANNEL_ID.trim();
  }
  // Auto-detect from existing media files in library
  try {
    const res = await db.execute("SELECT telegram_channel_id FROM media_files WHERE telegram_channel_id LIKE '-100%' ORDER BY id DESC LIMIT 1");
    if (res.rows && res.rows.length > 0 && res.rows[0].telegram_channel_id) {
      const detected = String(res.rows[0].telegram_channel_id);
      await setSetting("telegram_vault_channel_id", detected);
      return detected;
    }
  } catch (_) {}
  return "";
}

export async function setEffectiveVaultChannelId(channelId: string): Promise<void> {
  await setSetting("telegram_vault_channel_id", channelId.trim());
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
  const vaultChannelId = await getEffectiveVaultChannelId();

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
    vaultChannelId
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

        let cleanBase = filename.replace(/\.[a-zA-Z0-9]{2,4}$/, "").replace(/^\[[A-Za-z0-9 _-]+\]\s*/, "").replace(/^@[\w_]+[_\s-]+/i, "").replace(/@[\w_]+/g, "");
        cleanBase = cleanBase.replace(/^(fc|psa|hevc|webrip|bluray|x265|x264)[_.-]+/i, "");
        const yMatch = cleanBase.match(/\b(19\d{2}|20\d{2})\b/);
        const year = yMatch ? yMatch[1] : "";
        const qm = cleanBase.match(/\b(2160p|4K|1080p|720p|480p|HD)\b/i);
        const quality = qm ? qm[1].toUpperCase() : "1080p";
        let cIdx = cleanBase.length;
        if (yMatch && yMatch.index) cIdx = Math.min(cIdx, yMatch.index);
        if (qm && qm.index) cIdx = Math.min(cIdx, qm.index);
        let parsedTitle = cleanBase.substring(0, cIdx).replace(/[._\-–—[\]()]+/g, " ").replace(/\b(WEBRip|BluRay|BRRip|x264|x265|HEVC|AAC)\b/gi, "").trim();
        if (!parsedTitle || parsedTitle.length < 2) parsedTitle = filename.replace(/\.[a-zA-Z0-9]+$/, "").trim();

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
              mime_type: (m.document as any)?.mimeType || "video/mp4"
            });
          }
        } catch (_) {}

        logActivity({
          type: "vault_forward",
          source: target.channel_identifier,
          title: `Forwarded to Vault: ${parsedTitle}`,
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

  // Increment bot success count
  await db.execute({
    sql: "UPDATE search_bots SET success_count = success_count + 1, last_queried_at = CURRENT_TIMESTAMP WHERE bot_username = ?",
    args: [cleanUsername]
  });

  logActivity({
    type: "bot_search",
    source: cleanUsername,
    title: `Queried Bot: "${cleanQuery}"`,
    details: `Response in ${duration}ms. ${buttons.length} buttons, media: ${hasDirectMedia ? "Yes" : "Buttons"}`,
    status: "success"
  });

  // Extract first download match if available
  const firstDownloadBtn = buttons.find(b => b.isDownload) || buttons[0];
  const fnMatch = firstDownloadBtn?.text || replyMsg.message || cleanQuery;

  return {
    bot: cleanUsername,
    query: cleanQuery,
    found: true,
    replyText: replyMsg.message,
    messageId: replyMsg.id,
    hasDirectMedia,
    buttons,
    match: {
      title: cleanQuery,
      year: "2024",
      quality: fnMatch.match(/\b(2160p|4K|1080p|720p|480p)\b/i)?.[1]?.toUpperCase() || "HD",
      file_size_bytes: 1500000000,
      file_name: fnMatch
    },
    duration_ms: duration
  };
}

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
}): Promise<{
  success: boolean;
  message: string;
  fileName?: string;
  fileSizeBytes?: number;
}> {
  const client = await getConnectedClient();
  if (!client) {
    throw new Error("Auxiliary Telegram account is not connected.");
  }

  const vaultId = await getEffectiveVaultChannelId();
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
          await msg.click(params.buttonRow);
        }
      } else {
        await msg.click(params.buttonRow);
      }
    } catch (clickErr: any) {
      console.warn("Button click error:", clickErr.message);
    }

    // Wait up to 10 seconds for the file message
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const recent = await client.getMessages(botEntity, { limit: 5 });
      const found = recent.find((m: any) => !m.out && m.id > params.messageId && (
        m.media?.className === "MessageMediaDocument" ||
        m.document?.mimeType?.startsWith("video/") ||
        m.document?.attributes?.some((a: any) => a.className === "DocumentAttributeVideo")
      ));
      if (found) {
        mediaMsgToForward = found;
        break;
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

  // Forward the real file directly into the vault channel!
  const forwardedResult = await client.forwardMessages(vaultEntity, {
    messages: [mediaMsgToForward.id],
    fromPeer: botEntity
  });

  const fnAttr = ((mediaMsgToForward.document as any)?.attributes || []).find((a: any) => a.className === "DocumentAttributeFilename") as any;
  const fileName = fnAttr?.fileName || mediaMsgToForward.message || "Video.mp4";
  const size = Number((mediaMsgToForward.document as any)?.size || 0);

  // Direct index into Vault library with pristine parsed title immediately
  const newFwdMsg = Array.isArray(forwardedResult) ? forwardedResult[0] : forwardedResult;
  const newMsgId = newFwdMsg?.id ? String(newFwdMsg.id) : "";

  let cleanBase = fileName.replace(/\.[a-zA-Z0-9]{2,4}$/, "").replace(/^\[[A-Za-z0-9 _-]+\]\s*/, "").replace(/^@[\w_]+[_\s-]+/i, "").replace(/@[\w_]+/g, "");
  cleanBase = cleanBase.replace(/^(fc|psa|hevc|webrip|bluray|x265|x264)[_.-]+/i, "");
  const yearMatch = cleanBase.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : "";
  const qMatch = cleanBase.match(/\b(2160p|4K|1080p|720p|480p|HD)\b/i);
  const quality = qMatch ? qMatch[1].toUpperCase() : "1080p";
  let cutIdx = cleanBase.length;
  if (yearMatch && yearMatch.index) cutIdx = Math.min(cutIdx, yearMatch.index);
  if (qMatch && qMatch.index) cutIdx = Math.min(cutIdx, qMatch.index);
  let parsedMovieTitle = cleanBase.substring(0, cutIdx).replace(/[._\-–—[\]()]+/g, " ").replace(/\b(WEBRip|BluRay|BRRip|x264|x265|HEVC|AAC)\b/gi, "").trim();
  if (!parsedMovieTitle || parsedMovieTitle.length < 2) parsedMovieTitle = fileName.replace(/\.[a-zA-Z0-9]+$/, "").trim();

  try {
    const existing = newMsgId ? (await db.execute({
      sql: "SELECT id FROM media_files WHERE telegram_channel_id = ? AND telegram_message_id = ? LIMIT 1",
      args: [vaultId, newMsgId]
    })).rows : [];

    let newFileId: number | undefined;
    if (existing.length === 0) {
      newFileId = await addMediaFile({
        movie_id: `tg_${Date.now()}`,
        movie_title: parsedMovieTitle,
        year,
        telegram_file_id: String(mediaMsgToForward.id),
        telegram_channel_id: vaultId,
        telegram_message_id: newMsgId,
        file_name: fileName,
        file_size: size,
        quality,
        language: "English",
        mime_type: (mediaMsgToForward.document as any)?.mimeType || "video/mp4"
      });
      console.log(`[CrawlerService] Direct indexed forwarded media "${parsedMovieTitle}" as ID ${newFileId}`);
    } else {
      newFileId = Number(existing[0].id);
    }
  } catch (idxErr: any) {
    console.warn("Direct index in fetchAndForwardBotMedia error:", idxErr.message);
  }

  logActivity({
    type: "vault_forward",
    source: cleanUsername,
    title: `Forwarded from ${cleanUsername}: ${parsedMovieTitle}`,
    details: `Forwarded "${fileName}" to ${(vaultEntity as any)?.title || "Vault channel"} and indexed as "${parsedMovieTitle}".`,
    status: "success"
  });

  return {
    success: true,
    message: `Forwarded "${parsedMovieTitle}" (${quality}) to your Telegram Vault channel and indexed for users!`,
    fileName,
    fileSizeBytes: size,
    mediaFileId: newFileId
  };
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

    // If search bot returned download buttons, trigger fetch and forward on first download button
    const firstBtn = searchRes.buttons?.find(b => b.isDownload) || searchRes.buttons?.[0];
    if (searchRes.messageId) {
      try {
        const fwdRes = await fetchAndForwardBotMedia({
          botUsername: botToUse,
          messageId: searchRes.messageId,
          buttonRow: firstBtn?.row,
          buttonCol: firstBtn?.col
        });

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
                  `🤖 <b>Autonomous Bot Fulfillment Complete!</b>\n\n🎬 <b>${safeTitle}</b> was successfully fetched by our crawler userbot and added to the Vault!\n\nTap /webapp to stream or download now!`,
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
