/**
 * Reaching viewers outside the private chat:
 *  - inline mode: "@bot title" in any chat shows matching titles with a button that opens them in the bot
 *  - groups: add the bot to a group; it answers /movie, /search, @mentions and replies, and every result is a button that
 *    opens the title in a private chat (files are never dropped into a group)
 */
import { Markup, Telegraf } from "telegraf";
import { isAdminTelegramId } from "../server/auth.js";
import { esc } from "./messages.js";
import { botLink, findHits, hitLabel, hitLink, parseGroupTrigger, recentHits, type DiscoveryDeps, type Hit } from "./discovery.js";

const posterUrl = (p?: string | null) => (p ? (p.startsWith("http") ? p : `https://image.tmdb.org/t/p/w185${p}`) : undefined);

export function inlineResult(h: Hit, botUsername: string, idx: number) {
  const link = hitLink(h, botUsername);
  const status = h.inVault ? `✅ <b>Available on BusiMovie</b>${h.qualities.length ? ` · ${h.qualities.join(", ")}` : ""}` : "📝 Not in the library yet. Tap below to request it.";
  return {
    type: "article" as const,
    id: `${idx}-${h.inVault ? h.watchId : h.tmdbId}`.slice(0, 60),
    title: hitLabel(h),
    description: h.inVault ? `${h.kind === "series" ? "Series" : "Movie"} · ${h.qualities.join(", ") || "HD"}` : (h.overview || "Request this title").slice(0, 90),
    thumbnail_url: posterUrl(h.poster),
    input_message_content: {
      message_text: `${h.kind === "series" ? "📺" : "🎬"} <b>${esc(h.title)}</b>${h.year ? ` (${esc(h.year)})` : ""}\n\n${status}`,
      parse_mode: "HTML" as const,
    },
    ...(link ? { reply_markup: Markup.inlineKeyboard([[Markup.button.url(h.inVault ? "▶️ Watch in the bot" : "📝 Request it", link)]]).reply_markup } : {}),
  };
}

export function installReach(bot: Telegraf, deps: DiscoveryDeps) {
  // ── inline mode
  bot.on("inline_query", async (ctx) => {
    try {
      const q = ctx.inlineQuery.query.trim();
      const username = ctx.botInfo.username;
      const hits = q ? await findHits(q, 8, deps) : await recentHits(10);
      await ctx.answerInlineQuery(hits.map((h, i) => inlineResult(h, username, i)) as any, {
        cache_time: q ? 20 : 120,
        is_personal: false,
        button: { text: "Open BusiMovie", start_parameter: "inline" },
      } as any);
    } catch (e: any) {
      console.warn("[inline] failed:", e?.message);
      await ctx.answerInlineQuery([]).catch(() => undefined);
    }
  });

  // ── groups
  const lastAnswer = new Map<string, number>();
  bot.on("my_chat_member", async (ctx, next) => {
    const type = ctx.chat?.type;
    if (type !== "group" && type !== "supergroup") return next();
    const now = (ctx as any).myChatMember?.new_chat_member?.status;
    if (now === "member" || now === "administrator") {
      await ctx.reply(helpText(ctx.botInfo.username), { parse_mode: "HTML" }).catch(() => undefined);
    }
    // never fall through to the storage-channel greeting
  });

  bot.use(async (ctx, next) => {
    const type = ctx.chat?.type;
    if (type !== "group" && type !== "supergroup") return next();
    if (ctx.callbackQuery) {
      if ((ctx.callbackQuery as any).data === "noop") return next();
      await ctx.answerCbQuery("Open me in a private chat to use this.").catch(() => undefined);
      return;
    }
    const text = (ctx.message as any)?.text;
    if (typeof text !== "string") return next(); // uploads etc. keep working (storage groups)
    const replyTo = (ctx.message as any)?.reply_to_message?.from?.id;
    const trig = parseGroupTrigger(text, ctx.botInfo.username, replyTo === ctx.botInfo.id);
    if (!trig) {
      if (isAdminTelegramId(ctx.from?.id) && text.startsWith("/")) return next(); // admins keep /sync, /id, /admin…
      return; // plain chat is none of our business
    }
    if (trig.kind === "help") return void (await ctx.reply(helpText(ctx.botInfo.username), { parse_mode: "HTML" }));
    if (trig.kind === "empty") return void (await ctx.reply("Tell me what to find, for example <code>/movie Inception</code>", { parse_mode: "HTML" }));

    const key = String(ctx.chat!.id);
    const now = Date.now();
    if (now - (lastAnswer.get(key) ?? 0) < 3000) return; // a busy chat can't make us spam
    lastAnswer.set(key, now);

    const hits = await findHits(trig.query, 6, deps);
    const rows = hits.map((h) => ({ h, url: hitLink(h, ctx.botInfo.username) })).filter((x) => x.url).map(({ h, url }) => [Markup.button.url(hitLabel(h), url!)]);
    if (!rows.length) return void (await ctx.reply(`Nothing found for <b>${esc(trig.query)}</b>. Try another spelling.`, { parse_mode: "HTML" }));
    await ctx.reply(`🔎 <b>${esc(trig.query)}</b>\nTap a title to open it in a private chat with me.`, { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) });
  });
}

export const helpText = (botUsername: string) =>
  `🎬 <b>BusiMovie is here.</b>\nSearch from this chat: <code>/movie Inception</code> or <code>@${botUsername} Inception</code>.\nEvery result opens in a private chat with me, so the group stays tidy.`;

export const addToGroupLink = (botUsername: string) => `https://t.me/${botUsername}?startgroup=true`;
export { botLink };
