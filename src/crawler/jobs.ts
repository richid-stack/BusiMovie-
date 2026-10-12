/**
 * Crawl jobs: one durable queue for everything that needs a file fetched from the external bots
 * (a viewer's request, an admin click, a CSV/cron batch). Persisted in the main database so a
 * restart never loses work, and traces are kept for a week so "why did it fail" is answerable.
 */
import { db } from "../db/index.js";
import { EventEmitter } from "node:events";
import type { TraceStep } from "./navigator.js";

export type JobKind = "movie" | "episode" | "season";
export type JobStatus = "queued" | "running" | "done" | "not_found" | "failed" | "needs_admin";
export const OPEN_STATUSES: JobStatus[] = ["queued", "running"];
export const PRIORITY = { user: 0, admin: 1, cron: 2 } as const;

export interface CrawlJob {
  id: number;
  kind: JobKind;
  title: string;
  year: string | null;
  season: number | null;
  episode: number | null;
  quality: string | null;
  priority: number;
  status: JobStatus;
  source: string;
  requested_by: string | null;
  attempts: number;
  result_json: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(200);

export async function ensureCrawlerTables(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS crawl_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      year TEXT,
      season INTEGER,
      episode INTEGER,
      quality TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      source TEXT NOT NULL DEFAULT 'user',
      requested_by TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      result_json TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      finished_at DATETIME
    )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status ON crawl_jobs(status, priority, id)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS crawl_traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      bot TEXT NOT NULL,
      outcome TEXT NOT NULL,
      detail TEXT,
      trace_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_crawl_traces_job ON crawl_traces(job_id)`);
  try { await db.execute(`ALTER TABLE search_bots ADD COLUMN profile TEXT`); } catch { /* exists */ }
  await resetInterruptedJobs();
  await purgeOldTraces();
}

/** After a crash/restart anything 'running' never finished; put it back in line. */
export async function resetInterruptedJobs(): Promise<void> {
  await db.execute(`UPDATE crawl_jobs SET status='queued' WHERE status='running'`);
}

export async function purgeOldTraces(days = 7): Promise<void> {
  await db.execute({ sql: `DELETE FROM crawl_traces WHERE created_at < datetime('now', ?)`, args: [`-${days} days`] });
}

export interface NewJob {
  kind: JobKind;
  title: string;
  year?: string | null;
  season?: number | null;
  episode?: number | null;
  quality?: string | null;
  priority?: number;
  source?: string;
  requestedBy?: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Ten people asking for the same thing share one job. */
export async function enqueueJob(j: NewJob): Promise<{ id: number; existing: boolean }> {
  const open = (await db.execute({
    sql: `SELECT * FROM crawl_jobs WHERE status IN ('queued','running') AND kind = ?`,
    args: [j.kind],
  })).rows as unknown as CrawlJob[];
  const hit = open.find(
    (o) => norm(o.title) === norm(j.title) && (o.year ?? "") === (j.year ?? "") && (o.season ?? null) === (j.season ?? null) && (o.episode ?? null) === (j.episode ?? null)
      // a second-quality (companion) job is its own thing: never merged with a viewer's request
      && (o.source === "companion") === (j.source === "companion")
      && (o.source !== "companion" || (o.quality ?? "") === (j.quality ?? ""))
  );
  if (hit) {
    const wanted = j.priority ?? PRIORITY.user;
    if (wanted < hit.priority && hit.status === "queued") await db.execute({ sql: `UPDATE crawl_jobs SET priority=? WHERE id=?`, args: [wanted, hit.id] });
    return { id: Number(hit.id), existing: true };
  }
  const r = await db.execute({
    sql: `INSERT INTO crawl_jobs (kind,title,year,season,episode,quality,priority,source,requested_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [j.kind, j.title, j.year ?? null, j.season ?? null, j.episode ?? null, j.quality ?? null, j.priority ?? PRIORITY.user, j.source ?? "user", j.requestedBy ?? null],
  });
  return { id: Number(r.lastInsertRowid), existing: false };
}

export async function getJob(id: number): Promise<CrawlJob | null> {
  const r = await db.execute({ sql: `SELECT * FROM crawl_jobs WHERE id=?`, args: [id] });
  return (r.rows[0] as unknown as CrawlJob) ?? null;
}

/** Highest priority first, then oldest. Only one worker runs, so a plain select+update is safe. */
export async function claimNextJob(): Promise<CrawlJob | null> {
  const r = await db.execute(`SELECT * FROM crawl_jobs WHERE status='queued' ORDER BY priority ASC, id ASC LIMIT 1`);
  const job = r.rows[0] as unknown as CrawlJob | undefined;
  if (!job) return null;
  const u = await db.execute({ sql: `UPDATE crawl_jobs SET status='running', started_at=CURRENT_TIMESTAMP, attempts=attempts+1 WHERE id=? AND status='queued'`, args: [job.id] });
  if (!u.rowsAffected) return null;
  return getJob(Number(job.id));
}

export async function finishJob(id: number, status: Exclude<JobStatus, "queued" | "running">, result?: unknown, error?: string): Promise<void> {
  await db.execute({
    sql: `UPDATE crawl_jobs SET status=?, result_json=?, error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?`,
    args: [status, result === undefined ? null : JSON.stringify(result), error ?? null, id],
  });
  jobEvents.emit(`done:${id}`, await getJob(id));
}

export async function saveTrace(jobId: number, bot: string, outcome: string, detail: string | undefined, trace: TraceStep[]): Promise<void> {
  await db.execute({ sql: `INSERT INTO crawl_traces (job_id,bot,outcome,detail,trace_json) VALUES (?,?,?,?,?)`, args: [jobId, bot, outcome, detail ?? null, JSON.stringify(trace)] });
}

export async function getTraces(jobId: number) {
  const r = await db.execute({ sql: `SELECT id,bot,outcome,detail,trace_json,created_at FROM crawl_traces WHERE job_id=? ORDER BY id`, args: [jobId] });
  return r.rows.map((x: any) => ({ ...x, trace: JSON.parse(x.trace_json || "[]") }));
}

export async function listJobs(limit = 50, status?: JobStatus): Promise<CrawlJob[]> {
  const r = status
    ? await db.execute({ sql: `SELECT * FROM crawl_jobs WHERE status=? ORDER BY id DESC LIMIT ?`, args: [status, limit] })
    : await db.execute({ sql: `SELECT * FROM crawl_jobs ORDER BY id DESC LIMIT ?`, args: [limit] });
  return r.rows as unknown as CrawlJob[];
}

/** Resolve when the job finishes (or null on timeout). Works without polling. */
export function waitForJob(id: number, timeoutMs: number): Promise<CrawlJob | null> {
  return new Promise(async (resolve) => {
    const j = await getJob(id);
    if (j && !OPEN_STATUSES.includes(j.status)) return resolve(j);
    const t = setTimeout(() => { jobEvents.off(`done:${id}`, on); resolve(null); }, timeoutMs);
    const on = (job: CrawlJob) => { clearTimeout(t); resolve(job); };
    jobEvents.once(`done:${id}`, on);
  });
}
