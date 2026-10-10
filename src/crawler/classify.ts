/**
 * Screen classifier: rules first. Anything it cannot place is reported as UNKNOWN so the caller
 * can ask the AI "eye" (advisor) instead of guessing.
 */
import { Screen, Button } from "./screen.js";
import { isBackOrNavButton } from "./buttons.js";

export type ScreenKind =
  | "MEDIA"        // a video/document arrived
  | "PLACEHOLDER"  // "searching…", "please wait" — the real screen is coming (usually as an edit)
  | "GATE"         // must join channel(s) / press "I joined" before the bot helps
  | "RATE_LIMIT"   // too many requests / cooldown
  | "EMPTY"        // no results
  | "SEASONS"
  | "EPISODES"
  | "QUALITY"
  | "LIST"         // list of titles/results to choose from
  | "TEXT"         // text only, nothing to do
  | "UNKNOWN";

export interface Classification {
  kind: ScreenKind;
  /** why we decided this (goes into the trace) */
  why: string;
  /** for RATE_LIMIT: seconds to wait if the bot said so */
  waitSec?: number;
}

const QUALITY_TOKEN = /\b(2160p|1080p|720p|480p|360p|4k|uhd|hdr|hevc|x26[45]|web[- ]?dl|blu-?ray|webrip|hdrip|brrip)\b|\b\d+(?:[.,]\d+)?\s*(?:gb|mb)\b/i;
const SEASON_BTN = /^[\W_]*(?:season|seas\.?|s)\s*0?(\d{1,2})[\W_]*$/i;
const EPISODE_BTN = /^[\W_]*(?:episode|ep\.?|e)\s*0?(\d{1,3})\b/i;

const dataOf = (b: Button) => b.data ?? "";

export function isSeasonButton(b: Button) {
  return SEASON_BTN.test(b.text.trim()) || /^se_/.test(dataOf(b));
}
export function isEpisodeButton(b: Button) {
  return EPISODE_BTN.test(b.text.trim()) || /^epsel_/.test(dataOf(b));
}
export function isQualityButton(b: Button) {
  return QUALITY_TOKEN.test(b.text);
}

export function seasonNumberOf(b: Button): number | undefined {
  const m = b.text.trim().match(SEASON_BTN);
  if (m) return Number(m[1]);
  const d = dataOf(b).match(/^se_\d+_(\d+)/) || dataOf(b).match(/^se_(\d+)$/);
  return d ? Number(d[1]) : undefined;
}
export function episodeNumberOf(b: Button): number | undefined {
  const d = dataOf(b).match(/^epsel_\d+_\d+_(\d+)/);
  if (d) return Number(d[1]);
  const m = b.text.trim().match(EPISODE_BTN);
  return m ? Number(m[1]) : undefined;
}

export function classifyScreen(s: Screen): Classification {
  const text = s.text || "";
  const low = text.toLowerCase();

  if (s.media) return { kind: "MEDIA", why: "message carries a file" };

  // Gate: must join / subscribe
  const joinUrl = s.buttons.filter((b) => b.url && /t\.me\/|telegram\.(me|dog)\//i.test(b.url));
  const gateText = /(must|need to|have to|please|first)\b[^.\n]{0,60}\b(join|subscribe)\b|\bjoin\b[^.\n]{0,40}\b(channel|group)s?\b[^.\n]{0,40}\b(to|before|first)\b|not (a )?(member|subscribed)|subscribe to (use|continue)/i.test(text);
  const iJoined = s.buttons.some((b) => /\b(i\s*(have\s*)?joined|joined|done|check|verify|try again|✅\s*joined)\b/i.test(b.text) && !isQualityButton(b));
  if (gateText && (joinUrl.length > 0 || iJoined)) return { kind: "GATE", why: "asks to join channel(s) before use" };
  if (joinUrl.length > 0 && iJoined && s.buttons.length <= joinUrl.length + 2) return { kind: "GATE", why: "join links plus a verify button" };

  // Rate limit
  if (/too many requests|flood|slow down|cool ?down|rate limit|limit (reached|exceeded)|try again (in|after|later)|wait \d+/i.test(low)) {
    const m = low.match(/(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m)\b/);
    const waitSec = m ? Number(m[1]) * (/^m/.test(m[2]) ? 60 : 1) : undefined;
    return { kind: "RATE_LIMIT", why: "bot is throttling us", waitSec };
  }

  // Placeholder: "searching…" with nothing to press
  const actionable = s.buttons.filter((b) => !isBackOrNavButton(b.text));
  if (/\b(searching|please wait|processing|loading|fetching|looking for|working on it|just a moment|hold on)\b|⏳|⌛|🔍\s*\.\.\./i.test(text) && actionable.length === 0) {
    return { kind: "PLACEHOLDER", why: "bot says it is still working" };
  }

  // Empty
  if (/\b(no results?|not found|nothing found|couldn'?t find|could not find|no match(es)?|didn'?t find|no movies? found|no series found|unavailable|no files?)\b/i.test(low) && actionable.length === 0) {
    return { kind: "EMPTY", why: "bot says nothing matched" };
  }

  if (actionable.length === 0) return { kind: s.buttons.length ? "TEXT" : "TEXT", why: "no actionable buttons" };

  const seasonBtns = actionable.filter(isSeasonButton);
  if (seasonBtns.length >= 1 && seasonBtns.length >= actionable.length * 0.5) return { kind: "SEASONS", why: `${seasonBtns.length} season buttons` };

  const epBtns = actionable.filter(isEpisodeButton);
  if (epBtns.length >= 2 && epBtns.length >= actionable.length * 0.5) return { kind: "EPISODES", why: `${epBtns.length} episode buttons` };

  const qBtns = actionable.filter(isQualityButton);
  if (qBtns.length >= 1 && qBtns.length >= actionable.length * 0.5) return { kind: "QUALITY", why: `${qBtns.length} quality/size buttons` };

  return { kind: "LIST", why: `${actionable.length} selectable buttons` };
}
