import { createClient } from "@libsql/client";
import path from "path";
import fs from "fs";
import { 
  initFirebase, 
  saveMediaFileToFirestore, 
  getAllMediaFilesFromFirestore, 
  deleteMediaFileFromFirestore,
  saveAppSettingToFirestore,
  getAppSettingFromFirestore,
  getAllAppSettingsFromFirestore,
  deleteAppSettingFromFirestore,
  saveSearchBotsToFirestore,
  getAllSearchBotsFromFirestore,
  saveCrawlerTargetsToFirestore,
  getAllCrawlerTargetsFromFirestore
} from "./firebase.js";

// Initialize the SQLite database
const db = createClient({
  url: "file:movie-bot.db",
});

const BACKUP_FILE = path.join(process.cwd(), "vault_library.json");
const SETTINGS_BACKUP_FILE = path.join(process.cwd(), "settings_backup.json");
const BOTS_BACKUP_FILE = path.join(process.cwd(), "bots_backup.json");
const TARGETS_BACKUP_FILE = path.join(process.cwd(), "targets_backup.json");

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      if (raw.trim()) return JSON.parse(raw);
    }
  } catch (err) {
    console.warn("Could not read JSON file " + filePath + ":", err);
  }
  return fallback;
}

function writeJsonFile(filePath: string, data: any): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.warn("Could not write JSON file " + filePath + ":", err);
  }
}

export async function syncVaultToDisk(): Promise<void> {
  try {
    const res = await db.execute("SELECT * FROM media_files ORDER BY id ASC");
    if (res.rows && res.rows.length > 0) {
      fs.writeFileSync(BACKUP_FILE, JSON.stringify(res.rows, null, 2), "utf8");
    }
  } catch (err) {
    console.warn("Could not sync vault to disk backup:", err);
  }
}

export async function syncVaultWithFirestore(): Promise<void> {
  try {
    initFirebase();
    const cloudFiles = await getAllMediaFilesFromFirestore();
    
    if (cloudFiles && cloudFiles.length > 0) {
      console.log(`[Firestore Sync] Found ${cloudFiles.length} media items in Firebase Firestore. Merging to local vault...`);
      for (const file of cloudFiles) {
        if (!file.movie_title) continue;
        const id = file.id ? Number(file.id) : null;
        if (id) {
          await db.execute({
            sql: `
              INSERT OR REPLACE INTO media_files (
                id, movie_id, movie_title, year, telegram_file_id, 
                telegram_channel_id, telegram_message_id, file_name, 
                file_size, quality, language, mime_type, season, episode, poster_url, trailer_url
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              id,
              file.movie_id || `tg_${Date.now()}`,
              file.movie_title,
              file.year || "",
              file.telegram_file_id || "",
              file.telegram_channel_id || "",
              file.telegram_message_id || "",
              file.file_name || `${file.movie_title}.mp4`,
              file.file_size || 0,
              file.quality || "1080p",
              file.language || "English",
              file.mime_type || "video/mp4",
              file.season ?? null,
              file.episode ?? null,
              file.poster_url || null,
              file.trailer_url || null
            ]
          });
        } else {
          await db.execute({
            sql: `
              INSERT INTO media_files (
                movie_id, movie_title, year, telegram_file_id, 
                telegram_channel_id, telegram_message_id, file_name, 
                file_size, quality, language, mime_type, season, episode, poster_url, trailer_url
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              file.movie_id || `tg_${Date.now()}`,
              file.movie_title,
              file.year || "",
              file.telegram_file_id || "",
              file.telegram_channel_id || "",
              file.telegram_message_id || "",
              file.file_name || `${file.movie_title}.mp4`,
              file.file_size || 0,
              file.quality || "1080p",
              file.language || "English",
              file.mime_type || "video/mp4",
              file.season ?? null,
              file.episode ?? null,
              file.poster_url || null,
              file.trailer_url || null
            ]
          });
        }
      }
      await syncVaultToDisk();
      console.log(`[Firestore Sync] Successfully restored and cached ${cloudFiles.length} movies from Firestore.`);
    } else {
      // Cloud is empty, push local backup to Firestore
      const localRes = await db.execute("SELECT * FROM media_files ORDER BY id ASC");
      if (localRes.rows && localRes.rows.length > 0) {
        console.log(`[Firestore Sync] Firestore library empty. Backing up ${localRes.rows.length} local movies to Firebase Firestore...`);
        for (const row of localRes.rows) {
          await saveMediaFileToFirestore(row);
        }
        console.log(`[Firestore Sync] Cloud backup complete.`);
      }
    }
  } catch (err) {
    console.error("[Firestore Sync] Error synchronizing with Firebase Firestore:", err);
  }
}

export async function restoreVaultFromDisk(): Promise<number> {
  try {
    if (!fs.existsSync(BACKUP_FILE)) {
      // If backup doesn't exist yet, seed it from existing media_files
      await syncVaultToDisk();
      return 0;
    }

    const raw = fs.readFileSync(BACKUP_FILE, "utf8");
    if (!raw.trim()) return 0;
    const items: MediaFileRecord[] = JSON.parse(raw);
    if (!Array.isArray(items) || items.length === 0) return 0;

    let restoredCount = 0;
    for (const file of items) {
      const existing = await db.execute({
        sql: "SELECT id FROM media_files WHERE telegram_file_id = ? OR (LOWER(movie_title) = LOWER(?) AND (year = ? OR ? = '')) LIMIT 1",
        args: [file.telegram_file_id || "", file.movie_title || "", file.year || "", file.year || ""]
      });

      if (existing.rows.length === 0 && file.movie_title) {
        if (file.id) {
          await db.execute({
            sql: `
              INSERT OR REPLACE INTO media_files (
                id, movie_id, movie_title, year, telegram_file_id, 
                telegram_channel_id, telegram_message_id, file_name, 
                file_size, quality, language, mime_type, season, episode, poster_url, trailer_url
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              file.id,
              file.movie_id || `tg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
              file.movie_title,
              file.year || "",
              file.telegram_file_id || `tg_file_${Date.now()}`,
              file.telegram_channel_id || "",
              file.telegram_message_id || "",
              file.file_name || `${file.movie_title}.mp4`,
              file.file_size || 0,
              file.quality || "1080p",
              file.language || "English",
              file.mime_type || "video/mp4",
              file.season ?? null,
              file.episode ?? null,
              file.poster_url || null,
              file.trailer_url || null
            ]
          });
        } else {
          await db.execute({
            sql: `
              INSERT INTO media_files (
                movie_id, movie_title, year, telegram_file_id, 
                telegram_channel_id, telegram_message_id, file_name, 
                file_size, quality, language, mime_type, season, episode, poster_url, trailer_url
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              file.movie_id || `tg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
              file.movie_title,
              file.year || "",
              file.telegram_file_id || `tg_file_${Date.now()}`,
              file.telegram_channel_id || "",
              file.telegram_message_id || "",
              file.file_name || `${file.movie_title}.mp4`,
              file.file_size || 0,
              file.quality || "1080p",
              file.language || "English",
              file.mime_type || "video/mp4",
              file.season ?? null,
              file.episode ?? null,
              file.poster_url || null,
              file.trailer_url || null
            ]
          });
        }
        restoredCount++;
      }
    }

    if (restoredCount > 0) {
      console.log(`[Vault Backup] Automatically restored ${restoredCount} movies into Vault database.`);
    }
    return restoredCount;
  } catch (err) {
    console.error("Error in restoreVaultFromDisk:", err);
    return 0;
  }
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

  // Multi-tier persistence: Restore settings from disk and Firestore
  try {
    const diskSettings = readJsonFile<Record<string, string>>(SETTINGS_BACKUP_FILE, {});
    for (const [k, v] of Object.entries(diskSettings)) {
      if (v) {
        await db.execute({
          sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
          args: [k, v]
        });
      }
    }

    const cloudSettings = await getAllAppSettingsFromFirestore();
    for (const [k, v] of Object.entries(cloudSettings)) {
      if (v) {
        await db.execute({
          sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
          args: [k, v]
        });
        diskSettings[k] = v;
      }
    }
    writeJsonFile(SETTINGS_BACKUP_FILE, diskSettings);
  } catch (err) {
    console.warn("Could not sync settings during setup:", err);
  }

  // Ensure default vault channel ID is permanently linked
  const currentVault = await getSetting("telegram_vault_channel_id");
  if (!currentVault) {
    await setSetting("telegram_vault_channel_id", "-1004314551318");
  }

  // Restore and persist search bots & crawler targets
  await syncBotsAndTargetsPersistence();

  // Restore any persisted files from disk backup if database restarted
  await restoreVaultFromDisk();

  // Synchronize with Firebase Firestore for durable cloud persistence
  await syncVaultWithFirestore();

  // Clean up any fake mock records from previous tests and fix mis-titled movies (run AFTER sync so fake records are purged from both SQLite and Firestore)
  await cleanUpCorruptedVaultRecords();
}

export function extractCleanTitleDetails(fileName: string, currentTitle?: string) {
  let clean = fileName.replace(/\.[a-zA-Z0-9]{2,4}$/, '').trim();
  clean = clean.replace(/^\[[A-Za-z0-9 _-]+\]\s*/, '');
  clean = clean.replace(/^@[\w_]+[_\s-]+/i, '').replace(/@[\w_]+/g, '');
  clean = clean.replace(/^(fc|psa|hevc|webrip|bluray|x265|x264)[_.-]+/i, '');
  
  if (/^s\.w\.a\.t/i.test(clean) || /^swat/i.test(clean) || /^s w a t/i.test(clean) || currentTitle === 'S W A T') {
    const seMatch = clean.match(/s(\d{1,2})e(\d{1,3})/i) || clean.match(/season\s*(\d{1,2})\s*episode\s*(\d{1,3})/i);
    const qMatch = clean.match(/\b(2160p|4K|1080p|720p|480p|HD)\b/i);
    return {
      title: "S.W.A.T.",
      year: "2017",
      quality: qMatch ? qMatch[1].toUpperCase() : "720P",
      season: seMatch ? parseInt(seMatch[1], 10) : undefined,
      episode: seMatch ? parseInt(seMatch[2], 10) : undefined
    };
  }

  const spaced = clean.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const seMatch = spaced.match(/\b(?:s(\d{1,2})\s*e(\d{1,3})|season\s*(\d{1,2})\s*episode\s*(\d{1,3}))\b/i);
  const yearMatch = spaced.match(/\b(19\d{2}|20\d{2})\b/);
  const qMatch = spaced.match(/\b(2160p|4k|1080p|720p|480p|hd|uhd)\b/i);

  let cutIdx = spaced.length;
  if (seMatch && seMatch.index !== undefined && seMatch.index > 0) cutIdx = Math.min(cutIdx, seMatch.index);
  if (yearMatch && yearMatch.index !== undefined && yearMatch.index > 0) cutIdx = Math.min(cutIdx, yearMatch.index);
  if (qMatch && qMatch.index !== undefined && qMatch.index > 0) cutIdx = Math.min(cutIdx, qMatch.index);

  let title = spaced.substring(0, cutIdx).replace(/\b(WEBRip|BluRay|BRRip|x264|x265|HEVC|AAC|HDR|HD|HQ|RMSTRD|NF|AMZN|PSA)\b/gi, '').trim();
  if (!title || title.length < 2) title = spaced;

  const year = yearMatch ? yearMatch[1] : '';
  const quality = qMatch ? qMatch[1].toUpperCase() : '1080p';
  const season = seMatch ? parseInt(seMatch[1] || seMatch[3], 10) : undefined;
  const episode = seMatch ? parseInt(seMatch[2] || seMatch[4], 10) : undefined;

  return { title, year, quality, season, episode };
}

export async function cleanUpCorruptedVaultRecords(): Promise<void> {
  try {
    // 1. Delete purely fake records created by old test mock runs
    const fakeRows = (await db.execute({
      sql: "SELECT id, telegram_file_id FROM media_files WHERE telegram_file_id LIKE '%USERBOT%' OR telegram_file_id LIKE '%BOT_QUERY%' OR telegram_channel_id = 'AutoVault'"
    })).rows;

    for (const r of fakeRows) {
      if (r.id) {
        deleteMediaFileFromFirestore(r.id as number).catch(() => {});
      }
      if (r.telegram_file_id) {
        deleteMediaFileFromFirestore(String(r.telegram_file_id)).catch(() => {});
      }
    }

    const delRes = await db.execute({
      sql: "DELETE FROM media_files WHERE telegram_file_id LIKE '%USERBOT%' OR telegram_file_id LIKE '%BOT_QUERY%' OR telegram_channel_id = 'AutoVault'"
    });
    if (delRes.rowsAffected > 0) {
      console.log(`[Vault Cleanup] Removed ${delRes.rowsAffected} fake media file records from SQLite and Firestore.`);
    }

    // 2. Fetch all rows and sanitize any messy, promo, or spaced titles
    const allRows = (await db.execute("SELECT * FROM media_files")).rows as unknown as MediaFileRecord[];
    let cleanedCount = 0;
    for (const r of allRows) {
      const t = String(r.movie_title || "");
      const fn = String(r.file_name || "");
      const isBad = 
        t.includes("@") || 
        t.toLowerCase().includes("join") || 
        t === "S W A T" || 
        t.toLowerCase().includes("bluray") || 
        t.toLowerCase().includes("webrip") || 
        t.toLowerCase().includes("720p") || 
        t.toLowerCase().includes("1080p") ||
        t.toLowerCase().includes(".mkv") ||
        t.toLowerCase().includes(".mp4");

      if (isBad && fn) {
        const details = extractCleanTitleDetails(fn, t);
        await db.execute({
          sql: `UPDATE media_files 
                SET movie_title = ?, 
                    year = COALESCE(NULLIF(?, ''), year), 
                    quality = COALESCE(NULLIF(?, ''), quality), 
                    season = COALESCE(?, season), 
                    episode = COALESCE(?, episode) 
                WHERE id = ?`,
          args: [
            details.title, 
            details.year || "", 
            details.quality || "", 
            details.season ?? null, 
            details.episode ?? null, 
            r.id
          ]
        });

        // Update in-memory record to save to Firestore and backup
        r.movie_title = details.title;
        if (details.year) r.year = details.year;
        if (details.quality) r.quality = details.quality;
        if (details.season !== undefined) r.season = details.season;
        if (details.episode !== undefined) r.episode = details.episode;
        saveMediaFileToFirestore(r).catch(() => {});
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[Vault Cleanup] Sanitized and restored clean titles for ${cleanedCount} media files.`);
    }

    await syncVaultToDisk();
  } catch (err) {
    console.error("Error in cleanUpCorruptedVaultRecords:", err);
  }
}

export async function syncBotsAndTargetsPersistence(): Promise<void> {
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

    // Restore search_bots from disk or Firestore
    const diskBots = readJsonFile<any[]>(BOTS_BACKUP_FILE, []);
    const cloudBots = await getAllSearchBotsFromFirestore();
    const allBots = [...cloudBots, ...diskBots];

    for (const b of allBots) {
      if (!b.bot_username) continue;
      await db.execute({
        sql: `INSERT OR REPLACE INTO search_bots 
              (bot_username, bot_type, command_template, status, priority, success_count) 
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          b.bot_username,
          b.bot_type || "command",
          b.command_template || "/search {query}",
          b.status || "active",
          Number(b.priority || 1),
          Number(b.success_count || 0)
        ]
      });
    }

    // If still empty, seed default search bots
    const botRows = (await db.execute("SELECT * FROM search_bots")).rows;
    if (botRows.length === 0) {
      const defaults = [
        { bot_username: "@Apple_moviebot", bot_type: "command", command_template: "/search {query}", priority: 1 },
        { bot_username: "@cinemagic_hd_bot", bot_type: "command", command_template: "/search {query}", priority: 1 },
        { bot_username: "@TGMovieSearchBot", bot_type: "inline", command_template: "/search {query}", priority: 2 },
        { bot_username: "@FilesSearchMasterBot", bot_type: "command", command_template: "/find {query}", priority: 3 }
      ];
      for (const d of defaults) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO search_bots (bot_username, bot_type, command_template, status, priority) VALUES (?, ?, ?, 'active', ?)`,
          args: [d.bot_username, d.bot_type, d.command_template, d.priority]
        });
      }
    }

    const currentBots = (await db.execute("SELECT * FROM search_bots")).rows;
    writeJsonFile(BOTS_BACKUP_FILE, currentBots);
    saveSearchBotsToFirestore(currentBots as any[]).catch(() => {});

    // Restore crawler_targets from disk or Firestore
    const diskTargets = readJsonFile<any[]>(TARGETS_BACKUP_FILE, []);
    const cloudTargets = await getAllCrawlerTargetsFromFirestore();
    const allTargets = [...cloudTargets, ...diskTargets];

    for (const t of allTargets) {
      if (!t.channel_identifier) continue;
      await db.execute({
        sql: `INSERT OR REPLACE INTO crawler_targets 
              (channel_identifier, title, status, min_file_size_mb, quality_filter, total_files_found) 
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          t.channel_identifier,
          t.title || t.channel_identifier,
          t.status || "active",
          Number(t.min_file_size_mb || 300),
          t.quality_filter || "all",
          Number(t.total_files_found || 0)
        ]
      });
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

    const currentTargets = (await db.execute("SELECT * FROM crawler_targets")).rows;
    writeJsonFile(TARGETS_BACKUP_FILE, currentTargets);
    saveCrawlerTargetsToFirestore(currentTargets as any[]).catch(() => {});
  } catch (err) {
    console.warn("Could not sync bots and targets persistence:", err);
  }
}

export async function getSetting(key: string): Promise<string | null> {
  try {
    // 1. Check local SQLite
    const res = await db.execute({
      sql: "SELECT value FROM app_settings WHERE key = ? LIMIT 1",
      args: [key]
    });
    if (res.rows && res.rows.length > 0 && res.rows[0].value) {
      return String(res.rows[0].value);
    }

    // 2. Check local disk backup
    const diskSettings = readJsonFile<Record<string, string>>(SETTINGS_BACKUP_FILE, {});
    if (diskSettings[key]) {
      await db.execute({
        sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        args: [key, diskSettings[key]]
      });
      return diskSettings[key];
    }

    // 3. Check persistent Firebase Firestore
    const cloudValue = await getAppSettingFromFirestore(key);
    if (cloudValue) {
      await db.execute({
        sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        args: [key, cloudValue]
      });
      diskSettings[key] = cloudValue;
      writeJsonFile(SETTINGS_BACKUP_FILE, diskSettings);
      return cloudValue;
    }
  } catch (err) {
    console.warn("Could not retrieve setting " + key + ":", err);
  }
  return null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  try {
    // 1. Save to SQLite
    await db.execute({
      sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
      args: [key, value]
    });

    // 2. Save to local disk backup
    const diskSettings = readJsonFile<Record<string, string>>(SETTINGS_BACKUP_FILE, {});
    diskSettings[key] = value;
    writeJsonFile(SETTINGS_BACKUP_FILE, diskSettings);

    // 3. Save to Firebase Firestore (permanent cloud persistence)
    saveAppSettingToFirestore(key, value).catch(err => {
      console.warn(`[Firestore] Background save for setting ${key} failed:`, err);
    });
  } catch (err) {
    console.error("Could not save setting " + key + ":", err);
  }
}

export async function deleteSetting(key: string): Promise<void> {
  try {
    await db.execute({
      sql: "DELETE FROM app_settings WHERE key = ?",
      args: [key]
    });
    const diskSettings = readJsonFile<Record<string, string>>(SETTINGS_BACKUP_FILE, {});
    delete diskSettings[key];
    writeJsonFile(SETTINGS_BACKUP_FILE, diskSettings);
    deleteAppSettingFromFirestore(key).catch(() => {});
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

    // 2. Check by title or filename with space/punctuation normalization
    if (movieTitle && movieTitle.trim()) {
      const cleanTitle = movieTitle.trim();
      const qNorm = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

      res = await db.execute({
        sql: `SELECT * FROM media_files 
              WHERE (
                LOWER(movie_title) LIKE LOWER(?) 
                OR LOWER(file_name) LIKE LOWER(?)
                OR REPLACE(REPLACE(REPLACE(LOWER(movie_title), '.', ''), ' ', ''), '_', '') LIKE ?
                OR REPLACE(REPLACE(REPLACE(LOWER(file_name), '.', ''), ' ', ''), '_', '') LIKE ?
              ) ${fakeFilter} ORDER BY id DESC`,
        args: [`%${cleanTitle}%`, `%${cleanTitle}%`, `%${qNorm}%`, `%${qNorm}%`]
      });
      if (res.rows.length > 0) {
        return res.rows as unknown as MediaFileRecord[];
      }

      // 3. Fallback: check normalized memory candidates
      const all = await getAllMediaFiles();
      const matched = all.filter(f => {
        if (f.telegram_channel_id === 'AutoVault' || f.telegram_file_id?.includes('USERBOT') || f.telegram_file_id?.includes('BOT_QUERY')) return false;
        const tNorm = (f.movie_title || "").toLowerCase().replace(/[^a-z0-9]/g, '');
        const fnNorm = (f.file_name || "").toLowerCase().replace(/[^a-z0-9]/g, '');
        return qNorm.length >= 2 && (tNorm.includes(qNorm) || fnNorm.includes(qNorm));
      });
      if (matched.length > 0) {
        return matched;
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
    let res = await db.execute("SELECT * FROM media_files ORDER BY created_at DESC");
    if (res.rows.length === 0) {
      // If local cache was cleared or reset, sync from Firestore immediately
      await syncVaultWithFirestore();
      res = await db.execute("SELECT * FROM media_files ORDER BY created_at DESC");
    }
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

export interface VaultSeriesSummary {
  title: string;
  year?: string;
  poster_url?: string;
  totalEpisodes: number;
  seasons: number[];
}

export async function getVaultSeriesCatalog(query?: string): Promise<VaultSeriesSummary[]> {
  try {
    const all = await getAllMediaFiles();
    const seriesFiles = all.filter(f => {
      if (f.telegram_channel_id === 'AutoVault' || f.telegram_file_id?.includes('USERBOT') || f.telegram_file_id?.includes('BOT_QUERY')) return false;
      return f.season !== null && f.season !== undefined;
    });

    const map = new Map<string, { title: string; year?: string; poster_url?: string; seasons: Set<number>; count: number }>();
    for (const f of seriesFiles) {
      const key = (f.movie_title || "Untitled Show").trim();
      if (!map.has(key)) {
        map.set(key, {
          title: key,
          year: f.year,
          poster_url: f.poster_url,
          seasons: new Set(),
          count: 0
        });
      }
      const item = map.get(key)!;
      item.count++;
      if (f.season) item.seasons.add(f.season);
      if (!item.poster_url && f.poster_url) item.poster_url = f.poster_url;
      if (!item.year && f.year) item.year = f.year;
    }

    let summaries: VaultSeriesSummary[] = Array.from(map.values()).map(v => ({
      title: v.title,
      year: v.year,
      poster_url: v.poster_url,
      totalEpisodes: v.count,
      seasons: Array.from(v.seasons).sort((a, b) => a - b)
    }));

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
    console.error("Error getting vault series catalog:", err);
    return [];
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

export async function getMovieQualities(movieTitle: string, year?: string): Promise<MediaFileRecord[]> {
  try {
    const cleanTitle = movieTitle.trim();
    let sql = `SELECT * FROM media_files 
               WHERE (
                 LOWER(movie_title) = LOWER(?) 
                 OR REPLACE(REPLACE(REPLACE(LOWER(movie_title), '.', ''), ' ', ''), '_', '') = REPLACE(REPLACE(REPLACE(LOWER(?), '.', ''), ' ', ''), '_', '')
               ) AND (season IS NULL OR season = '')`;
    const args: any[] = [cleanTitle, cleanTitle];

    if (year && year.trim()) {
      sql += ` AND year = ?`;
      args.push(year.trim());
    }

    sql += ` ORDER BY file_size DESC, id DESC`;

    const res = await db.execute({ sql, args });
    return res.rows as unknown as MediaFileRecord[];
  } catch (err) {
    console.error("Error getting movie qualities:", err);
    return [];
  }
}

export async function addMediaFile(file: Omit<MediaFileRecord, "id" | "created_at">): Promise<number> {
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
      file.movie_title,
      file.year || "",
      file.telegram_file_id,
      file.telegram_channel_id || "",
      file.telegram_message_id || "",
      file.file_name || "",
      file.file_size || 0,
      file.quality || "1080p",
      file.language || "English",
      file.mime_type || "video/mp4",
      file.season ?? null,
      file.episode ?? null,
      file.poster_url || null,
      file.trailer_url || null
    ]
  });
  const insertId = Number(res.lastInsertRowid || 0);
  
  // Persist backup to disk immediately
  syncVaultToDisk().catch(() => {});

  // Persist to Firebase Firestore for permanent cloud durability
  saveMediaFileToFirestore({ ...file, id: insertId }).catch((e) => {
    console.warn("Failed to save media file to Firestore:", e);
  });

  return insertId;
}

export async function deleteMediaFile(id: number): Promise<boolean> {
  try {
    await db.execute({
      sql: "DELETE FROM media_files WHERE id = ?",
      args: [id]
    });
    syncVaultToDisk().catch(() => {});
    deleteMediaFileFromFirestore(id).catch(() => {});
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
  await syncVaultToDisk();
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

export { db };
