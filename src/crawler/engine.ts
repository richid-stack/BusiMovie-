/**
 * The crawl engine: takes one job, tries every suitable external bot in priority order
 * (acquisition included, so a bot whose file can't be stored counts as a failed bot), and
 * records a trace per attempt. Everything outside this file is injected, so it is fully testable.
 */
import type { CrawlJob, JobStatus } from "./jobs.js";
import { saveTrace } from "./jobs.js";
import { navigate, Advisor, Goal, Transport, NavOutcome, TraceStep } from "./navigator.js";
import { collectSeason, EpisodeResult } from "./season.js";
import { withBotLock } from "./lock.js";
import type { Screen } from "./screen.js";

export interface BotProfile {
  handle: string;
  scope: "movie" | "series" | "both";
  /** e.g. "/search {query}" or "{query}" */
  commandTemplate: string;
}

export interface AcquireResult { mediaFileId: number; vaultMsgId: number; fileName?: string }

export interface EngineDeps {
  bots(): Promise<BotProfile[]>;
  open(handle: string): Promise<{ transport: Transport; close(): Promise<void> } | null>;
  /** forward → confirm vault message → index. Throw if anything cannot be confirmed. */
  acquire(media: Screen, job: CrawlJob, bot: string, episode?: number): Promise<AcquireResult>;
  advisor?: Advisor;
  /** how many episodes the series bot should deliver, when known */
  expectedEpisodes?(job: CrawlJob): Promise<number | undefined>;
  onProgress?(job: CrawlJob, episodes: EpisodeResult[]): void | Promise<void>;
  settleMs?: number;
}

export interface JobOutcome {
  status: Exclude<JobStatus, "queued" | "running">;
  result?: { bot: string; mediaFileId?: number; vaultMsgId?: number; fileName?: string; episodes?: EpisodeResult[]; expected?: number; rejected?: string[] };
  error?: string;
}

const cooldowns = new Map<string, number>();
export const resetCooldowns = () => cooldowns.clear();

export function buildQuery(job: Pick<CrawlJob, "kind" | "title" | "year">): string {
  const base = job.title.replace(/[:\-–—]+/g, " ").replace(/\s+/g, " ").trim();
  return job.kind === "movie" && job.year && !base.includes(job.year) ? `${base} ${job.year}` : base;
}

export const commandFor = (p: BotProfile, query: string) => (p.commandTemplate || "{query}").replace("{query}", query).trim();

export function eligible(bots: BotProfile[], kind: CrawlJob["kind"]): BotProfile[] {
  const want = kind === "movie" ? "movie" : "series";
  const list = bots.filter((b) => b.scope === "both" || b.scope === want);
  const now = Date.now();
  const ready = list.filter((b) => (cooldowns.get(b.handle.toLowerCase()) ?? 0) <= now);
  return ready.length ? ready : list; // if everyone is cooling down, try anyway rather than fail instantly
}

export async function runJob(job: CrawlJob, deps: EngineDeps): Promise<JobOutcome> {
  const goal: Goal = {
    kind: job.kind,
    title: job.title,
    year: job.year ?? undefined,
    season: job.season ?? undefined,
    episode: job.episode ?? undefined,
    quality: job.quality ?? undefined,
  };
  const bots = eligible(await deps.bots(), job.kind);
  if (!bots.length) return { status: "needs_admin", error: "no active bot is set up for this kind of title" };

  let sawNotFound = 0, sawBlocked = 0, sawFailed = 0;
  const notes: string[] = [];

  for (const bot of bots) {
    const outcome = await withBotLock(bot.handle, async (): Promise<JobOutcome | null> => {
      const session = await deps.open(bot.handle).catch(() => null);
      if (!session) { sawFailed++; notes.push(`${bot.handle}: could not open a conversation`); return null; }
      let trace: TraceStep[] = [];
      try {
        const nav: NavOutcome = await navigate(session.transport, goal, {
          command: commandFor(bot, buildQuery(job)),
          advisor: deps.advisor,
          settleMs: deps.settleMs ?? 12_000,
        });
        trace = nav.trace;

        if (nav.status === "media") {
          try {
            const a = await deps.acquire(nav.media, job, bot.handle, job.episode ?? undefined);
            await saveTrace(job.id, bot.handle, "done", nav.verified ? "verified" : "accepted (name not comparable)", trace);
            return { status: "done", result: { bot: bot.handle, ...a } };
          } catch (e: any) {
            await saveTrace(job.id, bot.handle, "acquire_failed", e?.message, trace);
            sawFailed++; notes.push(`${bot.handle}: ${e?.message}`);
            return null;
          }
        }

        if (nav.status === "delivering") {
          const expected = await deps.expectedEpisodes?.(job);
          const got: EpisodeResult[] = [];
          const res = await collectSeason(
            session.transport,
            goal,
            async (m, ep) => deps.acquire(m, job, bot.handle, ep),
            { expected, onEpisode: async (r) => { got.push(r); await deps.onProgress?.(job, got); } }
          );
          await saveTrace(job.id, bot.handle, res.episodes.length ? "done" : "no_episodes", `${res.episodes.length}/${expected ?? "?"} (${res.reason})`, trace);
          if (res.episodes.length) return { status: "done", result: { bot: bot.handle, episodes: res.episodes, expected, rejected: res.rejected } };
          sawFailed++; notes.push(`${bot.handle}: no episodes arrived`);
          return null;
        }

        await saveTrace(job.id, bot.handle, nav.status, "reason" in nav ? String((nav as any).reason) : undefined, trace);
        if (nav.status === "not_found" || nav.status === "wrong_file") sawNotFound++;
        else if (nav.status === "blocked") {
          sawBlocked++;
          if (nav.reason === "rate_limit") cooldowns.set(bot.handle.toLowerCase(), Date.now() + (nav.waitSec ?? 120) * 1000);
        } else sawFailed++;
        notes.push(`${bot.handle}: ${nav.status}${"reason" in nav ? ` (${(nav as any).reason})` : ""}`);
        return null;
      } catch (e: any) {
        await saveTrace(job.id, bot.handle, "error", e?.message, trace).catch(() => undefined);
        sawFailed++; notes.push(`${bot.handle}: ${e?.message}`);
        return null;
      } finally {
        await session.close().catch(() => undefined);
      }
    });
    if (outcome) return outcome;
  }

  const error = notes.join("; ");
  if (sawFailed === 0 && sawBlocked === 0 && sawNotFound > 0) return { status: "not_found", error };
  if (sawFailed === 0 && sawNotFound === 0 && sawBlocked > 0) return { status: "needs_admin", error };
  if (sawNotFound > 0 && sawFailed === 0) return { status: "not_found", error };
  return { status: "failed", error };
}
