/**
 * Bot health: a search bot that keeps breaking (conversation won't open, no file ever arrives, hangs) is paused for a
 * while so it stops eating every job's time, and you get a Telegram message. After a rest it gets one more try; one
 * success clears it. Judged from the job traces, so there is nothing extra to keep in sync.
 *
 * "not found", "wrong file" and rate limits are NOT counted: the bot answered, it just didn't have the title.
 */
import { db } from "../db/index.js";
import { alertAdmin } from "../services/alerts.js";

export type BotState = "ok" | "degraded" | "demoted" | "probation";
export interface BotHealth { state: BotState; broken: number; considered: number; lastAt: number | null; reason: string }

const BROKEN = new Set(["error", "timeout", "acquire_failed", "failed", "no_episodes", "closed"]);
const GOOD = new Set(["done"]);
export const WINDOW = 8;
export const REST_MS = 3 * 3_600_000;

export interface Attempt { outcome: string; at: number }

/** attempts newest first. Pure, unit-tested. */
export function assessBot(attempts: Attempt[], now = Date.now()): BotHealth {
  const meaningful = attempts.filter((a) => BROKEN.has(a.outcome) || GOOD.has(a.outcome)).slice(0, WINDOW);
  const broken = meaningful.filter((a) => BROKEN.has(a.outcome)).length;
  const lastAt = meaningful[0]?.at ?? null;
  const base = { broken, considered: meaningful.length, lastAt };
  if (!meaningful.length) return { ...base, state: "ok", reason: "no recent attempts" };
  const latestFour = meaningful.slice(0, 4);
  const failing = broken >= 5 && latestFour.length === 4 && latestFour.every((a) => BROKEN.has(a.outcome));
  if (failing) {
    if (lastAt !== null && now - lastAt >= REST_MS) return { ...base, state: "probation", reason: "rested, getting one more try" };
    return { ...base, state: "demoted", reason: `${broken} of the last ${meaningful.length} attempts broke` };
  }
  if (broken >= 3 && BROKEN.has(meaningful[0].outcome)) return { ...base, state: "degraded", reason: `${broken} of the last ${meaningful.length} attempts broke` };
  return { ...base, state: "ok", reason: "working" };
}

const parseAt = (s: unknown) => { const t = Date.parse(String(s).replace(" ", "T") + "Z"); return Number.isFinite(t) ? t : Date.now(); };

export async function botHealthMap(now = Date.now()): Promise<Record<string, BotHealth>> {
  const rows = (await db.execute("SELECT bot, outcome, created_at FROM crawl_traces WHERE created_at > datetime('now','-2 days') ORDER BY id DESC LIMIT 600").catch(() => ({ rows: [] as any[] }))).rows as any[];
  const by = new Map<string, Attempt[]>();
  for (const r of rows) { const k = String(r.bot).toLowerCase(); by.set(k, [...(by.get(k) || []), { outcome: String(r.outcome), at: parseAt(r.created_at) }]); }
  const out: Record<string, BotHealth> = {};
  for (const [k, a] of by) out[k] = assessBot(a, now);
  return out;
}

let cache: { at: number; map: Record<string, BotHealth> } | null = null;
export async function cachedBotHealth(): Promise<Record<string, BotHealth>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.map;
  const map = await botHealthMap();
  cache = { at: Date.now(), map };
  return map;
}
export const forgetBotHealth = () => { cache = null; };

/** Drop demoted bots, but never leave a kind of title with no bot at all. Alerts the admin once per pause. */
export async function withoutDemoted<T extends { handle: string; scope: "movie" | "series" | "both" }>(bots: T[]): Promise<T[]> {
  const h = await cachedBotHealth();
  const demoted = (b: T) => h[b.handle.toLowerCase()]?.state === "demoted";
  const kept = bots.filter((b) => !demoted(b));
  const serves = (list: T[], kind: "movie" | "series") => list.some((b) => b.scope === "both" || b.scope === kind);
  const result = [...kept];
  for (const kind of ["movie", "series"] as const) {
    if (!serves(result, kind) && serves(bots, kind)) for (const b of bots) if (demoted(b) && (b.scope === "both" || b.scope === kind) && !result.includes(b)) result.push(b);
  }
  for (const b of bots) {
    if (demoted(b) && !result.includes(b)) {
      void alertAdmin(`bot-demoted:${b.handle.toLowerCase()}`, `⏸ ${b.handle} keeps failing (${h[b.handle.toLowerCase()].reason}), so I've paused it for a few hours and I'm using the others. It gets another try automatically. Check it in Admin → Search bots.`, 6 * 3_600_000);
    }
  }
  return result.sort((a, b) => bots.indexOf(a) - bots.indexOf(b));
}
