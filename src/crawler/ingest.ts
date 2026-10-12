/**
 * Rules for a file posted in a source channel (pure: no Telegram, no DB), so they can be unit-tested.
 * A post is accepted only if it is a real film/episode, at 1080p/720p, above the channel's size floor,
 * and its title can actually be read.
 */
import { parseMediaTitleAndSeriesInfo } from "../services/seriesParser.js";
import { detectQuality, judgeQuality, labelFor } from "./quality.js";

export interface ChannelPost {
  msgId: number;
  caption?: string;
  fileName?: string;
  size: number;
  mime?: string;
  isVideo: boolean;
  durationSec?: number;
  width?: number;
  height?: number;
}

export interface TargetRules {
  min_file_size_mb?: number | null;
  /** "all" | "1080p" | "720p" ("4k" is a legacy value and now means "all": 4K is never kept) */
  quality_filter?: string | null;
}

export interface Accepted {
  ok: true;
  title: string;
  year: string;
  quality: string;
  isSeries: boolean;
  season: number | null;
  episode: number | null;
  fileName: string;
}
export interface Rejected { ok: false; reason: string; code: "not_video" | "too_small" | "too_short" | "junk" | "quality" | "filter" | "no_title" }
export type Verdict = Accepted | Rejected;

const JUNK = /\b(sample|trailer|teaser|promo|preview|behind the scenes|featurette|making of)\b/i;
const GENERIC = /^(video|movie|film|file|document|untitled|unnamed|media|download|tg video|telegram video|vid|clip)( \d+)?$/i;
const MIN_SECONDS = 5 * 60;

export function judgePost(p: ChannelPost, rules: TargetRules): Verdict {
  if (!p.isVideo) return { ok: false, code: "not_video", reason: "not a video" };
  const minBytes = (Number(rules.min_file_size_mb) || 0) * 1024 * 1024;
  if (p.size < minBytes) return { ok: false, code: "too_small", reason: `smaller than ${rules.min_file_size_mb} MB` };
  if (p.durationSec !== undefined && p.durationSec > 0 && p.durationSec < MIN_SECONDS) return { ok: false, code: "too_short", reason: "under 5 minutes (a clip, not a film or episode)" };

  const caption = (p.caption || "").split(/\r?\n/)[0].trim();
  if (JUNK.test(p.fileName || "") || JUNK.test(caption)) return { ok: false, code: "junk", reason: "looks like a sample, trailer or extra" };

  const qj = judgeQuality({ fileName: p.fileName, caption, width: p.width, height: p.height });
  if (!qj.ok) return { ok: false, code: "quality", reason: qj.reason || "quality not accepted" };

  const want = (rules.quality_filter || "all").toLowerCase();
  if ((want === "1080p" || want === "720p") && qj.quality !== want) {
    // unknown quality can't be shown to match a specific filter
    return { ok: false, code: "filter", reason: `channel is set to ${want} only` };
  }

  // Title: the file name first, then the post's caption
  for (const text of [p.fileName, caption]) {
    if (!text) continue;
    const parsed = parseMediaTitleAndSeriesInfo(text);
    const title = (parsed.cleanTitle || "").trim();
    const flat = title.replace(/[._]+/g, " ").trim();
    if (flat.length < 2 || GENERIC.test(flat) || /^[a-f0-9 ]{8,}$/i.test(flat)) continue;
    const q = detectQuality({ fileName: p.fileName, caption, width: p.width, height: p.height });
    return {
      ok: true,
      title,
      year: parsed.year || "",
      quality: labelFor(q, null),
      isSeries: parsed.isSeries,
      season: parsed.isSeries ? parsed.season ?? 1 : null,
      episode: parsed.isSeries ? parsed.episode ?? null : null,
      fileName: p.fileName || `${title}.mkv`,
    };
  }
  return { ok: false, code: "no_title", reason: "couldn't read a title from the file name or caption" };
}

/** Same release already held? Same title/year/season/episode/quality, or the exact same file name and size. */
export interface HeldRow { movie_title: string; year?: string | null; quality?: string | null; season?: number | null; episode?: number | null; file_name?: string | null; file_size?: number | null }

const key = (s: string) => s.toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9]+/g, "");

export function alreadyHave(a: Accepted, size: number, held: HeldRow[]): string | null {
  const t = key(a.title);
  for (const r of held) {
    if (r.file_name && r.file_size && r.file_name === a.fileName && Number(r.file_size) === size) return "this exact file is already in the library";
    if (key(r.movie_title || "") !== t) continue;
    if (a.year && r.year && String(r.year) !== a.year) continue;
    if ((r.season ?? null) !== a.season || (r.episode ?? null) !== a.episode) continue;
    const rq = String(r.quality || "").toLowerCase();
    if (a.quality === "HD" || rq === "hd" || rq === a.quality.toLowerCase()) return `already have this ${a.isSeries ? "episode" : "film"} in ${r.quality || "HD"}`;
  }
  return null;
}
