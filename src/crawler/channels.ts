/**
 * Source channels: live watching + one-off backfill, through ONE ingest path.
 *
 *  - A NewMessage listener on the userbot sees uploads as they are posted (no polling).
 *  - On start / reconnect it catches up on posts it missed while it was offline (bounded).
 *  - Every post goes through `judgePost` (video, size, 1080p/720p only, no samples/clips, readable title),
 *    a duplicate check (same title + quality, or the exact same file) and then forwards to the right
 *    vault (movies or series) with the vault message id confirmed before anything is indexed.
 *  - `channel_ingest` remembers what happened to each post, so re-running a backfill never repeats work.
 */
import { NewMessage } from "telegram/events/NewMessage.js";
import { db, addMediaFile, mediaWriteVersion } from "../db/index.js";
import { getConnectedClient, requireVaultChannelId, logActivity } from "../services/crawlerService.js";
import { forwardToVault } from "./vault.js";
import { Pacer, tg } from "./flood.js";
import { whyBlocked } from "./blocklist.js";
import { alreadyHave, judgePost, type ChannelPost, type HeldRow } from "./ingest.js";
import { mediaOf } from "./gramTransport.js";

interface Target {
  id: number; channel_identifier: string; title: string; status: string;
  min_file_size_mb: number; quality_filter: string; last_seen_id?: number | null;
}

let tablesReady = false;
async function ensureTables() {
  if (tablesReady) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS channel_ingest (
    target_id INTEGER NOT NULL, msg_id INTEGER NOT NULL, status TEXT NOT NULL, reason TEXT, title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (target_id, msg_id)
  )`);
  try { await db.execute("ALTER TABLE crawler_targets ADD COLUMN last_seen_id INTEGER"); } catch { /* exists */ }
  tablesReady = true;
}

// One ingest at a time: live posts, catch-up and a manual backfill never race each other.
let chain: Promise<unknown> = Promise.resolve();
const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
};
const pacer = new Pacer(1500);

const entityCache = new Map<string, any>();
async function entityFor(client: any, id: string) {
  let e = entityCache.get(id);
  if (!e) { e = await client.getEntity(id); entityCache.set(id, e); }
  return e;
}

export function postOf(m: any): ChannelPost | null {
  const media = mediaOf(m);
  if (!media) return null;
  return {
    msgId: Number(m.id),
    caption: m.message || "",
    fileName: media.fileName,
    size: Number(media.size || 0),
    mime: media.mime,
    isVideo: media.isVideo,
    durationSec: media.durationSec,
    width: media.width,
    height: media.height,
  };
}

export interface IngestResult { status: "saved" | "skipped" | "failed" | "ignored"; reason?: string; title?: string }

async function record(targetId: number, msgId: number, status: string, reason?: string, title?: string) {
  await db.execute({
    sql: "INSERT INTO channel_ingest (target_id, msg_id, status, reason, title) VALUES (?,?,?,?,?) ON CONFLICT(target_id,msg_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, title=excluded.title, created_at=CURRENT_TIMESTAMP",
    args: [targetId, msgId, status, reason ?? null, title ?? null],
  });
}
async function bumpSeen(targetId: number, msgId: number) {
  await db.execute({ sql: "UPDATE crawler_targets SET last_seen_id = MAX(COALESCE(last_seen_id,0), ?) WHERE id = ?", args: [msgId, targetId] });
}

// The "do we already have this?" list is kept in memory and reloaded only when the library changes. Reading the whole
// table for every channel post would cost (library size x posts) database reads, which adds up fast on Turso.
let heldCache: { rows: HeldRow[]; version: number } | null = null;
async function heldRows(): Promise<HeldRow[]> {
  if (heldCache && heldCache.version === mediaWriteVersion()) return heldCache.rows;
  const version = mediaWriteVersion();
  const rows = (await db.execute("SELECT movie_title, year, quality, season, episode, file_name, file_size FROM media_files")).rows as unknown as HeldRow[];
  heldCache = { rows, version };
  return rows;
}
/** After our own insert (the only write since the list was loaded), add it to the list instead of reloading everything. */
function noteSaved(versionBefore: number, row: HeldRow) {
  if (heldCache && heldCache.version === versionBefore && mediaWriteVersion() === versionBefore + 1) { heldCache.rows.push(row); heldCache.version = versionBefore + 1; }
}

export async function ingestPost(client: any, target: any, source: any, m: any): Promise<IngestResult> {
  await ensureTables();
  const post = postOf(m);
  if (!post) return { status: "ignored" };
  const done = (await db.execute({ sql: "SELECT status FROM channel_ingest WHERE target_id=? AND msg_id=?", args: [target.id, post.msgId] })).rows[0] as any;
  if (done && done.status !== "failed") { await bumpSeen(target.id, post.msgId); return { status: "ignored" }; }

  const v = judgePost(post, target);
  if (v.ok === false) {
    if (v.code === "not_video") return { status: "ignored" };
    await record(target.id, post.msgId, "skipped", v.reason, post.fileName);
    await bumpSeen(target.id, post.msgId);
    return { status: "skipped", reason: v.reason };
  }

  const barred = await whyBlocked({ title: v.title, year: v.year, fileName: v.fileName, size: post.size });
  if (barred) {
    await record(target.id, post.msgId, "skipped", barred, v.title);
    await bumpSeen(target.id, post.msgId);
    return { status: "skipped", reason: barred, title: v.title };
  }

  const held = await heldRows();
  const dup = alreadyHave(v, post.size, held);
  if (dup) {
    await record(target.id, post.msgId, "skipped", dup, v.title);
    await bumpSeen(target.id, post.msgId);
    return { status: "skipped", reason: dup, title: v.title };
  }

  try {
    const vaultId = await requireVaultChannelId(v.isSeries);
    if (!vaultId) throw new Error("no vault channel is set");
    const vault = await entityFor(client, vaultId);
    const copy = await forwardToVault(client, source, vault, post.msgId, post.size);
    const slug = v.title.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const versionBefore = mediaWriteVersion();
    await addMediaFile({
      movie_id: v.isSeries ? `tg_series_${slug}_s${v.season}_e${v.episode}` : `tg_${slug}_${v.year || "x"}`,
      movie_title: v.title,
      year: v.year,
      telegram_file_id: String(copy.vaultMsgId),
      telegram_channel_id: vaultId,
      telegram_message_id: String(copy.vaultMsgId),
      file_name: v.fileName,
      file_size: post.size,
      quality: v.quality,
      language: "English",
      mime_type: post.mime || "video/mp4",
      season: v.season,
      episode: v.episode,
    } as any);
    noteSaved(versionBefore, { movie_title: v.title, year: v.year, quality: v.quality, season: v.season, episode: v.episode, file_name: v.fileName, file_size: post.size });
    await record(target.id, post.msgId, "saved", undefined, v.title);
    await bumpSeen(target.id, post.msgId);
    await db.execute({ sql: "UPDATE crawler_targets SET total_files_found = total_files_found + 1, last_crawled_at = CURRENT_TIMESTAMP WHERE id = ?", args: [target.id] });
    logActivity({
      type: "vault_forward", source: target.channel_identifier,
      title: `Saved: ${v.title}${v.isSeries ? ` S${v.season}E${v.episode ?? "?"}` : v.year ? ` (${v.year})` : ""} · ${v.quality}`,
      details: `from ${target.title} → ${v.isSeries ? "series" : "movies"} vault`, status: "success",
    } as any);
    return { status: "saved", title: v.title };
  } catch (e: any) {
    await record(target.id, post.msgId, "failed", e?.message, v.title).catch(() => undefined);
    logActivity({ type: "vault_forward", source: target.channel_identifier, title: `Could not save ${v.title}`, details: e?.message || "", status: "error" } as any);
    return { status: "failed", reason: e?.message, title: v.title };
  }
}

// ── live watching ──────────────────────────────────────────────────────────
interface Watch { target: Target; entity: any; peer: string; error?: string }
const watches = new Map<number, Watch>();
const errors = new Map<number, string>();
let watchedClient: any = null;
let handler: ((ev: any) => Promise<void>) | null = null;
const live: Array<{ targetId: number; msg: any }> = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (live.length) {
      const { targetId, msg } = live.shift()!;
      const fresh = (await db.execute({ sql: "SELECT * FROM crawler_targets WHERE id = ?", args: [targetId] })).rows[0] as unknown as Target | undefined;
      const w = watches.get(targetId);
      if (!fresh || fresh.status === "paused" || !w) continue;
      await exclusive(async () => {
        const client = watchedClient;
        if (!client) return;
        const r = await ingestPost(client, fresh, w.entity, msg).catch((e) => ({ status: "failed", reason: e?.message }) as IngestResult);
        if (r.status === "saved") await pacer.wait();
      });
    }
  } finally { draining = false; }
}

const peerKey = (p: any) => String(p?.channelId ?? p?.chatId ?? p?.userId ?? "");

export async function reconcileWatchers(): Promise<void> {
  await ensureTables();
  const client: any = await getConnectedClient();
  if (!client) { watchedClient = null; watches.clear(); return; }

  if (client !== watchedClient) {
    if (watchedClient && handler) { try { watchedClient.removeEventHandler(handler, new NewMessage({})); } catch { /* old client gone */ } }
    watchedClient = client;
    entityCache.clear();
    watches.clear();
    handler = async (ev: any) => {
      const m = ev?.message;
      if (!m?.media) return;
      const key = peerKey(m.peerId);
      for (const w of watches.values()) if (w.peer === key) { live.push({ targetId: w.target.id, msg: m }); void drain(); break; }
    };
    client.addEventHandler(handler, new NewMessage({}));
  }

  const targets = (await db.execute("SELECT * FROM crawler_targets ORDER BY id")).rows as unknown as Target[];
  const wanted = new Set(targets.filter((t) => t.status !== "paused").map((t) => t.id));
  for (const id of [...watches.keys()]) if (!wanted.has(id)) watches.delete(id);

  for (const t of targets) {
    if (t.status === "paused") { errors.delete(t.id); continue; }
    const have = watches.get(t.id);
    if (have) { have.target = t; continue; }
    try {
      const entity: any = await tg<any>(() => client.getEntity(t.channel_identifier));
      watches.set(t.id, { target: t, entity, peer: String(entity.id) });
      errors.delete(t.id);
      await catchUp(client, t, entity);
    } catch (e: any) {
      errors.set(t.id, /CHANNEL_PRIVATE|not.*join|USERNAME_NOT_OCCUPIED|Cannot find any entity/i.test(e?.message || "") ? "The userbot can't open this channel. Is it a member?" : e?.message || "could not open");
    }
  }
}

/** First time we see a channel: start from "now". After a restart: process what we missed (bounded). */
async function catchUp(client: any, t: Target, entity: any) {
  if (!t.last_seen_id) {
    const latest: any[] = await tg<any>(() => client.getMessages(entity, { limit: 1 }));
    await bumpSeen(t.id, Number(latest?.[0]?.id || 0));
    return;
  }
  const missed: any[] = await tg<any>(() => client.getMessages(entity, { limit: 200, minId: Number(t.last_seen_id) }));
  const ordered = [...missed].reverse();
  for (const m of ordered) if (m?.media) live.push({ targetId: t.id, msg: m });
  if (ordered.length) { logActivity({ type: "channel_crawl", source: t.channel_identifier, title: `Catching up on ${ordered.length} posts from while the userbot was away`, details: t.title, status: "success" } as any); void drain(); }
}

export function watcherState(): Record<number, { live: boolean; error?: string }> {
  const out: Record<number, { live: boolean; error?: string }> = {};
  for (const id of watches.keys()) out[id] = { live: !!watchedClient };
  for (const [id, e] of errors) out[id] = { live: false, error: e };
  return out;
}

let timer: NodeJS.Timeout | null = null;
let debounce: NodeJS.Timeout | null = null;
export function startChannelWatcher() {
  if (timer) return;
  const run = () => reconcileWatchers().catch((e) => console.warn("[channels] reconcile failed:", e?.message));
  setTimeout(run, 15_000);
  timer = setInterval(run, 5 * 60_000);
  (timer as any).unref?.();
}
/** Call after a channel is added/changed/removed or the userbot signs in. */
export function scheduleReconcile() {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => reconcileWatchers().catch(() => undefined), 1500);
}

// ── stats for the admin ────────────────────────────────────────────────────
export async function targetStats(): Promise<Record<number, { saved: number; skipped: number; failed: number; reasons: Array<{ reason: string; n: number }> }>> {
  await ensureTables();
  const out: Record<number, any> = {};
  const rows = (await db.execute("SELECT target_id, status, COUNT(*) n FROM channel_ingest GROUP BY target_id, status")).rows as any[];
  for (const r of rows) (out[r.target_id] ||= { saved: 0, skipped: 0, failed: 0, reasons: [] })[r.status as "saved"] = Number(r.n);
  const why = (await db.execute("SELECT target_id, reason, COUNT(*) n FROM channel_ingest WHERE status='skipped' AND reason IS NOT NULL GROUP BY target_id, reason ORDER BY n DESC")).rows as any[];
  for (const r of why) { const o = (out[r.target_id] ||= { saved: 0, skipped: 0, failed: 0, reasons: [] }); if (o.reasons.length < 4) o.reasons.push({ reason: String(r.reason), n: Number(r.n) }); }
  return out;
}

// ── manual backfill ────────────────────────────────────────────────────────
export async function backfillTarget(targetId: number, limit: number): Promise<{ scanned: number; ingested: number; filtered: number; titlesFound: string[]; skipped: Record<string, number> }> {
  await ensureTables();
  const t = (await db.execute({ sql: "SELECT * FROM crawler_targets WHERE id = ?", args: [targetId] })).rows[0] as unknown as Target | undefined;
  if (!t) throw new Error("Channel not found");
  const client: any = await getConnectedClient();
  if (!client) throw new Error("The userbot isn't signed in. Sign in under Connections first.");
  const previous = t.status === "paused" ? "paused" : "active";
  await db.execute({ sql: "UPDATE crawler_targets SET status='syncing' WHERE id=?", args: [targetId] });
  const res = { scanned: 0, ingested: 0, filtered: 0, titlesFound: [] as string[], skipped: {} as Record<string, number> };
  try {
    const entity: any = await tg<any>(() => client.getEntity(t.channel_identifier));
    const msgs: any[] = await tg<any>(() => client.getMessages(entity, { limit }), 60);
    const ordered = [...msgs].reverse(); // oldest first, so episodes arrive in order
    for (const m of ordered) {
      res.scanned++;
      const r = await exclusive(() => ingestPost(client, t, entity, m));
      if (r.status === "saved") { res.ingested++; if (r.title) res.titlesFound.push(r.title); await pacer.wait(); }
      else if (r.status === "skipped") { res.filtered++; const k = r.reason || "skipped"; res.skipped[k] = (res.skipped[k] || 0) + 1; }
    }
  } finally {
    await db.execute({ sql: "UPDATE crawler_targets SET status=?, last_crawled_at=CURRENT_TIMESTAMP WHERE id=?", args: [previous, targetId] });
  }
  return res;
}
