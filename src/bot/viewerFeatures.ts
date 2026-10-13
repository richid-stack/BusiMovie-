/**
 * Things viewers can do after (and around) getting a file:
 *  - a short follow-up message with ⏭ Next episode / 💿 other quality / 🔔 Follow / ⚠️ Wrong file
 *  - follow a series: one message when new episodes land
 *  - report a wrong file: a few reports (or an admin) remove it and fetch a better copy
 *  - /quality: send my preferred version without asking
 */
import { Markup, Telegraf } from "telegraf";
import { db, deleteMediaFile, getMediaFileById, getMovieQualities, setMediaAddedHook } from "../db/index.js";
import { getAdminTelegramIds, isAdminTelegramId } from "../server/auth.js";
import { cachedEpisodes } from "../crawler/browse.js";
import { PRIORITY, submitJob } from "../crawler/service.js";
import { EpisodeBatcher, describeEpisodes, follow, followersOf, isFollowing, listFollows, unfollow } from "./follow.js";
import { getQualityPref, setQualityPref, type QualityPref } from "./prefs.js";
import { AUTO_FIX_AT, addReport, clearReports, reportersOf } from "./reports.js";
import { esc } from "./messages.js";

export interface ViewerDeps {
  showKeyOf(title: string): string;
  sizeLabel(bytes: number): string;
  ephemeral(chatId: string | number, messageId: number, ms: number): void;
}
let botRef: Telegraf | null = null;
let deps: ViewerDeps | null = null;

const labelOf = (f: any) => `${f.quality || "HD"} • ${deps!.sizeLabel(Number(f.file_size || 0))}`;

/** The little "what next?" message under a delivered file. Never throws. */
export async function afterDelivery(ctx: any, file: any): Promise<void> {
  try {
    if (!botRef || !deps || ctx.chat?.type !== "private") return;
    const rows: any[] = [];
    const season = file.season ? Number(file.season) : null;
    const episode = file.episode ? Number(file.episode) : null;
    const title = String(file.movie_title);
    if (season && episode) {
      const held = (await db.execute({ sql: "SELECT id FROM media_files WHERE LOWER(movie_title)=LOWER(?) AND season=? AND episode=? ORDER BY file_size DESC LIMIT 1", args: [title, season, episode + 1] })).rows[0] as any;
      if (held) rows.push([Markup.button.callback(`⏭ Next episode (E${String(episode + 1).padStart(2, "0")})`, `watch_${held.id}`)]);
      else if ((await cachedEpisodes(title, season).catch(() => null))?.includes(episode + 1))
        rows.push([Markup.button.callback(`⏭ Next episode (E${String(episode + 1).padStart(2, "0")})`, `qep_${deps.showKeyOf(title)}_${season}_${episode + 1}`)]);
      rows.push([(await isFollowing(ctx.from.id, title)) ? Markup.button.callback("✅ Following this series", "noop") : Markup.button.callback("🔔 Tell me about new episodes", `fol_${file.id}`)]);
    } else {
      const others = (await getMovieQualities(title, file.year ? String(file.year) : undefined)).filter((f: any) => Number(f.id) !== Number(file.id));
      for (const o of others.slice(0, 2)) rows.push([Markup.button.callback(`💿 Also in ${labelOf(o)}`, `watch_${o.id}`)]);
    }
    rows.push([Markup.button.callback("⚠️ Wrong file?", `rep_${file.id}`)]);
    const sent = await botRef.telegram.sendMessage(ctx.chat.id, "🍿 Enjoy!", { ...Markup.inlineKeyboard(rows) });
    deps.ephemeral(ctx.chat.id, sent.message_id, 10 * 60_000);
  } catch (e: any) {
    console.warn("[viewer] follow-up message failed:", e?.message);
  }
}

/** Remove a bad copy and ask the crawler for a new one; tell the people who reported it when it lands. */
export async function repairFile(fileId: number, by: { admin?: boolean } = {}): Promise<boolean> {
  const f: any = await getMediaFileById(fileId);
  if (!f) return false;
  const reporters = await reportersOf(fileId);
  await deleteMediaFile(fileId);
  await clearReports(fileId);
  const isEp = !!(f.season && f.episode);
  if (!isEp) {
    for (const u of reporters) await db.execute({ sql: "INSERT INTO requests (telegram_id, tmdb_id, title) VALUES (?,?,?)", args: [u, `fix_${fileId}`, String(f.movie_title)] });
  }
  await submitJob({
    kind: isEp ? "episode" : "movie", title: String(f.movie_title), year: f.year ? String(f.year) : null,
    season: isEp ? Number(f.season) : null, episode: isEp ? Number(f.episode) : null, quality: f.quality ? String(f.quality) : null,
    priority: PRIORITY.admin, source: "repair", requestedBy: by.admin ? "admin" : "viewers",
  });
  return true;
}

export function installViewerFeatures(bot: Telegraf, d: ViewerDeps) {
  botRef = bot;
  deps = d;

  // ── follow a series: tell followers when new episodes land (a season arriving at once is one message)
  const batcher = new EpisodeBatcher(90_000, async (n) => {
    const users = await followersOf(n.title);
    if (!users.length) return;
    const first = [...n.items].sort((a, b) => a.season - b.season || a.episode - b.episode)[0];
    const many = n.items.length > 1;
    const text = `🔔 <b>${esc(n.title)}</b>: ${describeEpisodes(n.items)} ${many ? "are" : "is"} ready.`;
    for (const u of users) {
      await bot.telegram.sendMessage(u, text, { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback(many ? "▶️ Start watching" : "▶️ Watch now", `watch_${first.id}`)]]) }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 60)); // stay well under Telegram's send limits
    }
  });
  setMediaAddedHook((m) => { if (m.season !== null && m.episode !== null && m.season !== undefined) batcher.add(m.title, { id: m.id, season: Number(m.season), episode: Number(m.episode) }); });

  bot.action(/^fol_(\d+)$/, async (ctx) => {
    const f: any = await getMediaFileById(Number(ctx.match[1]));
    if (!f || !ctx.from) return void (await ctx.answerCbQuery("Sorry, that one has expired."));
    await follow(ctx.from.id, String(f.movie_title));
    await ctx.answerCbQuery(`Done. I'll message you when new ${f.movie_title} episodes arrive.`, { show_alert: true });
    await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: "✅ Following this series", callback_data: "noop" }]] }).catch(() => undefined);
  });

  const followingView = async (userId: number) => {
    const list = await listFollows(userId);
    if (!list.length) return { text: "You're not following any series yet. After an episode, tap “Tell me about new episodes”.", kb: undefined as any };
    return {
      text: ["🔔 <b>Series you follow</b>", ...list.map((f) => `• ${esc(f.title)}`)].join("\n"),
      kb: Markup.inlineKeyboard(list.slice(0, 10).map((f) => [Markup.button.callback(`🔕 Stop: ${f.title.slice(0, 24)}`, `unf_${f.key.slice(0, 50)}`)])),
    };
  };
  bot.command(["following", "unfollow"], async (ctx) => { const v = await followingView(ctx.from.id); await ctx.reply(v.text, { parse_mode: "HTML", ...(v.kb || {}) }); });
  bot.action(/^unf_(.+)$/, async (ctx) => {
    const prefix = ctx.match[1];
    const hit = (await listFollows(ctx.from!.id)).find((f) => f.key.startsWith(prefix));
    if (hit) await unfollow(ctx.from!.id, hit.key);
    await ctx.answerCbQuery(hit ? `Stopped following ${hit.title}.` : "Already stopped.");
    const v = await followingView(ctx.from!.id);
    await ctx.editMessageText(v.text, { parse_mode: "HTML", ...(v.kb || {}) }).catch(() => undefined);
  });

  // ── wrong-file reports
  bot.action(/^rep_(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const f: any = await getMediaFileById(id);
    if (!f || !ctx.from) return void (await ctx.answerCbQuery("Thanks, that one is already being handled."));
    const admin = isAdminTelegramId(ctx.from.id);
    const n = await addReport(id, ctx.from.id);
    await ctx.answerCbQuery("Thanks. I'll look for a better copy.", { show_alert: true });
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
    const what = `${f.movie_title}${f.season ? ` S${String(f.season).padStart(2, "0")}E${String(f.episode ?? 0).padStart(2, "0")}` : f.year ? ` (${f.year})` : ""} · ${f.quality || "HD"}`;
    if (admin || n >= AUTO_FIX_AT) {
      await repairFile(id, { admin });
      if (!admin) for (const a of getAdminTelegramIds()) await bot.telegram.sendMessage(a, `🔁 ${n} viewers reported <b>${esc(what)}</b>. I removed it and I'm fetching a new copy.`, { parse_mode: "HTML" }).catch(() => undefined);
      return;
    }
    for (const a of getAdminTelegramIds()) {
      await bot.telegram.sendMessage(a, `⚠️ <b>Wrong-file report</b>\n${esc(what)}\n${n} viewer${n === 1 ? "" : "s"} so far.`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔁 Remove & re-fetch", `adm_rep_fix_${id}`), Markup.button.callback("Keep it", `adm_rep_keep_${id}`)]]),
      }).catch(() => undefined);
    }
  });
  bot.action(/^adm_rep_(fix|keep)_(\d+)$/, async (ctx, next) => {
    if (!isAdminTelegramId(ctx.from?.id)) return next();
    const id = Number(ctx.match[2]);
    if (ctx.match[1] === "keep") { await clearReports(id); await ctx.answerCbQuery("Kept."); }
    else await ctx.answerCbQuery((await repairFile(id, { admin: true })) ? "Removed. Fetching a new copy." : "Already gone.");
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
  });

  // ── quality preference
  const prefView = async (uid: number) => {
    const cur = await getQualityPref(uid);
    const mark = (q: QualityPref) => (cur === q ? "✅ " : "");
    return {
      text: "💿 <b>Which version should I send?</b>\nWhen a title comes in more than one quality.",
      kb: Markup.inlineKeyboard([
        [Markup.button.callback(`${mark("ask")}Ask me each time`, "pq_ask")],
        [Markup.button.callback(`${mark("best")}Best quality`, "pq_best")],
        [Markup.button.callback(`${mark("small")}Smaller download (saves data)`, "pq_small")],
      ]),
    };
  };
  bot.command("quality", async (ctx) => { const v = await prefView(ctx.from.id); await ctx.reply(v.text, { parse_mode: "HTML", ...v.kb }); });
  bot.action(/^pq_(ask|best|small)$/, async (ctx) => {
    await setQualityPref(ctx.from!.id, ctx.match[1] as QualityPref);
    await ctx.answerCbQuery("Saved.");
    const v = await prefView(ctx.from!.id);
    await ctx.editMessageText(v.text, { parse_mode: "HTML", ...v.kb }).catch(() => undefined);
  });
}
