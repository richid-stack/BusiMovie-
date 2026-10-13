/** Keeps banned viewers out and enforces the daily delivery cap. Admins are never affected. */
import { Telegraf } from "telegraf";
import { isAdminTelegramId } from "../server/auth.js";
import { isBanned, refundDelivery, takeDelivery } from "../services/moderation.js";

const told = new Map<number, number>();

export function installGuard(bot: Telegraf) {
  bot.use(async (ctx: any, next) => {
    const uid = ctx.from?.id;
    if (!uid || ctx.from?.is_bot || isAdminTelegramId(uid)) return next();
    if (!(await isBanned(uid).catch(() => false))) return next();
    // Say it once in a while, never loop, never run anything for them.
    if (ctx.chat?.type === "private" && Date.now() - (told.get(uid) || 0) > 10 * 60_000) {
      told.set(uid, Date.now());
      await ctx.reply("This account can't use the bot.").catch(() => undefined);
    }
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => undefined);
  });
}

/** Call right before sending a file. false = already told the viewer why not. */
export async function allowDelivery(ctx: any): Promise<boolean> {
  const uid = ctx.from?.id;
  if (!uid || isAdminTelegramId(uid)) return true;
  const r = await takeDelivery(uid).catch(() => ({ ok: true, used: 0, cap: 0 }));
  if (r.ok) return true;
  await ctx.reply(`⏳ You've reached today's limit of <b>${r.cap}</b> file${r.cap === 1 ? "" : "s"}. It resets at midnight UTC. Come back tomorrow and it'll be waiting.`, { parse_mode: "HTML" }).catch(() => undefined);
  return false;
}
export const giveBackDelivery = (ctx: any) => (ctx.from?.id && !isAdminTelegramId(ctx.from.id) ? refundDelivery(ctx.from.id).catch(() => undefined) : Promise.resolve());
