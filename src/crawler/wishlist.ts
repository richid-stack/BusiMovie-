/**
 * Series wishlist: "get me the whole show".
 * For each wished show the runner asks the series bot which seasons and episodes exist, compares that with what
 * the series vault already holds, and queues ONE season job at a time (lowest priority, so viewers always go first).
 * Season jobs already collect episodes as they arrive, number them from the file names and skip held ones, so a
 * crash or a partial delivery simply resumes on the next check.
 *
 * Modes:  all      – every season the bot lists, once
 *         seasons  – only the listed seasons
 *         follow   – every season, then re-check every 12h for new episodes/seasons
 */
import { db, getSeriesSeasonEpisodes } from "../db/index.js";
import { parseMediaTitleAndSeriesInfo } from "../services/seriesParser.js";
import { cachedEpisodes, cachedSeasons, ensureBlueprintTable } from "./browse.js";
import { PRIORITY } from "./jobs.js";
import { listEpisodes, listSeasons, submitJob } from "./service.js";
import { getConnectedClient } from "../services/crawlerService.js";

export type WishMode = "all" | "seasons" | "follow";
export interface Wish {
  id: number; title: string; year: string | null; mode: WishMode; seasons: string | null;
  status: "active" | "paused" | "done"; next_check_at: number; fail_count: number; note: string | null; created_at: string;
}

const HOUR = 3_600_000;

// ── pure helpers (unit-tested) ─────────────────────────────────────────────
/** "Severance S2", "Show S01-S03", "Show (series)", "series: Show", "Show complete series" → a wish, or null for a normal movie line. */
export function parseSeriesLine(line: string): { title: string; mode: WishMode; seasons: number[] | null } | null {
  let t = line.trim();
  if (!t) return null;
  let marked = false;
  const prefix = t.match(/^(?:series|tv|show)\s*[:\-]\s*(.+)$/i);
  if (prefix) { t = prefix[1].trim(); marked = true; }
  const suffix = t.match(/^(.*?)\s*[\(\[]\s*(?:tv\s*)?series\s*[\)\]]\s*$/i);
  if (suffix) { t = suffix[1].trim(); marked = true; }
  const complete = t.match(/^(.*?)\s*[-–,]?\s*(?:complete\s+series|all\s+seasons|full\s+series)\s*$/i);
  if (complete) { t = complete[1].trim(); marked = true; }

  let seasons: number[] | null = null;
  const range = t.match(/^(.*?)\s+S(\d{1,2})\s*[-–]\s*S?(\d{1,2})\b.*$/i);
  const word = t.match(/^(.*?)\s+seasons?\s*(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?\b.*$/i);
  const single = t.match(/^(.*?)\s+S(\d{1,2})(?:E\d{1,3})?\b.*$/i);
  const m = range || word || single;
  if (m) {
    const a = Number(m[2]);
    const b = m[3] ? Number(m[3]) : a;
    if (a >= 1 && b >= a && b - a < 40) {
      seasons = Array.from({ length: b - a + 1 }, (_, i) => a + i);
      t = m[1].trim();
      marked = true;
    }
  }
  if (!marked) return null;
  const parsed = parseMediaTitleAndSeriesInfo(t);
  const title = (parsed.cleanTitle || t).trim();
  if (title.length < 2) return null;
  return { title, mode: seasons ? "seasons" : "all", seasons };
}

export interface SeasonHistory { attempts24h: number; lastFailedAt?: number }
/** What is still missing in a season, and whether we should leave it alone for now. */
export function seasonGap(offered: number[], held: number[], hist: SeasonHistory, now: number): { missing: number[]; blocked?: string } {
  const have = new Set(held);
  const missing = offered.filter((n) => !have.has(n));
  if (!missing.length) return { missing };
  if (hist.attempts24h >= 3) return { missing, blocked: "tried 3 times today" };
  if (hist.lastFailedAt && now - hist.lastFailedAt < 6 * HOUR) return { missing, blocked: "the bot couldn't deliver it a moment ago" };
  return { missing };
}

// ── storage ────────────────────────────────────────────────────────────────
let ready = false;
export async function ensureWishlistTable() {
  if (ready) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS series_wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, year TEXT, mode TEXT NOT NULL DEFAULT 'all', seasons TEXT,
    status TEXT NOT NULL DEFAULT 'active', next_check_at INTEGER NOT NULL DEFAULT 0, fail_count INTEGER NOT NULL DEFAULT 0,
    note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  ready = true;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function addWish(w: { title: string; year?: string | null; mode?: WishMode; seasons?: number[] | null }): Promise<{ id: number; existing: boolean }> {
  await ensureWishlistTable();
  const title = w.title.trim();
  const rows = (await db.execute("SELECT id, title, mode, seasons FROM series_wishlist")).rows as any[];
  const hit = rows.find((r) => norm(String(r.title ?? "")) === norm(title));
  const mode: WishMode = w.mode === "follow" || w.mode === "seasons" ? w.mode : "all";
  const seasons = mode === "seasons" && w.seasons?.length ? JSON.stringify([...new Set(w.seasons)].sort((a, b) => a - b)) : null;
  if (hit) {
    // asking again widens the wish rather than duplicating it
    const prevMode: WishMode = hit.mode;
    const prev: number[] = hit.seasons ? JSON.parse(hit.seasons) : [];
    let nextMode: WishMode = prevMode;
    let nextSeasons: string | null = hit.seasons ?? null;
    if (mode === "follow" || prevMode === "follow") nextMode = "follow", nextSeasons = null;
    else if (mode === "all" || prevMode === "all") nextMode = "all", nextSeasons = null;
    else nextSeasons = JSON.stringify([...new Set([...prev, ...(w.seasons || [])])].sort((a, b) => a - b));
    await db.execute({ sql: "UPDATE series_wishlist SET mode=?, seasons=?, status='active', next_check_at=0, fail_count=0 WHERE id=?", args: [nextMode, nextSeasons, Number(hit.id)] });
    scheduleTick(500);
    return { id: Number(hit.id), existing: true };
  }
  const r = await db.execute({ sql: "INSERT INTO series_wishlist (title, year, mode, seasons) VALUES (?,?,?,?)", args: [title, w.year ?? null, mode, seasons] });
  scheduleTick(500);
  return { id: Number(r.lastInsertRowid), existing: false };
}

export async function listWishes(): Promise<Array<Wish & { seasonsWanted: number[] | null; progress: Array<{ season: number; held: number; offered: number | null }>; running: boolean }>> {
  await ensureWishlistTable();
  await ensureBlueprintTable();
  const rows = (await db.execute("SELECT * FROM series_wishlist ORDER BY id DESC")).rows as unknown as Wish[];
  const open = (await db.execute("SELECT title FROM crawl_jobs WHERE source='wishlist' AND status IN ('queued','running')")).rows as any[];
  const openKeys = new Set(open.map((o) => norm(String(o.title))));
  const out = [];
  for (const w of rows) {
    const wanted: number[] | null = w.seasons ? JSON.parse(w.seasons) : null;
    const known = wanted ?? (await cachedSeasons(w.title)) ?? [];
    const progress: Array<{ season: number; held: number; offered: number | null }> = [];
    for (const s of known) {
      const offered = await cachedEpisodes(w.title, s);
      const held = new Set((await getSeriesSeasonEpisodes(w.title, s)).map((f) => Number(f.episode)).filter(Boolean));
      progress.push({ season: s, held: held.size, offered: offered ? offered.length : null });
    }
    out.push({ ...w, seasonsWanted: wanted, progress, running: openKeys.has(norm(w.title)) });
  }
  return out;
}

export async function updateWish(id: number, p: { status?: string; mode?: WishMode; seasons?: number[] | null }) {
  await ensureWishlistTable();
  if (p.status && ["active", "paused", "done"].includes(p.status)) await db.execute({ sql: "UPDATE series_wishlist SET status=?, next_check_at=0, fail_count=0 WHERE id=?", args: [p.status, id] });
  if (p.mode) await db.execute({ sql: "UPDATE series_wishlist SET mode=?, seasons=?, status='active', next_check_at=0 WHERE id=?", args: [p.mode, p.mode === "seasons" && p.seasons?.length ? JSON.stringify(p.seasons) : null, id] });
  scheduleTick(500);
}
export async function deleteWish(id: number) { await ensureWishlistTable(); await db.execute({ sql: "DELETE FROM series_wishlist WHERE id=?", args: [id] }); }
export async function runWishNow(id: number) {
  await ensureWishlistTable();
  await db.execute({ sql: "UPDATE series_wishlist SET status='active', next_check_at=0, fail_count=0 WHERE id=?", args: [id] });
  scheduleTick(300);
}

// ── runner ─────────────────────────────────────────────────────────────────
async function history(title: string, season: number, now: number): Promise<SeasonHistory> {
  const rows = (await db.execute({
    sql: "SELECT status, finished_at, created_at FROM crawl_jobs WHERE kind='season' AND source='wishlist' AND season=? AND LOWER(title)=LOWER(?) ORDER BY id DESC LIMIT 10",
    args: [season, title],
  })).rows as any[];
  const ms = (s: string) => Date.parse(String(s).replace(" ", "T") + "Z");
  const recent = rows.filter((r) => now - ms(r.created_at) < 24 * HOUR);
  const failed = rows.find((r) => ["failed", "not_found", "needs_admin"].includes(r.status) && r.finished_at);
  return { attempts24h: recent.length, lastFailedAt: failed ? ms(failed.finished_at) : undefined };
}

const set = (id: number, f: Partial<{ note: string; next: number; fail: number; status: string }>) =>
  db.execute({
    sql: "UPDATE series_wishlist SET note=COALESCE(?,note), next_check_at=COALESCE(?,next_check_at), fail_count=COALESCE(?,fail_count), status=COALESCE(?,status) WHERE id=?",
    args: [f.note ?? null, f.next ?? null, f.fail ?? null, f.status ?? null, id],
  });

async function processItem(w: Wish) {
  const now = Date.now();
  const wanted: number[] | null = w.seasons ? JSON.parse(w.seasons) : null;
  const follow = w.mode === "follow";
  const known = wanted ?? (await listSeasons(w.title, follow));
  if (!known.length) {
    if (!(await getConnectedClient())) { await set(w.id, { note: "Waiting for the userbot to connect (see Connections).", next: now + 10 * 60_000 }); return; }
    const fails = w.fail_count + 1;
    await set(w.id, { note: "The series bot doesn't list this show (yet).", next: now + 6 * HOUR, fail: fails, status: fails >= 8 ? "paused" : "active" });
    return;
  }
  const last = Math.max(...known);
  const blocked: string[] = [];
  let have = 0, total = 0;
  for (const s of [...known].sort((a, b) => a - b)) {
    const offered = await listEpisodes(w.title, s, follow && s === last);
    if (!offered.length) continue;
    const held = (await getSeriesSeasonEpisodes(w.title, s)).map((f) => Number(f.episode)).filter(Boolean);
    const gap = seasonGap(offered, held, await history(w.title, s, now), now);
    total += offered.length; have += offered.length - gap.missing.length;
    if (!gap.missing.length) continue;
    if (gap.blocked) { blocked.push(`S${s} (${gap.blocked})`); continue; }
    await submitJob({ kind: "season", title: w.title, year: w.year, season: s, priority: PRIORITY.cron, source: "wishlist" });
    await set(w.id, { note: `Fetching season ${s}: ${gap.missing.length} of ${offered.length} episodes missing`, next: now + 4 * 60_000, fail: 0 });
    return;
  }
  if (blocked.length) { await set(w.id, { note: `Waiting: ${blocked.join(", ")}`, next: now + 6 * HOUR }); return; }
  if (follow) await set(w.id, { note: `Up to date (${have} episodes). Checking again in 12 hours.`, next: now + 12 * HOUR, fail: 0 });
  else await set(w.id, { note: `Complete: ${have} of ${total} episodes in the library.`, status: "done", fail: 0 });
}

let busy = false;
export async function tick() {
  if (busy) return;
  busy = true;
  try {
    await ensureWishlistTable();
    const open = (await db.execute("SELECT 1 FROM crawl_jobs WHERE source='wishlist' AND status IN ('queued','running') LIMIT 1")).rows;
    if (open.length) return; // one show at a time
    const w = (await db.execute({ sql: "SELECT * FROM series_wishlist WHERE status='active' AND next_check_at <= ? ORDER BY next_check_at ASC, id ASC LIMIT 1", args: [Date.now()] })).rows[0] as unknown as Wish | undefined;
    if (w) await processItem(w);
  } catch (e: any) {
    console.warn("[wishlist] tick failed:", e?.message);
  } finally { busy = false; }
}

let timer: NodeJS.Timeout | null = null;
let soon: NodeJS.Timeout | null = null;
function scheduleTick(ms: number) { if (soon) clearTimeout(soon); soon = setTimeout(() => void tick(), ms); (soon as any).unref?.(); }
export function startWishlistRunner() {
  if (timer) return;
  timer = setInterval(() => void tick(), 3 * 60_000);
  (timer as any).unref?.();
  scheduleTick(30_000);
}
