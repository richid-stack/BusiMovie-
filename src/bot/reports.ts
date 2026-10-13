/** "Wrong file" reports from viewers. One per viewer per file; a few reports (or an admin's word) trigger a re-fetch. */
import { db } from "../db/index.js";

export const AUTO_FIX_AT = 3;
let ready = false;
async function ensure() {
  if (ready) return;
  await db.execute("CREATE TABLE IF NOT EXISTS file_reports (file_id INTEGER NOT NULL, user_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (file_id, user_id))");
  ready = true;
}
/** Returns how many different viewers have reported this file (including this one). */
export async function addReport(fileId: number, userId: string | number): Promise<number> {
  await ensure();
  await db.execute({ sql: "INSERT OR IGNORE INTO file_reports (file_id, user_id) VALUES (?,?)", args: [fileId, String(userId)] });
  return Number((await db.execute({ sql: "SELECT COUNT(*) AS n FROM file_reports WHERE file_id=?", args: [fileId] })).rows[0]?.n ?? 0);
}
export async function reportersOf(fileId: number): Promise<string[]> {
  await ensure();
  return ((await db.execute({ sql: "SELECT user_id FROM file_reports WHERE file_id=?", args: [fileId] })).rows as any[]).map((r) => String(r.user_id));
}
export async function clearReports(fileId: number) {
  await ensure();
  await db.execute({ sql: "DELETE FROM file_reports WHERE file_id=?", args: [fileId] });
}
