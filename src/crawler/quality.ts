/**
 * Quality policy (pure): BusiMovie keeps 1080p and 720p copies only.
 *  - below 720p (480p, 360p, DVDRip, CAM, TS …) is never accepted
 *  - 4K / 2160p is not wanted (huge files)
 *  - quality is judged from the video's real dimensions first (ground truth), then from the file name
 *  - "unknown" (nothing to go on) is allowed through; the label is then the quality that was asked for
 */
export type Tier = "1080p" | "720p";
export type Detected = Tier | "4k" | "below" | "unknown";

export const WANTED_TIERS: Tier[] = ["1080p", "720p"];

export function detectQuality(o: { fileName?: string; caption?: string; width?: number; height?: number }): Detected {
  const { width: w = 0, height: h = 0 } = o;
  if (w || h) {
    if (w >= 3000 || h >= 1800) return "4k";
    if (w >= 1700 || h >= 1000) return "1080p";
    if (w >= 1200 || h >= 680) return "720p";
    return "below";
  }
  return detectFromText(`${o.fileName ?? ""} ${o.caption ?? ""}`);
}

export function detectFromText(text: string): Detected {
  const t = text.toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(t)) return "4k";
  if (/\b(1080p|1080i|fullhd|full hd|fhd)\b/.test(t)) return "1080p";
  if (/\b720p\b/.test(t)) return "720p";
  if (/\b(480p|360p|240p|576p|dvdrip|dvdscr|dvd-rip|hdcam|camrip|cam|hdts|telesync|\bts\b|telecine|screener)\b/.test(t)) return "below";
  return "unknown";
}

export const isAcceptable = (q: Detected) => q === "1080p" || q === "720p" || q === "unknown";

export function judgeQuality(info: { fileName?: string; caption?: string; width?: number; height?: number }): { ok: boolean; quality: Detected; reason?: string } {
  const quality = detectQuality(info);
  if (quality === "below") return { ok: false, quality, reason: "quality is below 720p" };
  if (quality === "4k") return { ok: false, quality, reason: "4K files are not kept (720p and 1080p only)" };
  return { ok: true, quality };
}

/** The label stored with a file: what we measured, else what we asked for, else "HD". */
export function labelFor(detected: Detected, asked?: string | null): string {
  if (detected === "1080p" || detected === "720p") return detected;
  const a = (asked || "").toLowerCase();
  return a === "1080p" || a === "720p" ? a : "HD";
}

/** The other tier we would like to hold next to `have`. */
export const companionOf = (have: Tier): Tier => (have === "1080p" ? "720p" : "1080p");

/** Which wanted tiers a set of stored quality labels already covers. "HD"/unknown covers one slot. */
export function coveredTiers(labels: Array<string | null | undefined>): { tiers: Set<Tier>; unknown: number } {
  const tiers = new Set<Tier>();
  let unknown = 0;
  for (const l of labels) {
    const q = String(l || "").toLowerCase();
    if (q === "1080p") tiers.add("1080p");
    else if (q === "720p") tiers.add("720p");
    else unknown++;
  }
  return { tiers, unknown };
}

/** Do we still want another copy? Never for a movie that already has two usable copies. */
export function missingTier(labels: Array<string | null | undefined>): Tier | null {
  const { tiers, unknown } = coveredTiers(labels);
  if (tiers.size + unknown >= 2) return null;
  if (tiers.size === 0) return null; // nothing known to complement
  return tiers.has("1080p") ? "720p" : "1080p";
}
