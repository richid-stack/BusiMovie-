/**
 * Blocklist: things the library must never take in again.
 *   file  – one specific bad file (reported by viewers or removed by an admin). Matched by file name + size, so a bot
 *           that serves the same broken upload a second time is caught, while a different upload is not.
 *   title – a whole title taken down (takedown request, wrong content). Nothing for it is stored or fetched again.
 * Checked by the bot downloads, the channel crawler and the job queue.
 */
import { db } from "../db/index.js";
import { normalizeTitleFuzzy } from "./verify.js";

export interface BlockRow {
  id: number; kind: "file" | "title"; file_name: string | null; file_size: number | null;
  title: string | null; year: string | null; reason: string | null; created_at: string;
}

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute(`CREATE TABLE IF NOT EXISTS blocklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        file_key TEXT,
        file_name TEXT,
        file_size INTEGER,
        title_key TEXT,
        title TEXT,
        year TEXT,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_blocklist_file ON blocklist(file_key)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_blocklist_title ON blocklist(title_key)`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// ── pure helpers (unit-tested) ─────────────────────────────────────────────
/** "The.Movie.2020.1080p.mkv" and "the movie 2020 1080p MKV" are the same file name. */
export function fileKey(name: string): string {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
/** Sizes within 1% count as equal (re-uploads sometimes differ by a few bytes); an unknown size matches any. */
export function sameSize(a: number | null | undefined, b: number | null | undefined): boolean {
  const x = Number(a || 0), y = Number(b || 0);
  if (!x || !y) return true;
  return Math.abs(x - y) / Math.max(x, y) <= 0.01;
}
export function titleKey(title: string): string { return normalizeTitleFuzzy(title).replace(/[^a-z0-9]+/g, ""); }

export interface BlockEntry { id: number; kind: string; file_key?: string | null; file_size?: number | null; title_key?: string | null; year?: string | null }
export function matchFile<T extends BlockEntry>(rows: T[], fileName: string, size?: number | null): T | null {
  const k = fileKey(fileName);
  if (!k) return null;
  return rows.find((r) => r.kind === "file" && r.file_key === k && sameSize(r.file_size, size)) || null;
}
export function matchTitle<T extends BlockEntry>(rows: T[], title: string, year?: string | null): T | null {
  const k = titleKey(title);
  if (!k) return null;
  return rows.find((r) => r.kind === "title" && r.title_key === k && (!r.year || !year || String(r.year) === String(year))) || null;
}

// ── storage ────────────────────────────────────────────────────────────────
export async function blockFile(f: { fileName: string; fileSize?: number | null; title?: string | null; reason?: string }): Promise<number | null> {
  const k = fileKey(f.fileName);
  if (!k) return null; // nothing to recognise it by
  await ensure();
  const rows = (await db.execute({ sql: "SELECT * FROM blocklist WHERE kind='file' AND file_key=?", args: [k] })).rows as any[];
  const have = matchFile(rows, f.fileName, f.fileSize);
  if (have) return have.id;
  const r = await db.execute({
    sql: "INSERT INTO blocklist (kind, file_key, file_name, file_size, title, reason) VALUES ('file',?,?,?,?,?)",
    args: [k, f.fileName, Number(f.fileSize || 0), f.title || null, f.reason || null],
  });
  return Number(r.lastInsertRowid || 0);
}

export async function blockTitle(title: string, year?: string | null, reason?: string): Promise<number | null> {
  const k = titleKey(title);
  if (!k) return null;
  await ensure();
  const rows = (await db.execute({ sql: "SELECT * FROM blocklist WHERE kind='title' AND title_key=?", args: [k] })).rows as any[];
  const have = rows.find((r) => String(r.year || "") === String(year || ""));
  if (have) return have.id;
  const r = await db.execute({
    sql: "INSERT INTO blocklist (kind, title_key, title, year, reason) VALUES ('title',?,?,?,?)",
    args: [k, title, year || null, reason || null],
  });
  return Number(r.lastInsertRowid || 0);
}

export async function unblock(id: number): Promise<boolean> {
  await ensure();
  await db.execute({ sql: "DELETE FROM blocklist WHERE id=?", args: [id] });
  return true;
}

export async function listBlocks(): Promise<BlockRow[]> {
  await ensure();
  return (await db.execute("SELECT id, kind, file_name, file_size, title, year, reason, created_at FROM blocklist ORDER BY id DESC LIMIT 500")).rows as unknown as BlockRow[];
}

export async function fileBlock(fileName: string, size?: number | null): Promise<BlockRow | null> {
  const k = fileKey(fileName);
  if (!k) return null;
  await ensure();
  const rows = (await db.execute({ sql: "SELECT * FROM blocklist WHERE kind='file' AND file_key=?", args: [k] })).rows as any[];
  return matchFile(rows, fileName, size) as BlockRow | null;
}

export async function titleBlock(title: string, year?: string | null): Promise<BlockRow | null> {
  const k = titleKey(title);
  if (!k) return null;
  await ensure();
  const rows = (await db.execute({ sql: "SELECT * FROM blocklist WHERE kind='title' AND title_key=?", args: [k] })).rows as any[];
  return matchTitle(rows, title, year) as BlockRow | null;
}

/** One check for "may this come in?" Returns the reason it may not, or null. */
export async function whyBlocked(c: { title?: string | null; year?: string | null; fileName?: string | null; size?: number | null }): Promise<string | null> {
  if (c.fileName) {
    const f = await fileBlock(c.fileName, c.size);
    if (f) return `this exact file was reported or removed earlier${f.reason ? ` (${f.reason})` : ""}`;
  }
  if (c.title) {
    const t = await titleBlock(c.title, c.year);
    if (t) return `"${t.title}" is on the takedown list${t.reason ? ` (${t.reason})` : ""}`;
  }
  return null;
}
