/**
 * Finding titles for the places that can't hold a conversation: inline mode (@bot title in any chat) and groups.
 * Library first (fast, no network), then the metadata provider for titles we don't have yet.
 */
import { db } from "../db/index.js";

export interface Hit {
  title: string; year: string; kind: "movie" | "series"; inVault: boolean;
  /** the file to start with: the film itself, or episode one of a show */
  watchId?: number; qualities: string[];
  tmdbId?: string; poster?: string | null; overview?: string | null;
}
export interface MetaResult { id: string; title: string; year?: string; poster_path?: string | null; overview?: string; media_type?: string }
export interface DiscoveryDeps { searchMeta?: (q: string) => Promise<MetaResult[]>; isSeries?: (m: MetaResult) => boolean }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function group(rows: any[]): Hit[] {
  const out = new Map<string, Hit & { _s: number; _e: number }>();
  for (const r of rows) {
    const series = r.season !== null && r.season !== undefined && r.season !== "";
    const key = series ? `s:${norm(r.movie_title)}` : `m:${norm(r.movie_title)}:${r.year || ""}`;
    let h = out.get(key);
    if (!h) {
      h = { title: r.movie_title, year: r.year || "", kind: series ? "series" : "movie", inVault: true, qualities: [], watchId: Number(r.id), poster: r.poster_url, _s: Number(r.season ?? 0), _e: Number(r.episode ?? 0) };
      out.set(key, h);
    }
    const q = String(r.quality || "HD");
    if (!h.qualities.includes(q)) h.qualities.push(q);
    if (series) {
      const s = Number(r.season), e = Number(r.episode ?? 0);
      if (s < h._s || (s === h._s && e < h._e)) { h.watchId = Number(r.id); h._s = s; h._e = e; }
    } else if (Number(r.file_size || 0) > 0 && !h.watchId) h.watchId = Number(r.id);
  }
  return [...out.values()].map(({ _s, _e, ...h }) => h);
}

export async function libraryHits(query: string, limit = 8): Promise<Hit[]> {
  const q = norm(query);
  if (q.length < 2) return [];
  const like = `%${q.replace(/ /g, "%")}%`;
  const rows = (await db.execute({
    sql: `SELECT id, movie_title, year, quality, season, episode, file_size, poster_url FROM media_files
          WHERE telegram_channel_id <> 'AutoVault' AND (LOWER(movie_title) LIKE ? OR REPLACE(LOWER(movie_title),' ','') LIKE ?)
          ORDER BY id DESC LIMIT 200`,
    args: [like, `%${q.replace(/ /g, "")}%`],
  })).rows as any[];
  return group(rows).slice(0, limit);
}

export async function recentHits(limit = 10): Promise<Hit[]> {
  const rows = (await db.execute(`SELECT id, movie_title, year, quality, season, episode, file_size, poster_url FROM media_files WHERE telegram_channel_id <> 'AutoVault' ORDER BY id DESC LIMIT 120`)).rows as any[];
  return group(rows).slice(0, limit);
}

/** Library titles first; when there are few, add titles we could request. */
export async function findHits(query: string, limit: number, deps: DiscoveryDeps = {}): Promise<Hit[]> {
  const hits = await libraryHits(query, limit);
  if (hits.length >= Math.min(limit, 5) || !deps.searchMeta) return hits;
  try {
    const have = new Set(hits.map((h) => norm(h.title)));
    for (const m of await deps.searchMeta(query)) {
      if (hits.length >= limit) break;
      if (have.has(norm(m.title))) continue;
      have.add(norm(m.title));
      hits.push({ title: m.title, year: m.year || "", kind: deps.isSeries?.(m) ? "series" : "movie", inVault: false, qualities: [], tmdbId: String(m.id), poster: m.poster_path, overview: m.overview });
    }
  } catch { /* metadata is a bonus; the library results still stand */ }
  return hits;
}

export const botLink = (botUsername: string, payload: string) => `https://t.me/${botUsername}?start=${payload}`;
export const hitLink = (h: Hit, botUsername: string): string | null =>
  h.inVault && h.watchId ? botLink(botUsername, `watch_${h.watchId}`) : h.tmdbId ? botLink(botUsername, `req_${h.tmdbId}`) : null;
export const hitLabel = (h: Hit) => `${h.kind === "series" ? "📺" : "🎬"} ${h.title}${h.year ? ` (${h.year})` : ""} ${h.inVault ? "✅" : "📝"}`;

// ── groups ─────────────────────────────────────────────────────────────────
const GROUP_COMMANDS = /^\/(search|find|movie|series|watch)(?:@\w+)?(?:\s+([\s\S]+))?$/i;
export type GroupTrigger = { kind: "search"; query: string } | { kind: "help" } | { kind: "empty" } | null;

/**
 * In a group the bot only answers when called: /search title, /movie title, @bot title, or a reply to the bot.
 * Everything else in the chat is ignored.
 */
export function parseGroupTrigger(text: string, botUsername: string, isReplyToBot = false): GroupTrigger {
  const t = String(text || "").trim();
  if (!t) return null;
  const cmd = t.match(GROUP_COMMANDS);
  if (cmd) return cmd[2]?.trim() ? { kind: "search", query: cmd[2].trim().slice(0, 100) } : { kind: "empty" };
  if (/^\/(start|help)(?:@\w+)?(?:\s|$)/i.test(t)) return { kind: "help" };
  const mention = new RegExp(`@${botUsername}\\b`, "i");
  if (mention.test(t)) {
    const q = t.replace(mention, "").replace(/\s+/g, " ").trim();
    return q ? { kind: "search", query: q.slice(0, 100) } : { kind: "help" };
  }
  if (isReplyToBot && !t.startsWith("/")) return { kind: "search", query: t.slice(0, 100) };
  return null;
}
