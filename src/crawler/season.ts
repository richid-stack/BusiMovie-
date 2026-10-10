/**
 * Bulk season collector. After "send all" the external bot streams episodes at its own pace;
 * we take each file as it arrives, verify it, hand it to `acquire`, and stop when the expected
 * count is reached or the bot has been quiet long enough.
 */
import type { Screen } from "./screen.js";
import type { Goal, Transport } from "./navigator.js";
import { chooseQuality } from "./navigator.js";
import { classifyScreen } from "./classify.js";
import { verifyDownloadedFile } from "./verify.js";
import { parseMediaTitleAndSeriesInfo } from "../services/seriesParser.js";

export interface EpisodeResult { episode: number; mediaFileId: number; vaultMsgId: number; fileName?: string }

export interface CollectOptions {
  expected?: number;
  /** stop after this long with no new file */
  idleMs?: number;
  /** absolute ceiling */
  maxMs?: number;
  sliceMs?: number;
  onEpisode?: (r: EpisodeResult, total: number) => void | Promise<void>;
  now?: () => number;
}

export interface CollectResult { episodes: EpisodeResult[]; rejected: string[]; reason: "complete" | "idle" | "timeout" }

export async function collectSeason(
  t: Transport,
  goal: Goal,
  acquire: (media: Screen, episode: number | undefined) => Promise<Omit<EpisodeResult, "episode">>,
  o: CollectOptions = {}
): Promise<CollectResult> {
  const now = o.now ?? Date.now;
  const idleMs = o.idleMs ?? 25_000;
  const maxMs = o.maxMs ?? 20 * 60_000;
  const slice = o.sliceMs ?? 5_000;
  const started = now();
  let lastActivity = now();
  const seen = new Set<number>();
  const clickedPrompts = new Set<string>();
  const episodes = new Map<number, EpisodeResult>();
  const rejected: string[] = [];
  let seq = 0;

  while (true) {
    if (o.expected && episodes.size >= o.expected) return { episodes: [...episodes.values()], rejected, reason: "complete" };
    if (now() - started > maxMs) return { episodes: [...episodes.values()], rejected, reason: "timeout" };
    if (now() - lastActivity > idleMs) return { episodes: [...episodes.values()], rejected, reason: "idle" };

    const obs = await t.settle(null, slice);
    for (const s of obs.screens) {
      if (!s.media) {
        // an intermediate prompt (e.g. choose quality) — answer it once
        const cls = classifyScreen(s);
        if (cls.kind === "QUALITY" && !clickedPrompts.has(s.fingerprint)) {
          clickedPrompts.add(s.fingerprint);
          const b = chooseQuality(s.buttons, goal.quality);
          if (b) { await t.click(s, b).catch(() => undefined); lastActivity = now(); }
        }
        continue;
      }
      if (seen.has(s.msgId)) continue;
      seen.add(s.msgId);
      lastActivity = now();
      const name = s.media.fileName || "";
      const v = verifyDownloadedFile({ title: goal.title, year: goal.year, season: goal.season }, name, s.text);
      if (!v.ok) { rejected.push(`${name || "file"}: ${v.reason}`); continue; }
      const p = parseMediaTitleAndSeriesInfo(name || s.text || "");
      // index the episode number from the file we received; fall back to arrival order only when the name has none
      const ep = p.episode ?? undefined;
      try {
        const r = await acquire(s, ep);
        const epNo = ep ?? ++seq;
        if (episodes.has(epNo)) continue; // duplicate delivery of the same episode
        const full = { ...r, episode: epNo };
        episodes.set(epNo, full);
        await o.onEpisode?.(full, episodes.size);
      } catch (e: any) {
        rejected.push(`${name || "file"}: ${e?.message || "could not be stored"}`);
      }
    }
  }
}
