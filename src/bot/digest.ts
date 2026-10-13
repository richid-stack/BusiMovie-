/**
 * Weekly "new this week" message. Off until the admin switches it on (Admin → Messaging). Goes out Friday evening
 * (UTC), once a week, to viewers who haven't opted out. One tap on the message stops it for good.
 */
import { Markup, Telegraf } from "telegraf";
import { db, getSetting, setSetting } from "../db/index.js";
import { isAdminTelegramId } from "../server/auth.js";
import { listBans } from "../services/moderation.js";
import { esc } from "./messages.js";

export interface NewRow { movie_title: string; year?: string | null; season?: number | null; episode?: number | null; quality?: string | null }

// ── pure helpers (unit-tested) ─────────────────────────────────────────────
/** Friday from 16:00 UTC, and nothing sent in the last 5 days. */
export function isDigestDue(now: Date, lastSentMs: number | null): boolean {
  if (now.getUTCDay() !== 5 || now.getUTCHours() < 16) return false;
  return !lastSentMs || now.getTime() - lastSentMs > 5 * 86_400_000;
}

export function buildDigest(rows: NewRow[], max = 10): { text: string; count: number } | null {
  const movies = new Map<string, { title: string; year: string; q: Set<string> }>();
  const shows = new Map<string, { title: string; seasons: Map<number, number> }>();
  for (const r of rows) {
    const title = String(r.movie_title || "").trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (r.season !== null && r.season !== undefined && r.season !== ("" as any)) {
      const s = shows.get(key) || { title, seasons: new Map() };
      s.seasons.set(Number(r.season), (s.seasons.get(Number(r.season)) || 0) + 1);
      shows.set(key, s);
    } else {
      const m = movies.get(`${key}:${r.year || ""}`) || { title, year: r.year ? String(r.year) : "", q: new Set<string>() };
      if (r.quality) m.q.add(String(r.quality));
      movies.set(`${key}:${r.year || ""}`, m);
    }
  }
  const lines: string[] = [];
  for (const m of movies.values()) lines.push(`🎬 <b>${esc(m.title)}</b>${m.year ? ` (${esc(m.year)})` : ""}${m.q.size ? ` · ${[...m.q].map(esc).join(" / ")}` : ""}`);
  for (const s of shows.values()) {
    const parts = [...s.seasons.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `S${n} ${c} ep${c === 1 ? "" : "s"}`);
    lines.push(`📺 <b>${esc(s.title)}</b> · ${parts.join(", ")}`);
  }
  if (!lines.length) return null;
  const shown = lines.slice(0, max);
  const more = lines.length - shown.length;
  return { count: lines.length, text: `🍿 <b>New this week on BusiMovie</b>\n\n${shown.join("\n")}${more > 0 ? `\n…and ${more} more` : ""}\n\nSearch any title to watch it.` };
}

// ── storage ────────────────────────────────────────────────────────────────
let ready: Promise<void> | null = null;
function ensure() {
  ready ??= db.execute(`CREATE TABLE IF NOT EXISTS digest_optout (telegram_id TEXT PRIMARY KEY, reason TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}
export async function digestSettings() {
  const last = Number(await getSetting("digest.last_sent")) || null;
  await ensure();
  const optouts = Number((await db.execute("SELECT COUNT(*) AS n FROM digest_optout")).rows[0]?.n ?? 0);
  return { enabled: (await getSetting("digest.enabled")) === "1", lastSentAt: last, optouts };
}
export async function setDigestEnabled(on: boolean) { await setSetting("digest.enabled", on ? "1" : "0"); }
export async function isOptedOut(id: string | number) { await ensure(); return !!(await db.execute({ sql: "SELECT 1 FROM digest_optout WHERE telegram_id=?", args: [String(id)] })).rows[0]; }
export async function setOptOut(id: string | number, out: boolean, reason?: string) {
  await ensure();
  if (out) await db.execute({ sql: "INSERT OR REPLACE INTO digest_optout (telegram_id, reason) VALUES (?,?)", args: [String(id), reason || "viewer"] });
  else await db.execute({ sql: "DELETE FROM digest_optout WHERE telegram_id=?", args: [String(id)] });
}

export async function newThisWeek(days = 7): Promise<NewRow[]> {
  return (await db.execute({ sql: `SELECT movie_title, year, season, episode, quality FROM media_files WHERE created_at > datetime('now', ?) AND telegram_channel_id <> 'AutoVault' ORDER BY id DESC LIMIT 500`, args: [`-${days} days`] })).rows as unknown as NewRow[];
}
export async function previewDigest() { return buildDigest(await newThisWeek()); }

export async function sendDigest(bot: Telegraf): Promise<{ sent: number; failed: number; total: number; skipped?: string }> {
  const d = buildDigest(await newThisWeek());
  if (!d) return { sent: 0, failed: 0, total: 0, skipped: "Nothing new was added this week." };
  await ensure();
  const out = new Set((await db.execute("SELECT telegram_id FROM digest_optout")).rows.map((r: any) => String(r.telegram_id)));
  const banned = new Set((await listBans()).map((b: any) => String(b.telegram_id)));
  const users = (await db.execute("SELECT telegram_id FROM users")).rows.map((r: any) => String(r.telegram_id)).filter((id) => /^\d+$/.test(id) && !out.has(id) && !banned.has(id));
  let sent = 0, failed = 0;
  const kb = Markup.inlineKeyboard([[Markup.button.callback("🍿 Browse", "browse_library"), Markup.button.callback("🔕 Stop weekly updates", "dg_off")]]);
  for (const id of users) {
    try {
      await bot.telegram.sendMessage(id, d.text, { parse_mode: "HTML", ...kb });
      sent++;
    } catch (e: any) {
      failed++;
      if (e?.response?.error_code === 403) await setOptOut(id, true, "blocked the bot").catch(() => undefined); // never try them again
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  await setSetting("digest.last_sent", String(Date.now()));
  return { sent, failed, total: users.length };
}

export function installDigest(bot: Telegraf) {
  const view = async (id: number) => {
    const out = await isOptedOut(id);
    return {
      text: out ? "🔕 Weekly updates are <b>off</b>." : "🔔 Weekly updates are <b>on</b>: a short list of what's new, once a week.",
      kb: Markup.inlineKeyboard([[Markup.button.callback(out ? "Turn on" : "Turn off", out ? "dg_on" : "dg_off")]]),
    };
  };
  bot.command("weekly", async (ctx) => { const v = await view(ctx.from.id); await ctx.reply(v.text, { parse_mode: "HTML", ...v.kb }); });
  bot.action(/^dg_(on|off)$/, async (ctx) => {
    await setOptOut(ctx.from!.id, ctx.match[1] === "off");
    await ctx.answerCbQuery(ctx.match[1] === "off" ? "Done. No more weekly updates." : "Weekly updates are on.");
    const v = await view(ctx.from!.id);
    await ctx.editMessageText(v.text, { parse_mode: "HTML", ...v.kb }).catch(() => undefined);
  });

  // Admin: /digest (preview) · /digest now · /digest on · /digest off
  bot.command("digest", async (ctx, next) => {
    if (!isAdminTelegramId(ctx.from?.id)) return next();
    const arg = String(ctx.message.text || "").replace(/^\/\w+(@\w+)?\s*/, "").trim().toLowerCase();
    if (arg === "on" || arg === "off") { await setDigestEnabled(arg === "on"); return void (await ctx.reply(arg === "on" ? "✅ The weekly digest is on. It goes out Friday evenings (UTC)." : "✅ The weekly digest is off.")); }
    if (arg === "now") { const r = await sendDigest(bot); return void (await ctx.reply(r.skipped || `Sent to ${r.sent} of ${r.total} viewers${r.failed ? ` (${r.failed} unreachable)` : ""}.`)); }
    const s = await digestSettings(), p = await previewDigest();
    await ctx.reply(`📰 Weekly digest: ${s.enabled ? "ON" : "off"} · ${s.optouts} opted out\n\n${p ? p.text : "Nothing new this week yet."}\n\n<i>/digest on · /digest off · /digest now</i>`, { parse_mode: "HTML" });
  });
}

let timer: NodeJS.Timeout | null = null;
export function startDigestScheduler(bot: Telegraf) {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      const s = await digestSettings();
      if (s.enabled && isDigestDue(new Date(), s.lastSentAt)) { console.log("[Digest] sending weekly digest"); await sendDigest(bot); }
    } catch (e: any) { console.warn("[Digest] skipped:", e?.message); }
  }, 30 * 60_000);
  timer.unref?.();
}
