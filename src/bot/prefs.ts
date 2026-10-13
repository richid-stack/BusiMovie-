/** Per-viewer quality preference: "best" (largest), "small" (smaller download), or ask every time (default). */
import { db } from "../db/index.js";

export type QualityPref = "ask" | "best" | "small";
let ready = false;
async function ensure() {
  if (ready) return;
  await db.execute("CREATE TABLE IF NOT EXISTS user_prefs (user_id TEXT PRIMARY KEY, quality TEXT NOT NULL DEFAULT 'ask')");
  ready = true;
}
export async function getQualityPref(userId: string | number): Promise<QualityPref> {
  await ensure();
  const r = (await db.execute({ sql: "SELECT quality FROM user_prefs WHERE user_id=?", args: [String(userId)] })).rows[0] as any;
  return r?.quality === "best" || r?.quality === "small" ? r.quality : "ask";
}
export async function setQualityPref(userId: string | number, q: QualityPref) {
  await ensure();
  await db.execute({ sql: "INSERT OR REPLACE INTO user_prefs (user_id, quality) VALUES (?,?)", args: [String(userId), q] });
}

const rank = (q: string | null | undefined) => (/1080|2160|4k/i.test(String(q)) ? 2 : /720/.test(String(q)) ? 1 : 0);
/** Which copy to send without asking. Null when the viewer wants to choose (or there is nothing to choose between). */
export function pickPreferred<T extends { quality?: string | null; file_size?: number | null }>(files: T[], pref: QualityPref): T | null {
  if (pref === "ask" || files.length < 2) return null;
  const size = (f: T) => Number(f.file_size || 0);
  if (pref === "best") return [...files].sort((a, b) => rank(b.quality) - rank(a.quality) || size(b) - size(a))[0];
  const decent = files.filter((f) => rank(f.quality) >= 1);
  const pool = decent.length ? decent : files;
  return [...pool].sort((a, b) => (size(a) || Infinity) - (size(b) || Infinity))[0];
}
