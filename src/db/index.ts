import { createClient } from "@libsql/client";
import { parseMediaTitleAndSeriesInfo, groupMediaIntoCatalog } from "../services/seriesParser.js";

// Initialize the SQLite database
// Persistent hosted database (recommended on Cloud Run / AI Studio, where the local disk is wiped on restart):
// set TURSO_DATABASE_URL (e.g. libsql://your-db.turso.io) and TURSO_AUTH_TOKEN in your Secrets.
// Without them it falls back to the local SQLite file.
const db = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: "file:movie-bot.db" }
);

// Secrets must never be mirrored to disk JSON or Firestore (both were world-readable).
const SECRET_SETTING_KEYS = new Set(["telegram_user_session"]);

/** Which database is in use, for the admin dashboard. */
export function getDatabaseInfo(): { kind: "turso" | "file"; persistent: boolean; host?: string } {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    let host: string | undefined;
    try { host = new URL(url.replace(/^libsql:/, "https:")).host; } catch { /* ignore */ }
    return { kind: "turso", persistent: true, host };
  }
  return { kind: "file", persistent: !(process.env.K_SERVICE || process.env.NODE_ENV === "production") };
}

// Setup initial schema
export async function setupDatabase() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL,
      query TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL,
      tmdb_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS media_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id TEXT NOT NULL,
      movie_title TEXT NOT NULL,
      year TEXT,
      telegram_file_id TEXT NOT NULL,
      telegram_channel_id TEXT,
      telegram_message_id TEXT,
      file_name TEXT,
      file_size INTEGER DEFAULT 0,
      quality TEXT DEFAULT '1080p',
      language TEXT DEFAULT 'English',
      mime_type TEXT,
      season INTEGER,
      episode INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS channel_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT,
      channel_title TEXT,
      message_id TEXT,
      media_type TEXT,
      parsed_title TEXT NOT NULL,
      quality TEXT,
      file_size INTEGER DEFAULT 0,
      status TEXT DEFAULT 'indexed',
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS collection_items (
      collection_id INTEGER,
      media_file_id INTEGER,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (collection_id, media_file_id),
      FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY(media_file_id) REFERENCES media_files(id) ON DELETE CASCADE
    )
  `);

  // Migrations for newly added columns
  try {
    await db.execute(`ALTER TABLE media_files ADD COLUMN season INTEGER`);
  } catch (e: any) {
    // Ignore if column exists
  }
  try {
    await db.execute(`ALTER TABLE media_files ADD COLUMN episode INTEGER`);
  } catch (e: any) {
    // Ignore if column exists
  }
  try {
    await db.execute(`ALTER TABLE media_files ADD COLUMN poster_url TEXT`);
  } catch (e: any) {
    // Ignore if column exists
  }
  try {
    await db.execute(`ALTER TABLE media_files ADD COLUMN trailer_url TEXT`);
  } catch (e: any) {
    // Ignore if column exists
  }

  // App settings key-value store for session strings, custom configs, and vault IDs
  await db.execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Universal persistent 2-minute ephemeral message store
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ephemeral_messages (
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      delete_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, message_id)
    )
  `);

  // Persistent callback key store for durable 64-byte Telegram inline keyboard callbacks
  await db.execute(`
    CREATE TABLE IF NOT EXISTS callback_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at INTEGER
    )
  `);
  // Older databases: add the expiry column, then drop anything that has aged out.
  try { await db.execute("ALTER TABLE callback_cache ADD COLUMN expires_at INTEGER"); } catch { /* column already exists */ }
  await purgeExpiredCallbacks();

  // Ensure default Movies & TV Series vault channel IDs are permanently linked
  const currentVault = await getSetting("telegram_vault_channel_id");
  if (!currentVault) {
    await setSetting("telegram_vault_channel_id", "-1004314551318");
  }

  const currentSeriesVault = await getSetting("telegram_series_vault_channel_id");
  if (!currentSeriesVault) {
    await setSetting("telegram_series_vault_channel_id", "-1003983385552");
  }

  // The database is the single source of truth (Turso in production). No mirrors, nothing to restore.
  if (!process.env.TURSO_DATABASE_URL && (process.env.K_SERVICE || process.env.NODE_ENV === "production")) {
    console.warn("[DB] WARNING: running on a local file database in a hosted environment. The disk is wiped on every restart. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  }

  await seedDefaultBotsAndTargets();
  await cleanUpCorruptedVaultRecords();
}

export function extractCleanTitleDetails(fileName: string, currentTitle?: string) {
  const parsed = parseMediaTitleAndSeriesInfo(fileName, currentTitle);
  return {
    title: parsed.cleanTitle,
    year: parsed.year || "",
    quality: parsed.quality || "1080p",
    season: parsed.isSeries ? parsed.season : undefined,
    episode: parsed.isSeries ? parsed.episode : undefined
  };
}

export async function cleanUpCorruptedVaultRecords(): Promise<void> {
  try {
    // 1. Delete purely fake records created by old test mock runs
    const fakeRows = (await db.execute({
      sql: "SELECT id, telegram_file_id FROM media_files WHERE telegram_file_id LIKE '%USERBOT%' OR telegram_file_id LIKE '%BOT_QUERY%' OR telegram_channel_id = 'AutoVault'"
    })).rows;

    const delRes = await db.execute({
      sql: "DELETE FROM media_files WHERE telegram_file_id LIKE '%USERBOT%' OR telegram_file_id LIKE '%BOT_QUERY%' OR telegram_channel_id = 'AutoVault'"
    });
    if (delRes.rowsAffected > 0) {
      console.log(`[Vault Cleanup] Removed ${delRes.rowsAffected} fake media file records.`);
    }

    // 2. Fetch all rows and sanitize series titles, seasons, and episodes
    const allRows = (await db.execute("SELECT * FROM media_files")).rows as unknown as MediaFileRecord[];
    let cleanedCount = 0;
    for (const r of allRows) {
      const t = String(r.movie_title || "");
      const fn = String(r.file_name || t || "");

      const parsed = parseMediaTitleAndSeriesInfo(fn, t);

      const titleChanged = parsed.cleanTitle && parsed.cleanTitle !== t;
      const seasonChanged = parsed.isSeries && (r.season !== parsed.season || r.episode !== parsed.episode);
      const isBadTitle = t.endsWith("(") || t.endsWith(" -") || t.includes("@") || t.toLowerCase().includes(".mkv") || t.toLowerCase().includes(".mp4");

      if (titleChanged || seasonChanged || isBadTitle) {
        const finalTitle = parsed.cleanTitle || t.replace(/\s*\(\s*$/, "").trim();
        const finalSeason = parsed.isSeries ? (parsed.season ?? 1) : null;
        const finalEpisode = parsed.isSeries ? (parsed.episode ?? null) : null;
        const finalQuality = parsed.quality || r.quality || "1080p";
        const finalYear = parsed.year || r.year || "";

        await db.execute({
          sql: `UPDATE media_files 
                SET movie_title = ?, 
                    year = COALESCE(NULLIF(?, ''), year), 
                    quality = COALESCE(NULLIF(?, ''), quality), 
                    season = ?, 
                    episode = ? 
                WHERE id = ?`,
          args: [
            finalTitle, 
            finalYear, 
            finalQuality, 
            finalSeason, 
            finalEpisode, 
            r.id
          ]
        });

        r.movie_title = finalTitle;
        if (finalYear) r.year = finalYear;
        if (finalQuality) r.quality = finalQuality;
        r.season = finalSeason;
        r.episode = finalEpisode;
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[Vault Cleanup] Sanitized and structured ${cleanedCount} media files (TV Series & Movies).`);
    }

  } catch (err) {
    console.error("Error in cleanUpCorruptedVaultRecords:", err);
  }
}

/** Creates the bot/target tables and seeds defaults on a brand-new database. Never overwrites existing rows. */
export async function seedDefaultBotsAndTargets(): Promise<void> {
  try {
    // Ensure table search_bots exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS search_bots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_username TEXT UNIQUE NOT NULL,
        bot_type TEXT DEFAULT 'command',
        command_template TEXT DEFAULT '/search {query}',
        status TEXT DEFAULT 'active',
        priority INTEGER DEFAULT 1,
        success_count INTEGER DEFAULT 0,
        last_queried_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure table crawler_targets exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS crawler_targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_identifier TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        min_file_size_mb INTEGER DEFAULT 300,
        quality_filter TEXT DEFAULT 'all',
        last_crawled_at DATETIME,
        total_files_found INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed default search bots on a brand-new database only
    const botRows = (await db.execute("SELECT * FROM search_bots")).rows;
    if (botRows.length === 0) {
      const defaults = [
        { bot_username: "@Apple_moviebot", bot_type: "command", command_template: "/search {query}", priority: 1 },
        { bot_username: "@iPapkornDeltaBot", bot_type: "command", command_template: "{query}", priority: 2 },
        { bot_username: "@iPapkornEzPzBot", bot_type: "command", command_template: "{query}", priority: 3 },
        { bot_username: "@cinemagic_hd_bot", bot_type: "command", command_template: "/search {query}", priority: 4 }
      ];
      for (const d of defaults) {
        await db.execute({
          sql: `INSERT OR REPLACE INTO search_bots (bot_username, bot_type, command_template, status, priority) VALUES (?, ?, ?, 'active', ?)`,
          args: [d.bot_username, d.bot_type, d.command_template, d.priority]
        });
      }
    }

    // Seed real target channels if empty
    const targetRows = (await db.execute("SELECT * FROM crawler_targets")).rows;
    if (targetRows.length === 0) {
      const defaultTargets = [
        { channel_identifier: "@Apple_Movies101", title: "Apple movies 🍿™", min_file_size_mb: 300, quality_filter: "all" },
        { channel_identifier: "@applemovies101", title: "Apple Movies🍿™", min_file_size_mb: 300, quality_filter: "all" },
        { channel_identifier: "@F5_FILMS", title: "F5 FILMS", min_file_size_mb: 300, quality_filter: "all" },
        { channel_identifier: "@Series_index_y", title: "TV/WEB SERIES INDEX", min_file_size_mb: 200, quality_filter: "all" }
      ];
      for (const dt of defaultTargets) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO crawler_targets (channel_identifier, title, status, min_file_size_mb, quality_filter) VALUES (?, ?, 'active', ?, ?)`,
          args: [dt.channel_identifier, dt.title, dt.min_file_size_mb, dt.quality_filter]
        });
      }
    }
  } catch (err) {
    console.warn("Could not seed default bots and targets:", err);
  }
}

export async function getSetting(key: string): Promise<string | null> {
  try {
    const res = await db.execute({ sql: "SELECT value FROM app_settings WHERE key = ? LIMIT 1", args: [key] });
    if (res.rows && res.rows.length > 0 && res.rows[0].value) return String(res.rows[0].value);
  } catch (err) {
    console.warn("Could not retrieve setting " + key + ":", err);
  }
  return null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  try {
    await db.execute({
      sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
      args: [key, value]
    });
  } catch (err) {
    console.error("Could not save setting " + key + ":", err);
  }
}

export async function deleteSetting(key: string): Promise<void> {
  try {
    await db.execute({ sql: "DELETE FROM app_settings WHERE key = ?", args: [key] });
  } catch (err) {
    console.error("Could not delete setting " + key + ":", err);
  }
}

export interface CollectionRecord {
  id: number;
  name: string;
  description?: string;
  created_at: string;
}

export interface MediaFileRecord {
  id: number;
  movie_id: string;
  movie_title: string;
  year?: string;
  telegram_file_id: string;
  telegram_channel_id?: string;
  telegram_message_id?: string;
  file_name?: string;
  file_size?: number;
  quality?: string;
  language?: string;
  mime_type?: string;
  season?: number;
  episode?: number;
  poster_url?: string;
  trailer_url?: string;
  created_at?: string;
}

export interface ChannelLogRecord {
  id: number;
  channel_id: string;
  channel_title: string;
  message_id: string;
  media_type: string;
  parsed_title: string;
  quality?: string;
  file_size?: number;
  status: string;
  details?: string;
  created_at: string;
}

export async function getMediaFilesForMovie(movieId: string, movieTitle?: string): Promise<MediaFileRecord[]> {
  try {
    const fakeFilter = "AND telegram_file_id NOT LIKE '%USERBOT%' AND telegram_file_id NOT LIKE '%BOT_QUERY%' AND (telegram_channel_id != 'AutoVault' OR telegram_channel_id IS NULL)";

    // 1. Check by exact movie_id first
    let res = await db.execute({
      sql: `SELECT * FROM media_files WHERE movie_id = ? ${fakeFilter} ORDER BY id DESC`,
      args: [movieId]
    });
    if (res.rows.length > 0) {
      return res.rows as unknown as MediaFileRecord[];
    }

    // 2. Check by exact normalized title
    if (movieTitle && movieTitle.trim()) {
      const cleanTitle = movieTitle.trim().toLowerCase();
      const qNorm = cleanTitle.replace(/[\s._\-:,'&/()]+/g, '');

      res = await db.execute({
        sql: `SELECT * FROM media_files 
              WHERE (
                LOWER(movie_title) = ?
                OR REPLACE(REPLACE(REPLACE(REPLACE(LOWER(movie_title), ' ', ''), '.', ''), '-', ''), ':', '') = ?
              ) ${fakeFilter} ORDER BY id DESC`,
        args: [cleanTitle, qNorm]
      });
      if (res.rows.length > 0) {
        return res.rows as unknown as MediaFileRecord[];
      }
    }
    return [];
  } catch (err) {
    console.error("Error fetching media files:", err);
    return [];
  }
}

/**
 * Searches the Vault database directly by keyword or title.
 * Normalizes punctuation and spaces so queries like "SWAT", "S.W.A.T.", "Passenger 2026"
 * match accurately without requiring third-party metadata providers.
 */
export async function searchVaultFilesDirect(query: string): Promise<MediaFileRecord[]> {
  if (!query || !query.trim()) return [];
  const clean = query.trim();
  const qNorm = clean.toLowerCase().replace(/[^a-z0-9]/g, '');
  const all = await getAllMediaFiles();

  return all.filter(f => {
    if (f.telegram_channel_id === 'AutoVault' || f.telegram_file_id?.includes('USERBOT') || f.telegram_file_id?.includes('BOT_QUERY')) {
      return false;
    }
    const title = (f.movie_title || "").toLowerCase();
    const fileName = (f.file_name || "").toLowerCase();
    const tNorm = title.replace(/[^a-z0-9]/g, '');
    const fnNorm = fileName.replace(/[^a-z0-9]/g, '');

    return title.includes(clean.toLowerCase()) || 
           fileName.includes(clean.toLowerCase()) || 
           (qNorm.length >= 2 && (tNorm.includes(qNorm) || fnNorm.includes(qNorm)));
  });
}

export async function getAllMediaFiles(): Promise<MediaFileRecord[]> {
  try {
    const res = await db.execute("SELECT * FROM media_files ORDER BY created_at DESC");
    return res.rows as unknown as MediaFileRecord[];
  } catch (err) {
    console.error("Error getting all media files:", err);
    return [];
  }
}

export async function getMediaFileById(id: number): Promise<MediaFileRecord | null> {
  try {
    const res = await db.execute({
      sql: "SELECT * FROM media_files WHERE id = ? LIMIT 1",
      args: [id]
    });
    return (res.rows[0] as unknown as MediaFileRecord) || null;
  } catch (err) {
    console.error("Error getting media file by ID:", err);
    return null;
  }
}


export async function getSeriesSeasons(seriesTitle: string): Promise<number[]> {
  try {
    const cleanTitle = seriesTitle.trim();
    const res = await db.execute({
      sql: `SELECT DISTINCT season FROM media_files 
            WHERE (
              LOWER(movie_title) = LOWER(?) 
              OR REPLACE(REPLACE(REPLACE(LOWER(movie_title), '.', ''), ' ', ''), '_', '') = REPLACE(REPLACE(REPLACE(LOWER(?), '.', ''), ' ', ''), '_', '')
            ) AND season IS NOT NULL ORDER BY season ASC`,
      args: [cleanTitle, cleanTitle]
    });
    return res.rows.map((r: any) => Number(r.season)).filter((s: number) => !isNaN(s) && s > 0);
  } catch (err) {
    console.error("Error getting series seasons:", err);
    return [];
  }
}

export async function getSeriesSeasonEpisodes(seriesTitle: string, season: number): Promise<MediaFileRecord[]> {
  try {
    const cleanTitle = seriesTitle.trim();
    const res = await db.execute({
      sql: `SELECT * FROM media_files 
            WHERE (
              LOWER(movie_title) = LOWER(?) 
              OR REPLACE(REPLACE(REPLACE(LOWER(movie_title), '.', ''), ' ', ''), '_', '') = REPLACE(REPLACE(REPLACE(LOWER(?), '.', ''), ' ', ''), '_', '')
            ) AND season = ? 
            ORDER BY episode ASC, id ASC`,
      args: [cleanTitle, cleanTitle, season]
    });
    return res.rows as unknown as MediaFileRecord[];
  } catch (err) {
    console.error("Error getting series season episodes:", err);
    return [];
  }
}

export interface VaultMovieSummary {
  title: string;
  year?: string;
  poster_url?: string;
  trailer_url?: string;
  files: Array<{
    id: number;
    quality: string;
    file_size: number;
    file_name?: string;
  }>;
}

export async function getVaultMovieCatalog(query?: string): Promise<VaultMovieSummary[]> {
  try {
    const all = await getAllMediaFiles();
    const movieFiles = all.filter(f => {
      if (f.telegram_channel_id === 'AutoVault' || f.telegram_file_id?.includes('USERBOT') || f.telegram_file_id?.includes('BOT_QUERY')) return false;
      return f.season === null || f.season === undefined;
    });

    const map = new Map<string, VaultMovieSummary>();
    for (const f of movieFiles) {
      const titleKey = (f.movie_title || "Untitled Movie").trim();
      const yrKey = f.year ? f.year.trim() : "";
      const groupKey = `${titleKey.toLowerCase()}__${yrKey}`;

      if (!map.has(groupKey)) {
        map.set(groupKey, {
          title: titleKey,
          year: f.year,
          poster_url: f.poster_url,
          trailer_url: f.trailer_url,
          files: []
        });
      }
      const item = map.get(groupKey)!;
      if (!item.poster_url && f.poster_url) item.poster_url = f.poster_url;
      if (!item.trailer_url && f.trailer_url) item.trailer_url = f.trailer_url;
      item.files.push({
        id: f.id,
        quality: f.quality || "HD",
        file_size: Number(f.file_size || 0),
        file_name: f.file_name
      });
    }

    let summaries = Array.from(map.values());

    if (query && query.trim()) {
      const clean = query.trim().toLowerCase();
      const qNorm = clean.replace(/[^a-z0-9]/g, '');
      summaries = summaries.filter(s => {
        const t = s.title.toLowerCase();
        const tNorm = t.replace(/[^a-z0-9]/g, '');
        return t.includes(clean) || (qNorm.length >= 2 && tNorm.includes(qNorm));
      });
    }

    return summaries.sort((a, b) => a.title.localeCompare(b.title));
  } catch (err) {
    console.error("Error getting vault movie catalog:", err);
    return [];
  }
}

export interface VaultGroupedItem {
  id: number;
  movie_id: string;
  movie_title: string;
  year?: string;
  poster_url?: string;
  trailer_url?: string;
  quality?: string;
  file_size?: number;
  telegram_file_id?: string;
  is_series: boolean;
  total_episodes?: number;
  seasons?: number[];
  episodes?: MediaFileRecord[];
  all_qualities?: Array<{ id: number; quality: string; file_size: number; file_name?: string }>;
}

export async function getVaultCatalogGrouped(query?: string): Promise<VaultGroupedItem[]> {
  try {
    const all = await getAllMediaFiles();
    const valid = all.filter(f => f.telegram_channel_id !== 'AutoVault' && !f.telegram_file_id?.includes('USERBOT') && !f.telegram_file_id?.includes('BOT_QUERY'));

    const { catalog } = groupMediaIntoCatalog(valid as any);

    let list = catalog as unknown as VaultGroupedItem[];
    if (query && query.trim()) {
      const clean = query.trim().toLowerCase();
      const qNorm = clean.replace(/[^a-z0-9]/g, '');
      list = list.filter(item => {
        const t = item.movie_title.toLowerCase();
        const tNorm = t.replace(/[^a-z0-9]/g, '');
        return t.includes(clean) || (qNorm.length >= 2 && tNorm.includes(qNorm));
      });
    }

    return list;
  } catch (err) {
    console.error("Error getting vault catalog grouped:", err);
    return [];
  }
}

export async function getVaultSeriesCatalog(query?: string): Promise<VaultGroupedItem[]> {
  try {
    const all = await getAllMediaFiles();
    const valid = all.filter(f => f.telegram_channel_id !== 'AutoVault' && !f.telegram_file_id?.includes('USERBOT') && !f.telegram_file_id?.includes('BOT_QUERY'));

    const { seriesList } = groupMediaIntoCatalog(valid as any);

    let list = seriesList as unknown as VaultGroupedItem[];
    if (query && query.trim()) {
      const clean = query.trim().toLowerCase();
      const qNorm = clean.replace(/[^a-z0-9]/g, '');
      list = list.filter(item => {
        const t = item.movie_title.toLowerCase();
        const tNorm = t.replace(/[^a-z0-9]/g, '');
        return t.includes(clean) || (qNorm.length >= 2 && tNorm.includes(qNorm));
      });
    }

    return list;
  } catch (err) {
    console.error("Error getting vault series catalog:", err);
    return [];
  }
}

export async function sanitizeAndStructureAllSeries(): Promise<{ total: number; seriesUpdated: number }> {
  try {
    const allRows = (await db.execute("SELECT * FROM media_files")).rows as unknown as MediaFileRecord[];
    let seriesUpdated = 0;

    for (const r of allRows) {
      const t = String(r.movie_title || "");
      const fn = String(r.file_name || t || "");

      const parsed = parseMediaTitleAndSeriesInfo(fn, t);

      const titleChanged = parsed.cleanTitle && parsed.cleanTitle !== t;
      const seasonChanged = parsed.isSeries ? (r.season !== parsed.season || r.episode !== parsed.episode) : (r.season !== null || r.episode !== null);
      const isBadTitle = t.endsWith("(") || t.endsWith(" -") || t.includes("@") || t.toLowerCase().includes(".mkv") || t.toLowerCase().includes(".mp4");

      if (titleChanged || seasonChanged || isBadTitle) {
        const finalTitle = parsed.cleanTitle || t.replace(/\s*\(\s*$/, "").trim();
        const finalSeason = parsed.isSeries ? (parsed.season ?? 1) : null;
        const finalEpisode = parsed.isSeries ? (parsed.episode ?? null) : null;
        const finalQuality = parsed.quality || r.quality || "1080p";
        const finalYear = parsed.year || r.year || "";

        await db.execute({
          sql: `UPDATE media_files 
                SET movie_title = ?, 
                    year = ?, 
                    quality = ?, 
                    season = ?, 
                    episode = ? 
                WHERE id = ?`,
          args: [
            finalTitle, 
            finalYear, 
            finalQuality, 
            finalSeason, 
            finalEpisode, 
            r.id
          ]
        });

        r.movie_title = finalTitle;
        if (finalYear) r.year = finalYear;
        if (finalQuality) r.quality = finalQuality;
        r.season = finalSeason;
        r.episode = finalEpisode;
        seriesUpdated++;
      }
    }

    console.log(`[Series Intelligence] Structured and organized ${seriesUpdated} media records across TV series and movies.`);
    return { total: allRows.length, seriesUpdated };
  } catch (err) {
    console.error("Error in sanitizeAndStructureAllSeries:", err);
    return { total: 0, seriesUpdated: 0 };
  }
}

export async function getMovieQualities(movieTitle: string, year?: string): Promise<MediaFileRecord[]> {
  try {
    const cleanTitle = movieTitle.trim();
    const normClean = cleanTitle.toLowerCase().replace(/[\s._\-:,'&/()]+/g, '');

    let sql = `SELECT * FROM media_files 
               WHERE (
                 LOWER(movie_title) = LOWER(?) 
                 OR REPLACE(REPLACE(REPLACE(REPLACE(LOWER(movie_title), ' ', ''), '.', ''), '-', ''), ':', '') = ?
               ) AND (season IS NULL OR season = '')`;
    const args: any[] = [cleanTitle, normClean];

    if (year && year.trim()) {
      sql += ` AND (year = ? OR year = '' OR year IS NULL)`;
      args.push(year.trim());
    }

    sql += ` ORDER BY file_size DESC, id DESC`;

    const res = await db.execute({ sql, args });
    if (res.rows.length > 0) {
      return res.rows as unknown as MediaFileRecord[];
    }

    return [];
  } catch (err) {
    console.error("Error getting movie qualities:", err);
    return [];
  }
}

export async function addMediaFile(file: Omit<MediaFileRecord, "id" | "created_at">): Promise<number> {
  // Automatically parse title, series, season, and quality if needed
  const parsed = parseMediaTitleAndSeriesInfo(file.file_name || "", file.movie_title);
  const movie_title = parsed.cleanTitle || file.movie_title;
  const season = parsed.isSeries ? (file.season ?? parsed.season ?? 1) : (file.season ?? null);
  const episode = parsed.isSeries ? (file.episode ?? parsed.episode ?? null) : (file.episode ?? null);
  const quality = file.quality || parsed.quality || "1080p";
  const year = file.year || parsed.year || "";

  // Helper to normalize strings for robust comparison (handles 'Ford v Ferrari' vs 'Ford v. Ferrari' vs 'Ford vs Ferrari')
  const normalizeKey = (str: string) => {
    return str
      .toLowerCase()
      .replace(/[\s._\-:,'&/()]+/g, "")
      .replace(/\b(part\s*1|part\s*i|chapter\s*1|vol\s*1)\b/g, "1")
      .replace(/\b(part\s*2|part\s*ii|chapter\s*2|vol\s*2)\b/g, "2")
      .replace(/\b(part\s*3|part\s*iii|chapter\s*3|vol\s*3)\b/g, "3")
      .replace(/\b(part\s*4|part\s*iv|chapter\s*4|vol\s*4)\b/g, "4")
      .trim();
  };

  const normQuality = (q: string) => {
    const l = (q || "1080p").toLowerCase().trim();
    if (l.includes("4k") || l.includes("2160")) return "4k";
    if (l.includes("1080")) return "1080p";
    if (l.includes("720")) return "720p";
    if (l.includes("480")) return "480p";
    return l;
  };

  const cleanNormQuality = normQuality(quality);

  // 1. Check if identical channel message already indexed
  if (file.telegram_channel_id && file.telegram_message_id) {
    const existingMsg = (await db.execute({
      sql: "SELECT id FROM media_files WHERE telegram_channel_id = ? AND telegram_message_id = ? LIMIT 1",
      args: [file.telegram_channel_id, file.telegram_message_id]
    })).rows;
    if (existingMsg.length > 0) {
      console.log(`[Deduplicator] Channel message #${file.telegram_message_id} in ${file.telegram_channel_id} already indexed (ID: ${existingMsg[0].id}). Skipping.`);
      return Number(existingMsg[0].id);
    }
  }

  // 2. Pre-Ingestion Deduplicator: Check by Title + Quality + Season/Episode
  let existingCheckSql = "";
  let checkArgs: any[] = [];

  if (season !== null && episode !== null) {
    existingCheckSql = `
      SELECT id, movie_title, quality FROM media_files 
      WHERE (
        LOWER(movie_title) = LOWER(?) 
        OR REPLACE(REPLACE(REPLACE(REPLACE(LOWER(movie_title), ' ', ''), '.', ''), '-', ''), ':', '') = ?
      )
      AND season = ? 
      AND episode = ? 
      AND (
        LOWER(quality) = LOWER(?)
        OR LOWER(quality) LIKE ?
      )
      LIMIT 1
    `;
    checkArgs = [movie_title, normalizeKey(movie_title), season, episode, quality, `%${cleanNormQuality}%`];
  } else {
    existingCheckSql = `
      SELECT id, movie_title, quality, year FROM media_files 
      WHERE (
        LOWER(movie_title) = LOWER(?) 
        OR REPLACE(REPLACE(REPLACE(REPLACE(LOWER(movie_title), ' ', ''), '.', ''), '-', ''), ':', '') = ?
      )
      AND (season IS NULL OR season = '') 
      AND (
        LOWER(quality) = LOWER(?)
        OR LOWER(quality) LIKE ?
      )
      ${year ? "AND (year = ? OR year = '' OR year IS NULL)" : ""}
      LIMIT 1
    `;
    checkArgs = year ? [movie_title, normalizeKey(movie_title), quality, `%${cleanNormQuality}%`, year] : [movie_title, normalizeKey(movie_title), quality, `%${cleanNormQuality}%`];
  }

  const duplicateCheck = (await db.execute({
    sql: existingCheckSql,
    args: checkArgs
  })).rows;

  if (duplicateCheck.length > 0) {
    const existingId = Number(duplicateCheck[0].id);
    console.log(`[Deduplicator] File "${movie_title}" (${quality}${season ? ` S${season}E${episode}` : ""}) is already in library (ID #${existingId}). Skipped duplicate indexing.`);
    if (file.telegram_channel_id && file.telegram_message_id) {
      await db.execute({
        sql: "UPDATE media_files SET telegram_channel_id = ?, telegram_message_id = ? WHERE id = ? AND (telegram_channel_id IS NULL OR telegram_channel_id = '' OR telegram_message_id IS NULL OR telegram_message_id = '' OR telegram_message_id = '0')",
        args: [file.telegram_channel_id, file.telegram_message_id, existingId]
      });
    }
    return existingId;
  }

  const res = await db.execute({
    sql: `
      INSERT INTO media_files (
        movie_id, movie_title, year, telegram_file_id, 
        telegram_channel_id, telegram_message_id, file_name, 
        file_size, quality, language, mime_type, season, episode, poster_url, trailer_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      file.movie_id,
      movie_title,
      year,
      file.telegram_file_id,
      file.telegram_channel_id || "",
      file.telegram_message_id || "",
      file.file_name || "",
      file.file_size || 0,
      quality,
      file.language || "English",
      file.mime_type || "video/mp4",
      season,
      episode,
      file.poster_url || null,
      file.trailer_url || null
    ]
  });
  const insertId = Number(res.lastInsertRowid || 0);
  
  return insertId;
}

export async function deleteMediaFile(id: number): Promise<boolean> {
  try {
    await db.execute({
      sql: "DELETE FROM media_files WHERE id = ?",
      args: [id]
    });
    return true;
  } catch (err) {
    console.error("Error deleting media file:", err);
    return false;
  }
}

export async function importVaultData(items: any[]): Promise<number> {
  let count = 0;
  for (const item of items) {
    if (!item.movie_title) continue;
    const existing = await db.execute({
      sql: "SELECT id FROM media_files WHERE telegram_file_id = ? OR (LOWER(movie_title) = LOWER(?) AND (year = ? OR ? = '')) LIMIT 1",
      args: [item.telegram_file_id || "", item.movie_title || "", item.year || "", item.year || ""]
    });
    if (existing.rows.length === 0) {
      await addMediaFile({
        movie_id: item.movie_id || `tg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        movie_title: item.movie_title,
        year: item.year || "",
        telegram_file_id: item.telegram_file_id || `tg_file_${Date.now()}`,
        telegram_channel_id: item.telegram_channel_id || "",
        telegram_message_id: item.telegram_message_id || "",
        file_name: item.file_name || `${item.movie_title}.mp4`,
        file_size: item.file_size || 0,
        quality: item.quality || "1080p",
        language: item.language || "English",
        mime_type: item.mime_type || "video/mp4",
        season: item.season ?? null,
        episode: item.episode ?? null,
        poster_url: item.poster_url || null
      });
      count++;
    }
  }
  return count;
}

export async function logChannelEvent(event: Omit<ChannelLogRecord, "id" | "created_at">): Promise<number> {
  try {
    const res = await db.execute({
      sql: `
        INSERT INTO channel_logs (
          channel_id, channel_title, message_id, media_type,
          parsed_title, quality, file_size, status, details
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        event.channel_id,
        event.channel_title || "",
        event.message_id || "",
        event.media_type || "video",
        event.parsed_title,
        event.quality || "1080p",
        event.file_size || 0,
        event.status || "indexed",
        event.details || ""
      ]
    });
    return Number(res.lastInsertRowid || 0);
  } catch (err) {
    console.error("Error logging channel event:", err);
    return 0;
  }
}

export async function getChannelLogs(limit: number = 20): Promise<ChannelLogRecord[]> {
  try {
    const res = await db.execute({
      sql: "SELECT * FROM channel_logs ORDER BY created_at DESC LIMIT ?",
      args: [limit]
    });
    return res.rows as unknown as ChannelLogRecord[];
  } catch (err) {
    console.error("Error fetching channel logs:", err);
    return [];
  }
}

export interface RequestRecord {
  id: number;
  telegram_id: string;
  tmdb_id: string;
  title: string;
  status: string;
  created_at: string;
}

export async function getPendingRequests(): Promise<RequestRecord[]> {
  try {
    const res = await db.execute("SELECT * FROM requests WHERE status = 'pending' ORDER BY created_at DESC");
    return res.rows as unknown as RequestRecord[];
  } catch (err) {
    console.error("Error fetching pending requests:", err);
    return [];
  }
}

export async function markRequestsFulfilled(requestIds: number[]): Promise<void> {
  if (requestIds.length === 0) return;
  try {
    const placeholders = requestIds.map(() => "?").join(",");
    await db.execute({
      sql: `UPDATE requests SET status = 'fulfilled' WHERE id IN (${placeholders})`,
      args: requestIds
    });
  } catch (err) {
    console.error("Error marking requests fulfilled:", err);
  }
}

export interface UserRecord {
  id: number;
  telegram_id: string;
  username?: string;
  first_name?: string;
  created_at?: string;
}

export async function getAllUsers(): Promise<UserRecord[]> {
  try {
    const res = await db.execute("SELECT * FROM users ORDER BY id DESC");
    return res.rows as unknown as UserRecord[];
  } catch (err) {
    console.error("Error fetching all users:", err);
    return [];
  }
}

export async function getRandomMediaFile(): Promise<MediaFileRecord | null> {
  try {
    const res = await db.execute("SELECT * FROM media_files ORDER BY RANDOM() LIMIT 1");
    if (res.rows.length > 0) {
      return res.rows[0] as unknown as MediaFileRecord;
    }
    return null;
  } catch (err) {
    console.error("Error getting random media file:", err);
    return null;
  }
}

export async function getAllVaultTitles(): Promise<string[]> {
  try {
    const res = await db.execute("SELECT DISTINCT movie_title FROM media_files WHERE movie_title IS NOT NULL AND movie_title != ''");
    return res.rows.map((r: any) => String(r.movie_title));
  } catch (err) {
    console.error("Error fetching vault titles:", err);
    return [];
  }
}

export async function getCollections(): Promise<CollectionRecord[]> {
  try {
    const res = await db.execute("SELECT * FROM collections ORDER BY created_at DESC");
    return res.rows as unknown as CollectionRecord[];
  } catch (err) {
    console.error("Error fetching collections:", err);
    return [];
  }
}

export async function createCollection(name: string, description: string = ""): Promise<void> {
  await db.execute({
    sql: "INSERT INTO collections (name, description) VALUES (?, ?)",
    args: [name, description]
  });
}

export async function addFileToCollection(collectionId: number, mediaFileId: number): Promise<void> {
  await db.execute({
    sql: "INSERT OR IGNORE INTO collection_items (collection_id, media_file_id) VALUES (?, ?)",
    args: [collectionId, mediaFileId]
  });
}

export async function removeFileFromCollection(collectionId: number, mediaFileId: number): Promise<void> {
  await db.execute({
    sql: "DELETE FROM collection_items WHERE collection_id = ? AND media_file_id = ?",
    args: [collectionId, mediaFileId]
  });
}

export async function getCollectionItems(collectionId: number): Promise<MediaFileRecord[]> {
  try {
    const res = await db.execute({
      sql: `
        SELECT m.* 
        FROM media_files m
        JOIN collection_items c ON m.id = c.media_file_id
        WHERE c.collection_id = ?
        ORDER BY c.added_at DESC
      `,
      args: [collectionId]
    });
    return res.rows as unknown as MediaFileRecord[];
  } catch (err) {
    console.error("Error fetching collection items:", err);
    return [];
  }
}

export async function saveEphemeralMessage(chatId: string | number, messageId: number, delayMs = 120000) {
  if (!chatId || !messageId || String(chatId).startsWith("-")) return;
  const deleteAt = Date.now() + delayMs;
  try {
    await db.execute({
      sql: `INSERT OR REPLACE INTO ephemeral_messages (chat_id, message_id, delete_at) VALUES (?, ?, ?)`,
      args: [String(chatId), messageId, deleteAt]
    });
  } catch (err: any) {
    console.warn("saveEphemeralMessage error:", err?.message);
  }
}

export async function getDueEphemeralMessages(nowMs = Date.now()): Promise<Array<{ chat_id: string; message_id: number }>> {
  try {
    const res = await db.execute({
      sql: `SELECT chat_id, message_id FROM ephemeral_messages WHERE delete_at <= ? LIMIT 50`,
      args: [nowMs]
    });
    return (res.rows || []).map((r: any) => ({ chat_id: String(r.chat_id), message_id: Number(r.message_id) }));
  } catch (err) {
    return [];
  }
}

export async function deleteEphemeralMessageFromDb(chatId: string | number, messageId: number) {
  try {
    await db.execute({
      sql: `DELETE FROM ephemeral_messages WHERE chat_id = ? AND message_id = ?`,
      args: [String(chatId), messageId]
    });
  } catch (err) {}
}

export async function clearChatEphemeralMessagesFromDb(chatId: string | number): Promise<Array<{ chat_id: string; message_id: number }>> {
  try {
    const res = await db.execute({
      sql: `SELECT chat_id, message_id FROM ephemeral_messages WHERE chat_id = ?`,
      args: [String(chatId)]
    });
    const items = (res.rows || []).map((r: any) => ({ chat_id: String(r.chat_id), message_id: Number(r.message_id) }));
    await db.execute({
      sql: `DELETE FROM ephemeral_messages WHERE chat_id = ?`,
      args: [String(chatId)]
    });
    return items;
  } catch (err) {
    return [];
  }
}

const DAY_S = 86400;

/** Stores a value behind a short key (Telegram callback data is limited to 64 bytes). Expires after `ttlSeconds`. */
export async function setCallbackKey(key: string, value: string, type: string = "general", ttlSeconds: number = 30 * DAY_S): Promise<void> {
  try {
    await db.execute({
      sql: `INSERT OR REPLACE INTO callback_cache (key, value, type, created_at, expires_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      args: [key, value, type, Math.floor(Date.now() / 1000) + ttlSeconds]
    });
  } catch (err: any) {
    console.warn("setCallbackKey error:", err?.message);
  }
}

export async function getCallbackKey(key: string): Promise<string | null> {
  try {
    const res = await db.execute({
      sql: `SELECT value FROM callback_cache WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)`,
      args: [key, Math.floor(Date.now() / 1000)]
    });
    return res.rows[0]?.value ? String(res.rows[0].value) : null;
  } catch {
    return null;
  }
}

export async function purgeExpiredCallbacks(): Promise<number> {
  try {
    const res = await db.execute({ sql: "DELETE FROM callback_cache WHERE expires_at IS NOT NULL AND expires_at < ?", args: [Math.floor(Date.now() / 1000)] });
    return res.rowsAffected;
  } catch {
    return 0;
  }
}

export { db };
