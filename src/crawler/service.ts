/**
 * Wiring: the real Telegram session, the vault, the database and the single background worker.
 * Everything the bot, the server and the cron indexer use to get a file goes through here.
 */
import { db, addMediaFile, getSeriesSeasonEpisodes } from "../db/index.js";
import { getConnectedClient, getEffectiveVaultChannelId, logActivity } from "../services/crawlerService.js";
import { parseMediaTitleAndSeriesInfo } from "../services/seriesParser.js";
import { GramTransport } from "./gramTransport.js";
import { forwardToVault } from "./vault.js";
import { verifyDownloadedFile } from "./verify.js";
import { geminiAdvisor } from "./geminiAdvisor.js";
import { runJob, BotProfile, EngineDeps, JobOutcome, commandFor } from "./engine.js";
import { browseEpisodes, browseSeasons, cachedEpisodes, cachedSeasons, ensureBlueprintTable } from "./browse.js";
import { withBotLock } from "./lock.js";
import {
  claimNextJob, enqueueJob, ensureCrawlerTables, finishJob, getJob, jobEvents, waitForJob, CrawlJob, NewJob, PRIORITY,
} from "./jobs.js";
import type { Screen } from "./screen.js";

const sessions = new Map<string, { client: any; botEntity: any; transport: GramTransport }>();
const handleOf = (h: string) => (h.startsWith("@") ? h : `@${h}`);

export async function loadBots(): Promise<BotProfile[]> {
  const rows = (await db.execute("SELECT * FROM search_bots WHERE status = 'active' ORDER BY priority ASC, id ASC")).rows as any[];
  return rows.map((r) => {
    let profile: any = {};
    try { profile = r.profile ? JSON.parse(r.profile) : {}; } catch { /* bad JSON → defaults */ }
    const handle = handleOf(String(r.bot_username));
    const scope: BotProfile["scope"] = profile.scope || (/quinson/i.test(handle) ? "series" : "movie");
    return { handle, scope, commandTemplate: String(r.command_template || "{query}") };
  });
}

async function openSession(handle: string) {
  const client = await getConnectedClient();
  if (!client) return null;
  const botEntity = await client.getEntity(handleOf(handle));
  const transport = new GramTransport(client, botEntity);
  transport.start();
  sessions.set(handle.toLowerCase(), { client, botEntity, transport });
  return { transport, close: async () => { transport.stop(); sessions.delete(handle.toLowerCase()); } };
}

async function acquire(media: Screen, job: CrawlJob, botHandle: string, episode?: number) {
  const s = sessions.get(botHandle.toLowerCase());
  if (!s) throw new Error("conversation closed before the file could be stored");
  const isSeries = job.kind !== "movie";
  if (isSeries && job.season != null && episode != null) {
    const held = (await getSeriesSeasonEpisodes(job.title, job.season)).find((f) => Number(f.episode) === episode);
    if (held) return { mediaFileId: Number(held.id), vaultMsgId: Number(held.telegram_message_id || 0), fileName: String(held.file_name || "") };
  }
  const vaultId = await getEffectiveVaultChannelId(isSeries);
  const vault = await s.client.getEntity(vaultId);
  const copy = await forwardToVault(s.client, s.botEntity, vault, media.msgId, media.media?.size);

  const fileName = media.media?.fileName || copy.fileName || "";
  const parsed = parseMediaTitleAndSeriesInfo(fileName || media.text || "");
  const v = verifyDownloadedFile({ title: job.title, year: job.year ?? undefined, season: job.season ?? undefined, episode: episode }, fileName, media.text);
  // Trust the file's own name only when it is comparable to the request; otherwise use what was asked for.
  const title = v.verified ? parsed.cleanTitle || job.title : job.title;
  const year = (v.verified ? parsed.year : "") || job.year || "";
  const season = isSeries ? job.season ?? parsed.season ?? null : null;
  const ep = isSeries ? episode ?? parsed.episode ?? job.episode ?? null : null;
  const slug = title.toLowerCase().replace(/[^a-z0-9]/g, "_");

  const mediaFileId = await addMediaFile({
    movie_id: isSeries ? `tg_series_${slug}_s${season}_e${ep}` : `tg_${slug}_${year || "x"}`,
    movie_title: title,
    year,
    telegram_file_id: String(copy.vaultMsgId),
    telegram_channel_id: vaultId,
    telegram_message_id: String(copy.vaultMsgId),
    file_name: fileName || `${title}.mkv`,
    file_size: Number(media.media?.size || copy.size || 0),
    quality: parsed.quality || job.quality || "1080p",
    language: "English",
    mime_type: media.media?.mime || "video/mp4",
    season,
    episode: ep,
  } as any);

  logActivity({ type: "vault_forward", source: botHandle, title: `Stored: ${title}${season ? ` S${season}E${ep ?? "?"}` : ""}`, details: `from ${botHandle} → vault message ${copy.vaultMsgId}`, status: "success" } as any);
  return { mediaFileId, vaultMsgId: copy.vaultMsgId, fileName };
}

// ── notifications / bookkeeping after a job finishes ───────────────────────
type Notifier = (job: CrawlJob, outcome: JobOutcome) => void | Promise<void>;
let notifier: Notifier | null = null;
export function setJobNotifier(fn: Notifier) { notifier = fn; }

type ProgressHook = (job: CrawlJob, count: number) => void | Promise<void>;
let progressHook: ProgressHook | null = null;
export function setProgressHook(fn: ProgressHook) { progressHook = fn; }

const engineDeps: EngineDeps = {
  bots: loadBots,
  open: openSession,
  acquire,
  advisor: geminiAdvisor,
  onProgress: async (job, eps) => { await progressHook?.(job, eps.length); },
};

async function process1(job: CrawlJob) {
  let outcome: JobOutcome;
  try {
    outcome = await runJob(job, engineDeps);
  } catch (e: any) {
    outcome = { status: "failed", error: e?.message || "unexpected error" };
  }
  await finishJob(job.id, outcome.status, outcome.result, outcome.error);
  await Promise.resolve(notifier?.(job, outcome)).catch((e) => console.warn("[crawler] notifier failed:", e?.message));
}

let running = false;
let stopped = false;
let wake: (() => void) | null = null;

async function workerLoop() {
  if (running) return;
  running = true;
  while (!stopped) {
    let job: CrawlJob | null = null;
    try { job = await claimNextJob(); } catch (e: any) { console.warn("[crawler] claim failed:", e?.message); }
    if (!job) {
      await new Promise<void>((r) => { wake = r; setTimeout(r, 5000); });
      continue;
    }
    await process1(job);
  }
  running = false;
}

export async function startCrawlWorker() {
  await ensureCrawlerTables();
  await ensureBlueprintTable();
  await db.execute("UPDATE requests SET status = 'pending' WHERE status = 'waiting'"); // waiters from before a restart
  stopped = false;
  void workerLoop();
}
export function stopCrawlWorker() { stopped = true; wake?.(); }

export async function submitJob(j: NewJob): Promise<{ id: number; existing: boolean }> {
  const r = await enqueueJob(j);
  wake?.();
  return r;
}

/** Ask for a file and wait (up to `waitMs`) for the outcome. null = still working; the job keeps running. */
export async function requestAndWait(j: NewJob, waitMs = 90_000): Promise<{ id: number; job: CrawlJob | null }> {
  const { id } = await submitJob(j);
  return { id, job: await waitForJob(id, waitMs) };
}

// ── browsing (used by the bot's season/episode pickers) ───────────────────
async function withSeriesSession<T>(fn: (t: GramTransport, command: string) => Promise<T>): Promise<T | null> {
  const bots = (await loadBots()).filter((b) => b.scope === "series" || b.scope === "both");
  const bot = bots[0];
  if (!bot) return null;
  return withBotLock(bot.handle, async () => {
    const s = await openSession(bot.handle);
    if (!s) return null;
    try { return await fn(s.transport as GramTransport, bot.commandTemplate); } finally { await s.close(); }
  });
}

export async function listSeasons(title: string, force = false): Promise<number[]> {
  if (!force) { const c = await cachedSeasons(title); if (c?.length) return c; }
  const r = await withSeriesSession((t, tpl) => browseSeasons(t, title, commandFor({ handle: "", scope: "series", commandTemplate: tpl }, title), { force }));
  return r ?? [];
}
export async function listEpisodes(title: string, season: number, force = false): Promise<number[]> {
  if (!force) { const c = await cachedEpisodes(title, season); if (c?.length) return c; }
  const r = await withSeriesSession((t, tpl) => browseEpisodes(t, title, season, commandFor({ handle: "", scope: "series", commandTemplate: tpl }, title), { force }));
  return r ?? [];
}

export { PRIORITY, getJob, jobEvents };

/** Admin/manual "fetch this title now": same engine, admin priority, waits for the answer. */
export async function fetchNow(title: string, requestedBy?: string, waitMs = 120_000): Promise<{ success: boolean; jobId: number; title: string; message: string; mediaFileId?: number }> {
  const parsed = parseMediaTitleAndSeriesInfo(title);
  const { id, job } = await requestAndWait(
    { kind: "movie", title: parsed.cleanTitle || title, year: parsed.year || null, priority: PRIORITY.admin, source: "admin", requestedBy: requestedBy || "admin" },
    waitMs
  );
  if (!job) return { success: false, jobId: id, title, message: "Still working on it — check the crawl jobs list for the result." };
  if (job.status === "done") {
    let r: any = {};
    try { r = JSON.parse(job.result_json || "{}"); } catch { /* ignore */ }
    return { success: true, jobId: id, title, mediaFileId: r.mediaFileId, message: `Added via ${r.bot || "a search bot"}.` };
  }
  return { success: false, jobId: id, title, message: job.error || `Ended as ${job.status}.` };
}
