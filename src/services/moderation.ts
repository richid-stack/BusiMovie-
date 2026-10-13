/**
 * Moderation: takedowns and viewer abuse controls.
 *   takedown – remove every file of a title, delete the vault copies, block it from ever coming back, drop it from the queue and wishlist
 *   bans     – a banned viewer gets nothing from the bot
 *   daily cap – at most N files per viewer per day (0 = no limit). Admins are never limited.
 */
import { db, deleteMediaFile, getSetting, setSetting } from "../db/index.js";
import { blockTitle, matchTitle, titleKey } from "../crawler/blocklist.js";

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute(`CREATE TABLE IF NOT EXISTS viewer_bans (telegram_id TEXT PRIMARY KEY, reason TEXT, banned_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      await db.execute(`CREATE TABLE IF NOT EXISTS daily_deliveries (telegram_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (telegram_id, day))`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// ── pure helpers (unit-tested) ─────────────────────────────────────────────
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
/** cap 0 (or unset) = unlimited. */
export function capReached(used: number, cap: number): boolean { return cap > 0 && used >= cap; }
/** "123456", "@name" or "tg:123456" → the part that identifies the viewer. */
export function parseViewerRef(raw: string): { id?: string; username?: string } | null {
  const t = String(raw || "").trim().replace(/^tg:/i, "");
  if (/^\d{4,15}$/.test(t)) return { id: t };
  const u = t.match(/^@?([A-Za-z][A-Za-z0-9_]{3,31})$/);
  return u ? { username: u[1] } : null;
}

// ── bans ───────────────────────────────────────────────────────────────────
const banCache = new Map<string, { banned: boolean; at: number }>();
export async function isBanned(telegramId: string | number): Promise<boolean> {
  const id = String(telegramId);
  const c = banCache.get(id);
  if (c && Date.now() - c.at < 30_000) return c.banned;
  await ensure();
  const banned = !!(await db.execute({ sql: "SELECT 1 FROM viewer_bans WHERE telegram_id=?", args: [id] })).rows[0];
  banCache.set(id, { banned, at: Date.now() });
  return banned;
}
export async function banViewer(telegramId: string | number, reason?: string) {
  await ensure();
  await db.execute({ sql: "INSERT OR REPLACE INTO viewer_bans (telegram_id, reason) VALUES (?,?)", args: [String(telegramId), reason || null] });
  banCache.delete(String(telegramId));
}
export async function unbanViewer(telegramId: string | number) {
  await ensure();
  await db.execute({ sql: "DELETE FROM viewer_bans WHERE telegram_id=?", args: [String(telegramId)] });
  banCache.delete(String(telegramId));
}
export async function listBans() {
  await ensure();
  return (await db.execute(`SELECT b.telegram_id, b.reason, b.banned_at, u.username, u.first_name FROM viewer_bans b LEFT JOIN users u ON u.telegram_id = b.telegram_id ORDER BY b.banned_at DESC LIMIT 200`)).rows as any[];
}
/** Look a viewer up by numeric id or @username among those who have used the bot. */
export async function findViewer(raw: string): Promise<{ telegram_id: string; username: string | null; first_name: string | null } | null> {
  const ref = parseViewerRef(raw);
  if (!ref) return null;
  const r = ref.id
    ? (await db.execute({ sql: "SELECT telegram_id, username, first_name FROM users WHERE telegram_id=?", args: [ref.id] })).rows[0]
    : (await db.execute({ sql: "SELECT telegram_id, username, first_name FROM users WHERE LOWER(username)=LOWER(?)", args: [ref.username!] })).rows[0];
  if (r) return r as any;
  return ref.id ? { telegram_id: ref.id, username: null, first_name: null } : null;
}

// ── daily cap ──────────────────────────────────────────────────────────────
export async function getDailyCap(): Promise<number> {
  const v = Number(await getSetting("abuse.dailyCap"));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
export async function setDailyCap(n: number) { await setSetting("abuse.dailyCap", String(Math.max(0, Math.floor(n) || 0))); }

/** Reserve one delivery for today. ok=false when the viewer has used their allowance. */
export async function takeDelivery(telegramId: string | number): Promise<{ ok: boolean; used: number; cap: number }> {
  const cap = await getDailyCap();
  if (!cap) return { ok: true, used: 0, cap: 0 };
  await ensure();
  const id = String(telegramId), day = dayKey();
  const used = Number((await db.execute({ sql: "SELECT n FROM daily_deliveries WHERE telegram_id=? AND day=?", args: [id, day] })).rows[0]?.n ?? 0);
  if (capReached(used, cap)) return { ok: false, used, cap };
  await db.execute({ sql: "INSERT INTO daily_deliveries (telegram_id, day, n) VALUES (?,?,1) ON CONFLICT(telegram_id, day) DO UPDATE SET n = n + 1", args: [id, day] });
  return { ok: true, used: used + 1, cap };
}
/** Give the allowance back when a delivery that was counted did not actually go out. */
export async function refundDelivery(telegramId: string | number) {
  await ensure();
  await db.execute({ sql: "UPDATE daily_deliveries SET n = MAX(n - 1, 0) WHERE telegram_id=? AND day=?", args: [String(telegramId), dayKey()] });
}
export async function moderationStats() {
  await ensure();
  const today = Number((await db.execute({ sql: "SELECT COALESCE(SUM(n),0) AS t FROM daily_deliveries WHERE day=?", args: [dayKey()] })).rows[0]?.t ?? 0);
  const top = (await db.execute({ sql: "SELECT d.telegram_id, d.n, u.username, u.first_name FROM daily_deliveries d LEFT JOIN users u ON u.telegram_id=d.telegram_id WHERE d.day=? ORDER BY d.n DESC LIMIT 5", args: [dayKey()] })).rows as any[];
  return { deliveriesToday: today, top };
}

// ── takedown ───────────────────────────────────────────────────────────────
export interface TakedownResult { removedFiles: number; vaultMessagesDeleted: number; vaultErrors: number; cancelledJobs: number; pausedWishes: number; blockId: number | null }

/** Best-effort delete of the stored copies in the vault channels (needs the userbot to be signed in and allowed to delete). */
async function deleteVaultCopies(files: any[]): Promise<{ deleted: number; errors: number }> {
  const byChannel = new Map<string, number[]>();
  for (const f of files) {
    const ch = String(f.telegram_channel_id || ""), id = Number(f.telegram_message_id || 0);
    if (ch && id > 0) byChannel.set(ch, [...(byChannel.get(ch) || []), id]);
  }
  if (!byChannel.size) return { deleted: 0, errors: 0 };
  let deleted = 0, errors = 0;
  try {
    const { getConnectedClient } = await import("./crawlerService.js");
    const client: any = await getConnectedClient();
    for (const [ch, ids] of byChannel) {
      try {
        const entity = await client.getEntity(/^\d+$/.test(ch) ? `-100${ch}` : ch);
        await client.deleteMessages(entity, ids, { revoke: true });
        deleted += ids.length;
      } catch { errors += ids.length; }
    }
  } catch { errors += [...byChannel.values()].reduce((n, a) => n + a.length, 0); }
  return { deleted, errors };
}

export async function takedownTitle(opts: { title: string; year?: string | null; reason?: string }): Promise<TakedownResult> {
  await ensure();
  const key = titleKey(opts.title);
  const entry = [{ id: 0, kind: "title", title_key: key, year: opts.year || null }];
  const files = ((await db.execute("SELECT * FROM media_files")).rows as any[]).filter((f) => matchTitle(entry, String(f.movie_title || ""), f.year ? String(f.year) : null));
  const vault = await deleteVaultCopies(files);
  for (const f of files) await deleteMediaFile(Number(f.id));

  const blockId = await blockTitle(opts.title, opts.year || null, opts.reason);

  let cancelledJobs = 0;
  const queued = (await db.execute("SELECT id, title, year FROM crawl_jobs WHERE status='queued'").catch(() => ({ rows: [] as any[] }))).rows as any[];
  for (const j of queued) {
    if (matchTitle(entry, String(j.title), j.year ? String(j.year) : null)) {
      await db.execute({ sql: "UPDATE crawl_jobs SET status='failed', error='taken down', finished_at=CURRENT_TIMESTAMP WHERE id=?", args: [j.id] });
      cancelledJobs++;
    }
  }
  let pausedWishes = 0;
  const wishes = (await db.execute("SELECT id, title, year FROM series_wishlist WHERE status != 'paused'").catch(() => ({ rows: [] as any[] }))).rows as any[];
  for (const w of wishes) {
    if (matchTitle(entry, String(w.title), w.year ? String(w.year) : null)) {
      await db.execute({ sql: "UPDATE series_wishlist SET status='paused', note='taken down' WHERE id=?", args: [w.id] });
      pausedWishes++;
    }
  }
  return { removedFiles: files.length, vaultMessagesDeleted: vault.deleted, vaultErrors: vault.errors, cancelledJobs, pausedWishes, blockId };
}
