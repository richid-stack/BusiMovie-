import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  deleteDoc, 
  getDocFromServer,
  Firestore 
} from "firebase/firestore";
import fs from "fs";
import path from "path";

let firestoreDb: Firestore | null = null;
let isConfigured = false;

export function initFirebase(): Firestore | null {
  if (firestoreDb) return firestoreDb;

  try {
    const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    if (!fs.existsSync(configPath)) {
      console.warn("[Firebase] No firebase-applet-config.json found, skipping Firestore initialization.");
      return null;
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const firebaseConfig = {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
    };

    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    const dbId = config.firestoreDatabaseId && config.firestoreDatabaseId !== "(default)" 
      ? config.firestoreDatabaseId 
      : undefined;

    firestoreDb = dbId ? getFirestore(app, dbId) : getFirestore(app);
    isConfigured = true;
    console.log(`[Firebase] Firestore initialized successfully with database: ${dbId || "(default)"}`);

    // Verify connection asynchronously as per Firebase guidelines
    testConnection();

    return firestoreDb;
  } catch (err) {
    console.error("[Firebase] Error initializing Firebase Firestore:", err);
    return null;
  }
}

async function testConnection() {
  if (!firestoreDb) return;
  try {
    await getDocFromServer(doc(firestoreDb, "test", "connection"));
    console.log("[Firebase] Firestore connection test passed.");
  } catch (error: any) {
    if (error?.message?.includes("the client is offline")) {
      console.error("[Firebase] Please check your Firebase network/configuration.");
    } else {
      // Missing document is normal, means connection reached server
      console.log("[Firebase] Firestore server reachable.");
    }
  }
}

export function getFirebaseDb(): Firestore | null {
  if (!firestoreDb) {
    return initFirebase();
  }
  return firestoreDb;
}

// Save a media file to Firestore (permanent cloud storage)
export async function saveMediaFileToFirestore(file: any): Promise<boolean> {
  try {
    const db = getFirebaseDb();
    if (!db) return false;

    // Use numeric id or telegram_file_id as document id
    const docId = String(file.id || file.telegram_file_id || `${file.movie_id}_${Date.now()}`);
    const docRef = doc(db, "media_files", docId);
    
    // Clean undefined fields
    const dataToSave: Record<string, any> = {
      id: file.id ? Number(file.id) : Date.now(),
      movie_id: file.movie_id || "",
      movie_title: file.movie_title || "",
      year: file.year || "",
      telegram_file_id: file.telegram_file_id || "",
      telegram_channel_id: file.telegram_channel_id || "",
      telegram_message_id: file.telegram_message_id || "",
      file_name: file.file_name || "",
      file_size: Number(file.file_size || 0),
      quality: file.quality || "1080p",
      language: file.language || "English",
      mime_type: file.mime_type || "video/mp4",
      season: file.season ?? null,
      episode: file.episode ?? null,
      poster_url: file.poster_url || null,
      trailer_url: file.trailer_url || null,
      updated_at: new Date().toISOString()
    };

    await setDoc(docRef, dataToSave, { merge: true });
    console.log(`[Firebase] Saved media file "${file.movie_title}" (ID: ${docId}) to Firestore.`);
    return true;
  } catch (err) {
    console.error("[Firebase] Error saving media file to Firestore:", err);
    return false;
  }
}

// Fetch all media files stored in Firestore
export async function getAllMediaFilesFromFirestore(): Promise<any[]> {
  try {
    const db = getFirebaseDb();
    if (!db) return [];

    const colRef = collection(db, "media_files");
    const snapshot = await getDocs(colRef);
    const files: any[] = [];

    snapshot.forEach((d) => {
      files.push({ ...d.data(), docId: d.id });
    });

    console.log(`[Firebase] Retrieved ${files.length} media files from Firestore.`);
    return files;
  } catch (err) {
    console.error("[Firebase] Error fetching media files from Firestore:", err);
    return [];
  }
}

// Delete media file from Firestore
export async function deleteMediaFileFromFirestore(id: string | number): Promise<boolean> {
  try {
    const db = getFirebaseDb();
    if (!db) return false;

    const docId = String(id);
    await deleteDoc(doc(db, "media_files", docId));
    console.log(`[Firebase] Deleted media file ${docId} from Firestore.`);
    return true;
  } catch (err) {
    console.error("[Firebase] Error deleting media file from Firestore:", err);
    return false;
  }
}

// Save app setting to Firestore (key-value)
export async function saveAppSettingToFirestore(key: string, value: string): Promise<boolean> {
  try {
    const db = getFirebaseDb();
    if (!db) return false;
    await setDoc(doc(db, "app_settings", key), {
      key,
      value,
      updated_at: new Date().toISOString()
    }, { merge: true });
    return true;
  } catch (err) {
    console.error(`[Firebase] Error saving setting "${key}" to Firestore:`, err);
    return false;
  }
}

// Get single setting from Firestore
export async function getAppSettingFromFirestore(key: string): Promise<string | null> {
  try {
    const db = getFirebaseDb();
    if (!db) return null;
    const snap = await getDoc(doc(db, "app_settings", key));
    if (snap.exists() && snap.data()?.value) {
      return String(snap.data().value);
    }
    return null;
  } catch (err) {
    console.warn(`[Firebase] Error reading setting "${key}" from Firestore:`, err);
    return null;
  }
}

// Get all settings from Firestore
export async function getAllAppSettingsFromFirestore(): Promise<Record<string, string>> {
  try {
    const db = getFirebaseDb();
    if (!db) return {};
    const snap = await getDocs(collection(db, "app_settings"));
    const settings: Record<string, string> = {};
    snap.forEach((d) => {
      const data = d.data();
      if (data?.value !== undefined) {
        settings[d.id] = String(data.value);
      }
    });
    return settings;
  } catch (err) {
    console.warn("[Firebase] Error reading all settings from Firestore:", err);
    return {};
  }
}

// Delete setting from Firestore
export async function deleteAppSettingFromFirestore(key: string): Promise<boolean> {
  try {
    const db = getFirebaseDb();
    if (!db) return false;
    await deleteDoc(doc(db, "app_settings", key));
    return true;
  } catch (err) {
    console.error(`[Firebase] Error deleting setting "${key}" from Firestore:`, err);
    return false;
  }
}

// Save search bots to Firestore
export async function saveSearchBotsToFirestore(bots: any[]): Promise<boolean> {
  try {
    const db = getFirebaseDb();
    if (!db) return false;
    for (const b of bots) {
      const docId = b.bot_username || String(b.id);
      await setDoc(doc(db, "search_bots", docId), {
        bot_username: b.bot_username,
        bot_type: b.bot_type || "command",
        command_template: b.command_template || "/search {query}",
        status: b.status || "active",
        priority: Number(b.priority || 1),
        success_count: Number(b.success_count || 0),
        updated_at: new Date().toISOString()
      }, { merge: true });
    }
    return true;
  } catch (err) {
    console.error("[Firebase] Error saving search bots to Firestore:", err);
    return false;
  }
}

// Get all search bots from Firestore
export async function getAllSearchBotsFromFirestore(): Promise<any[]> {
  try {
    const db = getFirebaseDb();
    if (!db) return [];
    const snap = await getDocs(collection(db, "search_bots"));
    const bots: any[] = [];
    snap.forEach((d) => {
      bots.push({ ...d.data(), id: d.id });
    });
    return bots;
  } catch (err) {
    console.warn("[Firebase] Error reading search bots from Firestore:", err);
    return [];
  }
}

// Save crawler targets to Firestore
export async function saveCrawlerTargetsToFirestore(targets: any[]): Promise<boolean> {
  try {
    const db = getFirebaseDb();
    if (!db) return false;
    for (const t of targets) {
      const docId = t.channel_identifier || String(t.id);
      await setDoc(doc(db, "crawler_targets", docId), {
        channel_identifier: t.channel_identifier,
        title: t.title || t.channel_identifier,
        status: t.status || "active",
        min_file_size_mb: Number(t.min_file_size_mb || 300),
        quality_filter: t.quality_filter || "all",
        total_files_found: Number(t.total_files_found || 0),
        updated_at: new Date().toISOString()
      }, { merge: true });
    }
    return true;
  } catch (err) {
    console.error("[Firebase] Error saving crawler targets to Firestore:", err);
    return false;
  }
}

// Get all crawler targets from Firestore
export async function getAllCrawlerTargetsFromFirestore(): Promise<any[]> {
  try {
    const db = getFirebaseDb();
    if (!db) return [];
    const snap = await getDocs(collection(db, "crawler_targets"));
    const targets: any[] = [];
    snap.forEach((d) => {
      targets.push({ ...d.data(), id: d.id });
    });
    return targets;
  } catch (err) {
    console.warn("[Firebase] Error reading crawler targets from Firestore:", err);
    return [];
  }
}
