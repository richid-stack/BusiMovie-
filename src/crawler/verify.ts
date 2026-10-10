import stringSimilarity from "string-similarity";
import { parseMediaTitleAndSeriesInfo } from "../services/seriesParser.js";

/**
 * Smart fuzzy title normalizer: strips release tags, "The/A/An" prefixes, years, and punctuation
 */
export function normalizeTitleFuzzy(title: string): string {
  if (!title) return "";
  let t = title.toLowerCase().trim();
  // Strip release groups in brackets or parentheses e.g. [YTS], (1080p), [Pahe]
  t = t.replace(/\[[^\]]*\]|\([^\)]*(?:1080p|720p|4k|bluray|webrip|hevc)[^\)]*\)/gi, " ");
  // Strip leading articles
  t = t.replace(/^(the|a|an)\s+/i, "");
  // Strip year at the end, e.g. " 2024", " (2024)"
  t = t.replace(/[\s\(]+(19\d{2}|20\d{2})[\)]?$/, "");
  // Normalize punctuation and symbols to spaces
  t = t.replace(/[:\-_.,'"`!?()]/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

export interface DownloadExpectation { title: string; year?: string; season?: number; episode?: number }

/**
 * Verification gate: does the file the bot sent look like what was asked for?
 * Unverifiable names (e.g. "Video.mp4") pass but are flagged `verified: false`; positive mismatches are rejected.
 */
export function verifyDownloadedFile(
  expect: DownloadExpectation | undefined,
  fileName: string,
  caption?: string
): { ok: boolean; verified: boolean; reason?: string } {
  if (!expect || !expect.title) return { ok: true, verified: false };

  const candidates = [fileName, caption].filter((x): x is string => Boolean(x && x.trim()));
  const wantNorm = normalizeTitleFuzzy(expect.title);
  let sawComparable = false;
  let lastReason = "";

  for (const text of candidates) {
    const p = parseMediaTitleAndSeriesInfo(text);
    const gotNorm = normalizeTitleFuzzy(p.cleanTitle || "");
    if (!gotNorm || gotNorm.length < 2) continue;
    // Generic / machine names carry no title information, so they cannot disprove anything
    if (/^(video|movie|film|file|document|untitled|unnamed|media|download|tg video|telegram video)( \d+)?$/.test(gotNorm) || /^[a-f0-9 ]{8,}$/.test(gotNorm)) continue;
    sawComparable = true;

    let sim = 0;
    try { sim = stringSimilarity.compareTwoStrings(wantNorm, gotNorm); } catch (_) {}
    const contains = gotNorm.includes(wantNorm) || wantNorm.includes(gotNorm);
    if (sim < 0.6 && !contains) { lastReason = `Title mismatch: wanted "${expect.title}", got "${p.cleanTitle}"`; continue; }

    if (expect.year && p.year && Math.abs(Number(expect.year) - Number(p.year)) > 1) {
      lastReason = `Year mismatch: wanted ${expect.year}, got ${p.year}`; continue;
    }
    if (expect.season !== undefined && p.isSeries && p.season !== undefined && p.season !== expect.season) {
      lastReason = `Season mismatch: wanted S${expect.season}, got S${p.season}`; continue;
    }
    if (expect.episode !== undefined && p.isSeries && p.episode !== undefined && p.episode !== expect.episode) {
      lastReason = `Episode mismatch: wanted E${expect.episode}, got E${p.episode}`; continue;
    }
    return { ok: true, verified: true };
  }
  if (!sawComparable) return { ok: true, verified: false };
  return { ok: false, verified: true, reason: lastReason };
}
