import { createClient } from "@libsql/client";
import path from "path";
import fs from "fs";
import { 
  initFirebase, 
  saveMediaFileToFirestore, 
  getAllMediaFilesFromFirestore, 
  deleteMediaFileFromFirestore 
} from "./firebase.js";

// Initialize the SQLite database
const db = createClient({
  url: "file:movie-bot.db",
});

const BACKUP_FILE = path.join(process.cwd(), "vault_library.json");

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

  // Restore any persisted files from disk backup if database restarted
  await restoreVaultFromDisk();

  // Synchronize with Firebase Firestore for durable cloud persistence
  await syncVaultWithFirestore();
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
    // Check by exact movie_id first
    let res = await db.execute({
      sql: "SELECT * FROM media_files WHERE movie_id = ? ORDER BY id DESC",
      args: [movieId]
    });
    if (res.rows.length > 0) {
      return res.rows as unknown as MediaFileRecord[];
    }

    // Fallback: check by case-insensitive title match if provided
    if (movieTitle) {
      res = await db.execute({
        sql: "SELECT * FROM media_files WHERE LOWER(movie_title) LIKE LOWER(?) ORDER BY id DESC",
        args: [`%${movieTitle.trim()}%`]
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
