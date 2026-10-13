/**
 * Run the library from your phone. Every command here answers admins only (ADMIN_TELEGRAM_IDS) and stays silent for
 * everyone else, so viewers never see them.
 *
 *   /admin      what you can do
 *   /health     bot, userbot, database, crawler, queue, gate in one message
 *   /queue      what the crawler is doing and what finished lately
 *   /fetch X    get a title now (you're messaged when it's done)
 *   /wish X     add a series to the wishlist: "/wish Severance", "/wish Dark S1-S3", "/wish Succession follow"
 *   /wishlist   how the wishlist is going
 *   /requests   what viewers are asking for, with Fetch / Ready buttons
 *   /gate       required channels: status, on/off
 */
import { Markup, Telegraf } from "telegraf";
import { db, getDatabaseInfo, markRequestsFulfilled } from "../db/index.js";
import { isAdminTelegramId } from "../server/auth.js";
import { getCrawlerStatus } from "../services/crawlerService.js";
import { PRIORITY, submitJob, workerHealth } from "../crawler/service.js";
import { addWish, listWishes, parseSeriesLine } from "../crawler/wishlist.js";
import { getGateSettings, listGateChannels, saveGateSettings, gateStats } from "./gate.js";
import { esc } from "./messages.js";
import { parseMediaTitleAndSeriesInfo } from "../services/seriesParser.js";

const argsOf = (ctx: any) => String(ctx.message?.text || "").replace(/^\/\w+(@\w+)?\s*/, "").trim();
const mins = (s: number) => (s < 90 ? `${s}s` : `${Math.round(s / 60)} min`);

/** "Severance", "Dark S1-S3", "Succession follow" → what to add to the wishlist. */
export function parseWishCommand(text: string): { title: string; mode: "all" | "seasons" | "follow"; seasons: number[] | null } | null {
  let t = text.trim();
  if (t.length < 2) return null;
  let follow = false;
  const f = t.match(/^(.*?)\s*(?:\+\s*new|follow|keep\s+up)\s*$/i);
  if (f && f[1].trim()) { follow = true; t = f[1].trim(); }
  const parsed = parseSeriesLine(t);
  if (parsed) return follow ? { title: parsed.title, mode: "follow", seasons: null } : parsed;
  return { title: t, mode: follow ? "follow" : "all", seasons: null };
}

export async function healthText(): Promise<string> {
  const crawler = await getCrawlerStatus().catch(() => null) as any;
  const w = workerHealth();
  const db_ = getDatabaseInfo();
  const jobs = (await db.execute("SELECT status, COUNT(*) AS n FROM crawl_jobs WHERE status IN ('queued','running') OR (status IN ('failed','needs_admin') AND finished_at > datetime('now','-1 day')) GROUP BY status")).rows as any[];
  const n = (s: string) => Number(jobs.find((j) => j.status === s)?.n ?? 0);
  const gate = await getGateSettings();
  const gateChannels = (await listGateChannels(true)).length;
  const lib = Number((await db.execute("SELECT COUNT(*) AS n FROM media_files")).rows[0]?.n ?? 0);
  const lines = [
    "🩺 <b>BusiMovie health</b>",
    `Bot: ✅ running`,
    `Userbot: ${crawler?.connected ? `✅ ${esc(crawler.username ? "@" + crawler.username : crawler.firstName || "signed in")}` : "❌ signed out (Admin → Connections)"}`,
    `Database: ${db_.kind === "turso" ? "✅ Turso" : db_.persistent ? "✅ local file" : "⚠️ temporary, add Turso"}`,
    `Crawler: ${w.stalled ? `⚠️ stuck on "${esc(w.current?.title || "")}"` : w.current ? `working on "${esc(w.current.title)}" (${mins(w.current.seconds)})` : "idle"}`,
    `Queue: ${n("queued")} waiting · ${n("running")} running · ${n("failed")} failed and ${n("needs_admin")} need you (last 24h)`,
    `Required channels: ${gate.enabled ? `on (${gateChannels})` : "off"}`,
    `Library: ${lib} files`,
  ];
  if (crawler?.floodWaitActive) lines.push(`⏳ Telegram is rate-limiting the userbot (~${crawler.floodWaitCooldownSeconds}s)`);
  return lines.join("\n");
}

async function queueText(): Promise<string> {
  const w = workerHealth();
  const queued = (await db.execute("SELECT title, kind, season, source FROM crawl_jobs WHERE status='queued' ORDER BY priority ASC, id ASC LIMIT 6")).rows as any[];
  const recent = (await db.execute("SELECT title, kind, season, status FROM crawl_jobs WHERE status NOT IN ('queued','running') ORDER BY id DESC LIMIT 6")).rows as any[];
  const tag = (j: any) => `${esc(j.title)}${j.season ? ` S${j.season}` : ""}`;
  const icon: Record<string, string> = { done: "✅", failed: "❌", not_found: "🔍", needs_admin: "🙋" };
  const out = [`⚙️ <b>Crawler</b>: ${w.current ? `working on "${esc(w.current.title)}" (${mins(w.current.seconds)})` : "idle"}`];
  if (queued.length) out.push("", "<b>Next up</b>", ...queued.map((j) => `• ${tag(j)} <i>${esc(String(j.source))}</i>`));
  if (recent.length) out.push("", "<b>Just finished</b>", ...recent.map((j) => `${icon[j.status] || "•"} ${tag(j)}`));
  return out.join("\n");
}

async function requestsView() {
  const rows = (await db.execute("SELECT MIN(id) AS id, title, COUNT(*) AS votes FROM requests WHERE status IN ('pending','waiting') GROUP BY LOWER(title) ORDER BY votes DESC, id ASC LIMIT 8")).rows as any[];
  if (!rows.length) return { text: "📭 No open requests right now.", keyboard: undefined as any };
  const text = ["📥 <b>What viewers are asking for</b>", "", ...rows.map((r) => `• ${esc(String(r.title))}${Number(r.votes) > 1 ? ` · <b>${r.votes}</b> people` : ""}`)].join("\n");
  const keyboard = Markup.inlineKeyboard(rows.map((r) => [
    Markup.button.callback(`⬇️ ${String(r.title).slice(0, 18)}`, `adm_fetch_${r.id}`),
    Markup.button.callback("✅ Ready", `adm_ready_${r.id}`),
  ]));
  return { text, keyboard };
}

async function titleOfRequest(id: number): Promise<string | null> {
  const r = (await db.execute({ sql: "SELECT title FROM requests WHERE id=?", args: [id] })).rows[0] as any;
  return r ? String(r.title) : null;
}

export function installAdminCommands(bot: Telegraf) {
  const admin = (fn: (ctx: any) => Promise<any>) => async (ctx: any, next: () => Promise<void>) => {
    if (!isAdminTelegramId(ctx.from?.id)) return next();
    try { await fn(ctx); } catch (e: any) { await ctx.reply(`Something went wrong: ${esc(e?.message || "unknown")}`).catch(() => undefined); }
  };

  bot.command("admin", admin(async (ctx) => {
    await ctx.reply([
      "🛠 <b>Admin commands</b>",
      "/health: is everything running?",
      "/queue: what the crawler is doing",
      "/fetch <i>title</i>: get a movie now",
      "/wish <i>title</i>: add a series (e.g. <code>/wish Dark S1-S3</code>, <code>/wish Succession follow</code>)",
      "/wishlist: wishlist progress",
      "/requests: what viewers want",
      "/gate: required channels",
      "/broadcast <i>text</i>: message every viewer",
    ].join("\n"), { parse_mode: "HTML" });
  }));

  bot.command("health", admin(async (ctx) => { await ctx.reply(await healthText(), { parse_mode: "HTML" }); }));
  bot.command("queue", admin(async (ctx) => { await ctx.reply(await queueText(), { parse_mode: "HTML" }); }));

  bot.command("fetch", admin(async (ctx) => {
    const raw = argsOf(ctx);
    if (!raw) return void (await ctx.reply("Tell me what to get, e.g. <code>/fetch Inception 2010</code>", { parse_mode: "HTML" }));
    const p = parseMediaTitleAndSeriesInfo(raw);
    const title = p.cleanTitle || raw;
    await submitJob({ kind: "movie", title, year: p.year || null, priority: PRIORITY.admin, source: "admin", requestedBy: `tg:${ctx.from.id}` });
    await ctx.reply(`⬇️ Looking for <b>${esc(title)}</b>${p.year ? ` (${esc(p.year)})` : ""}. I'll message you when it's done.`, { parse_mode: "HTML" });
  }));

  bot.command("wish", admin(async (ctx) => {
    const w = parseWishCommand(argsOf(ctx));
    if (!w) return void (await ctx.reply("Tell me which series, e.g. <code>/wish Severance</code>, <code>/wish Dark S1-S3</code> or <code>/wish Succession follow</code>", { parse_mode: "HTML" }));
    const r = await addWish(w);
    const what = w.mode === "seasons" ? `season${w.seasons!.length > 1 ? "s" : ""} ${w.seasons!.join(", ")}` : w.mode === "follow" ? "every episode, and new ones as they come" : "every episode";
    await ctx.reply(`📺 ${r.existing ? "Updated" : "Added"} <b>${esc(w.title)}</b> on the wishlist: ${what}. The crawler will start shortly.`, { parse_mode: "HTML" });
  }));

  bot.command("wishlist", admin(async (ctx) => {
    const list = await listWishes();
    if (!list.length) return void (await ctx.reply("The wishlist is empty. Add a show with /wish.", { parse_mode: "HTML" }));
    const lines = list.slice(0, 12).map((w) => {
      const held = w.progress.reduce((n, p) => n + p.held, 0);
      const offered = w.progress.reduce((n, p) => n + (p.offered ?? 0), 0);
      const st = w.running ? "⬇️" : w.status === "done" ? "✅" : w.status === "paused" ? "⏸" : "⏳";
      return `${st} <b>${esc(w.title)}</b>${offered ? ` · ${held}/${offered} episodes` : ""}${w.note ? `\n   <i>${esc(w.note)}</i>` : ""}`;
    });
    await ctx.reply(["📺 <b>Series wishlist</b>", "", ...lines].join("\n"), { parse_mode: "HTML" });
  }));

  bot.command("requests", admin(async (ctx) => {
    const v = await requestsView();
    await ctx.reply(v.text, { parse_mode: "HTML", ...(v.keyboard || {}) });
  }));

  bot.action(/^adm_fetch_(\d+)$/, async (ctx, next) => {
    if (!isAdminTelegramId(ctx.from?.id)) return next();
    const title = await titleOfRequest(Number(ctx.match[1]));
    if (!title) return void (await ctx.answerCbQuery("That request is gone."));
    const p = parseMediaTitleAndSeriesInfo(title);
    await submitJob({ kind: "movie", title: p.cleanTitle || title, year: p.year || null, priority: PRIORITY.admin, source: "admin", requestedBy: `tg:${ctx.from!.id}` });
    await ctx.answerCbQuery("Queued. I'll message you when it's done.");
  });

  bot.action(/^adm_ready_(\d+)$/, async (ctx, next) => {
    if (!isAdminTelegramId(ctx.from?.id)) return next();
    const title = await titleOfRequest(Number(ctx.match[1]));
    if (!title) return void (await ctx.answerCbQuery("That request is gone."));
    const rows = (await db.execute({ sql: "SELECT id, telegram_id FROM requests WHERE LOWER(title)=LOWER(?) AND status IN ('pending','waiting')", args: [title] })).rows as any[];
    await markRequestsFulfilled(rows.map((r) => Number(r.id)));
    let told = 0;
    for (const r of rows) {
      if (!/^\d+$/.test(String(r.telegram_id))) continue;
      await ctx.telegram.sendMessage(r.telegram_id, `🎉 <b>${esc(title)}</b> is ready. Search for it in the bot to watch.`, { parse_mode: "HTML" }).then(() => told++).catch(() => undefined);
    }
    await ctx.answerCbQuery(`Marked ready. ${told} viewer${told === 1 ? "" : "s"} told.`);
    const v = await requestsView();
    await ctx.editMessageText(v.text, { parse_mode: "HTML", ...(v.keyboard || {}) }).catch(() => undefined);
  });

  const gateView = async () => {
    const s = await getGateSettings();
    const ch = await listGateChannels();
    const st = await gateStats();
    const text = [
      `🔒 <b>Required channels</b>: ${s.enabled ? "ON" : "off"}`,
      ...ch.map((c) => `${c.active ? "•" : "◦"} ${esc(c.title)} <i>(${c.kind})</i>`),
      ch.length ? "" : "No channels yet. Add them in the admin dashboard.",
      `Asked ${st.prompted} · joined ${st.joined} · sent automatically ${st.resumed}`,
    ].join("\n");
    return { text, keyboard: Markup.inlineKeyboard([[Markup.button.callback(s.enabled ? "Turn off" : "Turn on", s.enabled ? "adm_gate_off" : "adm_gate_on")]]) };
  };
  bot.command("gate", admin(async (ctx) => { const v = await gateView(); await ctx.reply(v.text, { parse_mode: "HTML", ...v.keyboard }); }));
  bot.action(/^adm_gate_(on|off)$/, async (ctx, next) => {
    if (!isAdminTelegramId(ctx.from?.id)) return next();
    const on = ctx.match[1] === "on";
    if (on && !(await listGateChannels(true)).length) return void (await ctx.answerCbQuery("Add a channel first (admin dashboard).", { show_alert: true }));
    await saveGateSettings({ enabled: on });
    await ctx.answerCbQuery(on ? "Viewers will be asked to join." : "Gate is off.");
    const v = await gateView();
    await ctx.editMessageText(v.text, { parse_mode: "HTML", ...v.keyboard }).catch(() => undefined);
  });
}
