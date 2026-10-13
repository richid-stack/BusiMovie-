/**
 * Follow a series: viewers tap "Follow" and get one short message when new episodes land.
 * A whole season arriving at once becomes a single message ("8 new episodes"), not eight.
 */
import { db } from "../db/index.js";

export const followKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

let ready = false;
async function ensure() {
  if (ready) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS follows (
    user_id TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, key))`);
  ready = true;
}

export async function follow(userId: string | number, title: string) {
  await ensure();
  await db.execute({ sql: "INSERT OR IGNORE INTO follows (user_id, key, title) VALUES (?,?,?)", args: [String(userId), followKey(title), title] });
}
export async function unfollow(userId: string | number, key: string) {
  await ensure();
  await db.execute({ sql: "DELETE FROM follows WHERE user_id=? AND key=?", args: [String(userId), key] });
}
export async function isFollowing(userId: string | number, title: string): Promise<boolean> {
  await ensure();
  return (await db.execute({ sql: "SELECT 1 FROM follows WHERE user_id=? AND key=?", args: [String(userId), followKey(title)] })).rows.length > 0;
}
export async function listFollows(userId: string | number): Promise<Array<{ key: string; title: string }>> {
  await ensure();
  return (await db.execute({ sql: "SELECT key, title FROM follows WHERE user_id=? ORDER BY created_at DESC", args: [String(userId)] })).rows as any[];
}
export async function followersOf(title: string): Promise<string[]> {
  await ensure();
  return ((await db.execute({ sql: "SELECT user_id FROM follows WHERE key=?", args: [followKey(title)] })).rows as any[]).map((r) => String(r.user_id));
}

export interface NewEpisode { id: number; season: number; episode: number }
export interface Notice { title: string; items: NewEpisode[] }

/** Collects new episodes per show for a short while, then hands each show's batch over once. */
export class EpisodeBatcher {
  private pending = new Map<string, Notice>();
  private timers = new Map<string, NodeJS.Timeout>();
  constructor(private delayMs: number, private flush: (n: Notice) => void | Promise<void>) {}
  add(title: string, item: NewEpisode) {
    const key = followKey(title);
    const n = this.pending.get(key) ?? { title, items: [] };
    n.items.push(item);
    this.pending.set(key, n);
    if (this.timers.has(key)) clearTimeout(this.timers.get(key)!);
    const t = setTimeout(() => {
      this.timers.delete(key);
      const out = this.pending.get(key);
      this.pending.delete(key);
      if (out) void Promise.resolve(this.flush(out)).catch((e) => console.warn("[follow] notify failed:", e?.message));
    }, this.delayMs);
    (t as any).unref?.();
    this.timers.set(key, t);
  }
}

/** "S02E05" or "S02E01–E08" or "S01–S02" style summary. */
export function describeEpisodes(items: NewEpisode[]): string {
  const sorted = [...items].sort((a, b) => a.season - b.season || a.episode - b.episode);
  const p = (n: number) => String(n).padStart(2, "0");
  if (sorted.length === 1) return `S${p(sorted[0].season)}E${p(sorted[0].episode)}`;
  const seasons = [...new Set(sorted.map((i) => i.season))];
  if (seasons.length === 1) return `S${p(seasons[0])}E${p(sorted[0].episode)}–E${p(sorted.at(-1)!.episode)}`;
  return `S${p(seasons[0])}–S${p(seasons.at(-1)!)}`;
}
