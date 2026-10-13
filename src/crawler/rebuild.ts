/**
 * Rebuild the library from the vault channels. If the database is lost (or you point the app at a new one), every
 * file is still sitting in the vault; this reads the channel(s) again and re-indexes each file from its name/caption.
 * Safe to run any time: files already indexed are skipped, and nothing is sent to followers.
 */
import { addMediaFile, db, withMediaHookMuted } from "../db/index.js";
import { getConnectedClient, getEffectiveVaultChannelId } from "../services/crawlerService.js";
import { whyBlocked } from "./blocklist.js";
import { judgePost } from "./ingest.js";
import { postOf } from "./channels.js";

export interface RebuildState {
  running: boolean; startedAt: number | null; finishedAt: number | null;
  vault: string | null; scanned: number; added: number; already: number; skipped: number; error: string | null;
  skippedReasons: Record<string, number>;
}
const fresh = (): RebuildState => ({ running: false, startedAt: null, finishedAt: null, vault: null, scanned: 0, added: 0, already: 0, skipped: 0, error: null, skippedReasons: {} });
let state: RebuildState = fresh();
export const rebuildState = (): RebuildState => ({ ...state, skippedReasons: { ...state.skippedReasons } });

export async function startRebuild(limitPerVault = 20000): Promise<{ started: boolean; reason?: string }> {
  if (state.running) return { started: false, reason: "A rebuild is already running." };
  const client: any = await getConnectedClient();
  if (!client) return { started: false, reason: "The userbot isn't signed in. Sign in under Connections first." };
  const movie = await getEffectiveVaultChannelId(false);
  const series = await getEffectiveVaultChannelId(true);
  const vaults = Array.from(new Set([movie, series].filter(Boolean)));
  if (!vaults.length) return { started: false, reason: "No vault channel is set. Add it under Connections." };
  state = { ...fresh(), running: true, startedAt: Date.now() };
  void run(client, vaults, limitPerVault);
  return { started: true };
}


export type IndexResult = { status: "added" | "already" | "skipped" | "ignored"; reason?: string };
/** Index one vault message. Exported for tests. */
export async function indexVaultMessage(vaultId: string, m: any): Promise<IndexResult> {
  const post = postOf(m);
  if (!post) return { status: "ignored" };
  const have = (await db.execute({ sql: "SELECT 1 FROM media_files WHERE telegram_channel_id=? AND telegram_message_id=? LIMIT 1", args: [vaultId, String(post.msgId)] })).rows[0];
  if (have) return { status: "already" };
  const v = judgePost(post, { min_file_size_mb: 0, quality_filter: "all" });
  if (v.ok === false) return v.code === "not_video" ? { status: "ignored" } : { status: "skipped", reason: v.reason };
  const barred = await whyBlocked({ title: v.title, year: v.year, fileName: v.fileName, size: post.size });
  if (barred) return { status: "skipped", reason: "blocked" };
  const slug = v.title.toLowerCase().replace(/[^a-z0-9]/g, "_");
  await withMediaHookMuted(() => addMediaFile({
    movie_id: v.isSeries ? `tg_series_${slug}_s${v.season}_e${v.episode}` : `tg_${slug}_${v.year || "x"}`,
    movie_title: v.title, year: v.year,
    telegram_file_id: String(post.msgId), telegram_channel_id: vaultId, telegram_message_id: String(post.msgId),
    file_name: v.fileName, file_size: post.size, quality: v.quality, language: "English",
    mime_type: post.mime || "video/mp4", season: v.season, episode: v.episode,
  } as any));
  return { status: "added" };
}

async function run(client: any, vaults: string[], limit: number) {
  try {
    for (const vaultId of vaults) {
      state.vault = vaultId;
      const entity = await client.getEntity(vaultId);
      let n = 0;
      for await (const m of client.iterMessages(entity, { limit })) {
        if (++n % 200 === 0) await new Promise((r) => setTimeout(r, 400)); // be gentle with Telegram
        state.scanned++;
        const r = await indexVaultMessage(vaultId, m);
        if (r.status === "added") state.added++;
        else if (r.status === "already") state.already++;
        else if (r.status === "skipped") { state.skipped++; state.skippedReasons[r.reason || "skipped"] = (state.skippedReasons[r.reason || "skipped"] || 0) + 1; }
      }
    }
  } catch (e: any) {
    state.error = e?.message || "The rebuild stopped unexpectedly.";
  } finally {
    state.running = false; state.finishedAt = Date.now();
  }
}
