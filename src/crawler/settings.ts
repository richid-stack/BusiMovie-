import { getSetting, setSetting } from "../db/index.js";

export type SecondQuality = "off" | "requested" | "all";
export interface CrawlerSettings { secondQuality: SecondQuality }

export const DEFAULT_SETTINGS: CrawlerSettings = { secondQuality: "requested" };

export async function getCrawlerSettings(): Promise<CrawlerSettings> {
  const v = (await getSetting("second_quality").catch(() => null)) as SecondQuality | null;
  return { secondQuality: v === "off" || v === "all" || v === "requested" ? v : DEFAULT_SETTINGS.secondQuality };
}

export async function saveCrawlerSettings(patch: Partial<CrawlerSettings>): Promise<CrawlerSettings> {
  if (patch.secondQuality && ["off", "requested", "all"].includes(patch.secondQuality)) await setSetting("second_quality", patch.secondQuality);
  return getCrawlerSettings();
}

/** Should finishing `source` job queue a companion (second-quality) job? Pure, so it can be tested. */
export function wantsCompanion(mode: SecondQuality, source: string): boolean {
  if (mode === "off" || source === "companion") return false;
  if (mode === "all") return true;
  return source === "user" || source === "admin" || source === "web";
}
