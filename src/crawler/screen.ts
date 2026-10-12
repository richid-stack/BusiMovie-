/**
 * A "screen" is what an external bot is showing right now: its text, its buttons, and any media.
 * Everything the crawler decides is based on screens, never on message-id guesses.
 * This file is pure (no Telegram imports) so it can be unit-tested with scripted bots.
 */
import { createHash } from "node:crypto";

export interface Button {
  text: string;
  row: number;
  col: number;
  /** callback data, decoded as utf8 */
  data?: string;
  /** url buttons (channel invites, ads, deep links) */
  url?: string;
}

export interface MediaInfo {
  fileName?: string;
  size?: number;
  mime?: string;
  isVideo: boolean;
  durationSec?: number;
  /** real video dimensions when Telegram reports them: the most reliable quality signal */
  width?: number;
  height?: number;
}

export interface Screen {
  msgId: number;
  text: string;
  buttons: Button[];
  media?: MediaInfo;
  /** epoch ms of the last edit, if the bot edited this message */
  editedAt?: number;
  fingerprint: string;
}

/** Volatile bits that change without the screen really changing (clocks, counters, spinner frames). */
function stable(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, "")
    .replace(/[⏳⌛🔄🔃⏱]+/gu, "")
    .replace(/[.…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprintOf(text: string, buttons: Pick<Button, "text" | "data" | "url">[], media?: MediaInfo): string {
  const h = createHash("sha1");
  h.update(stable(text));
  for (const b of buttons) h.update(`|${b.text}~${b.data ?? ""}~${b.url ?? ""}`);
  if (media) h.update(`|m:${media.fileName ?? ""}:${media.size ?? 0}`);
  return h.digest("hex").slice(0, 12);
}

export function makeScreen(o: {
  msgId: number;
  text?: string;
  buttons?: Button[];
  media?: MediaInfo;
  editedAt?: number;
}): Screen {
  const text = o.text ?? "";
  const buttons = o.buttons ?? [];
  return { msgId: o.msgId, text, buttons, media: o.media, editedAt: o.editedAt, fingerprint: fingerprintOf(text, buttons, o.media) };
}

/** Convenience for tests and fixtures: rows of [text, data|url]. */
export function buttonsFrom(rows: Array<Array<string | [string, string] | { text: string; data?: string; url?: string }>>): Button[] {
  const out: Button[] = [];
  rows.forEach((r, row) =>
    r.forEach((b, col) => {
      if (typeof b === "string") out.push({ text: b, row, col, data: `cb_${row}_${col}` });
      else if (Array.isArray(b)) out.push({ text: b[0], row, col, data: b[1] });
      else out.push({ row, col, ...b });
    })
  );
  return out;
}

export const isMediaScreen = (s: Screen) => Boolean(s.media);
