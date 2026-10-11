import { db } from "./index.js";

/** Storefront "Top 10 this week": one row per title per day, so the weekly total is a simple sum. */
let ready = false;
async function ensure() {
  if (ready) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS title_views (
    day TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, key)
  )`);
  ready = true;
}

export const viewKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "");

export async function recordView(title: string, now = new Date()): Promise<boolean> {
  const clean = String(title || "").trim().slice(0, 200);
  const key = viewKey(clean);
  if (key.length < 2) return false;
  await ensure();
  const day = now.toISOString().slice(0, 10);
  await db.execute({
    sql: `INSERT INTO title_views (day, key, title, n) VALUES (?, ?, ?, 1)
          ON CONFLICT(day, key) DO UPDATE SET n = n + 1`,
    args: [day, key, clean],
  });
  return true;
}

/** key -> views over the last `days` days (default a week). */
export async function recentViews(days = 7, now = new Date()): Promise<Map<string, number>> {
  await ensure();
  const since = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const rows = (await db.execute({ sql: "SELECT key, SUM(n) AS n FROM title_views WHERE day >= ? GROUP BY key", args: [since] })).rows as any[];
  return new Map(rows.map((r) => [String(r.key), Number(r.n) || 0]));
}

/** Old days are never read again; keep the table small. */
export async function purgeOldViews(keepDays = 30) {
  await ensure();
  const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 10);
  await db.execute({ sql: "DELETE FROM title_views WHERE day < ?", args: [cutoff] });
}
