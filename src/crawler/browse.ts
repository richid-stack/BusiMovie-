/**
 * Read-only browsing of a series bot: which seasons exist and which episodes each one has.
 * Results are cached in `series_blueprint` so the viewer UI never waits on the external bot twice.
 */
import { db } from "../db/index.js";
import { navigate, findNextPage, Transport } from "./navigator.js";
import { classifyScreen, episodeNumberOf, seasonNumberOf, isEpisodeButton, isSeasonButton } from "./classify.js";
import type { Screen } from "./screen.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function ensureBlueprintTable() {
  await db.execute(`CREATE TABLE IF NOT EXISTS series_blueprint (
    title_key TEXT NOT NULL, season INTEGER NOT NULL, episodes TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (title_key, season))`);
}

export const cachedSeasons = (title: string) => readCache(title, 0);
export const cachedEpisodes = (title: string, season: number) => readCache(title, season);

/** season = 0 stores the season list itself (episodes JSON = season numbers). */
async function readCache(title: string, season: number): Promise<number[] | null> {
  const r = await db.execute({ sql: `SELECT episodes, updated_at FROM series_blueprint WHERE title_key=? AND season=?`, args: [key(title), season] });
  const row: any = r.rows[0];
  if (!row || Date.now() - Number(row.updated_at) > TTL_MS) return null;
  return JSON.parse(row.episodes);
}
async function writeCache(title: string, season: number, nums: number[]) {
  await db.execute({ sql: `INSERT OR REPLACE INTO series_blueprint (title_key,season,episodes,updated_at) VALUES (?,?,?,?)`, args: [key(title), season, JSON.stringify(nums), Date.now()] });
}

async function pagedNumbers(t: Transport, first: Screen, pick: (s: Screen) => number[], maxPages = 6): Promise<number[]> {
  const out = new Set<number>();
  let cur = first;
  const seen = new Set<string>();
  for (let i = 0; i < maxPages; i++) {
    pick(cur).forEach((n) => out.add(n));
    const next = findNextPage(cur.buttons);
    if (!next || seen.has(cur.fingerprint)) break;
    seen.add(cur.fingerprint);
    const obs = await t.click(cur, next);
    const s = obs.screens[obs.screens.length - 1];
    if (!s || classifyScreen(s).kind === "MEDIA") break;
    cur = s;
  }
  return Array.from(out).sort((a, b) => a - b);
}

export async function browseSeasons(t: Transport, title: string, command: string, opts: { force?: boolean } = {}): Promise<number[]> {
  if (!opts.force) { const c = await readCache(title, 0); if (c?.length) return c; }
  const r = await navigate(t, { kind: "seasons", title }, { command, settleMs: 12_000 });
  if (r.status !== "reached") return [];
  const nums = await pagedNumbers(t, r.screen, (s) => s.buttons.filter(isSeasonButton).map(seasonNumberOf).filter((n): n is number => n !== undefined));
  if (nums.length) await writeCache(title, 0, nums);
  return nums;
}

export async function browseEpisodes(t: Transport, title: string, season: number, command: string, opts: { force?: boolean } = {}): Promise<number[]> {
  if (!opts.force) { const c = await readCache(title, season); if (c?.length) return c; }
  const r = await navigate(t, { kind: "episodes", title, season }, { command, settleMs: 12_000 });
  if (r.status !== "reached") return [];
  const nums = await pagedNumbers(t, r.screen, (s) => s.buttons.filter(isEpisodeButton).map(episodeNumberOf).filter((n): n is number => n !== undefined));
  if (nums.length) await writeCache(title, season, nums);
  return nums;
}
