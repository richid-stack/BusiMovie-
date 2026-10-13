/**
 * "I can't remember the name": viewers describe a film, send a voice note, or send a poster / screenshot, and the
 * bot suggests titles to search for. Powered by Gemini (GEMINI_API_KEY). Each viewer gets a short allowance per day
 * so the free AI quota is shared fairly.
 */
import axios from "axios";
import { Markup, Telegraf } from "telegraf";
import { aiFinderAvailable, identifyTitles, type IdentifiedTitle } from "../services/gemini.js";
import { isAdminTelegramId } from "../server/auth.js";
import { esc } from "./messages.js";

export const FINDS_PER_DAY = 12;
const MAX_BYTES = 8 * 1024 * 1024;

// ── pure helpers (unit-tested) ─────────────────────────────────────────────
/** A query that reads like a description rather than a title: several words, or a plot-ish sentence. */
export function looksLikeDescription(q: string): boolean {
  const t = q.trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words >= 7) return true;
  return words >= 4 && /\b(where|about|movie|film|who|that|with|there was|remember|the one|starring|scene|ending)\b/i.test(t);
}
export const searchTextFor = (t: IdentifiedTitle) => `${t.title}${t.year ? ` ${t.year}` : ""}`;

/** How many AI finds a viewer has left today. */
export class DailyAllowance {
  private days = new Map<string, number>();
  constructor(private limit = FINDS_PER_DAY) {}
  private key(id: number | string, now: Date) { return `${now.toISOString().slice(0, 10)}:${id}`; }
  take(id: number | string, now = new Date()): boolean {
    const k = this.key(id, now);
    const n = this.days.get(k) || 0;
    if (n >= this.limit) return false;
    this.days.set(k, n + 1);
    if (this.days.size > 5000) for (const key of this.days.keys()) { if (!key.startsWith(now.toISOString().slice(0, 10))) this.days.delete(key); }
    return true;
  }
}

interface Suggestion { titles: IdentifiedTitle[]; at: number }

export function installFinder(bot: Telegraf, deps: { search: (ctx: any, query: string) => Promise<void> }) {
  const allowance = new DailyAllowance();
  const pending = new Map<string, Suggestion>();
  const token = () => Math.random().toString(36).slice(2, 8);

  const present = async (ctx: any, heard: string | undefined, titles: IdentifiedTitle[]) => {
    if (!titles.length) {
      await ctx.reply("🤔 I couldn't tell which title that is. Try adding an actor, the year, or something that happens in it. Or type the title if you have a guess.");
      return;
    }
    const t = token();
    pending.set(t, { titles, at: Date.now() });
    for (const [k, v] of pending) if (Date.now() - v.at > 30 * 60_000) pending.delete(k);
    await ctx.reply(`${heard ? `🎧 <i>${esc(heard)}</i>\n\n` : ""}Is it one of these?`, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(titles.map((x, i) => [Markup.button.callback(`${x.kind === "tv" ? "📺" : "🎬"} ${x.title}${x.year ? ` (${x.year})` : ""}`.slice(0, 60), `idf_${t}_${i}`)])),
    });
  };

  const run = async (ctx: any, input: Parameters<typeof identifyTitles>[0]) => {
    if (!aiFinderAvailable()) return void (await ctx.reply("Smart search isn't switched on yet. Type the title and I'll find it."));
    if (!isAdminTelegramId(ctx.from?.id) && !allowance.take(ctx.from.id)) {
      return void (await ctx.reply(`You've used today's ${FINDS_PER_DAY} smart searches. Searching by title still works, and smart search resets tomorrow.`));
    }
    const wait = await ctx.reply("🔎 Working out which title that is…").catch(() => null);
    try {
      const r = await identifyTitles(input);
      await present(ctx, r?.heard, r?.titles || []);
    } catch (e: any) {
      console.warn("[Finder] failed:", e?.message);
      await ctx.reply("Smart search is busy right now. Try again in a minute, or type the title.").catch(() => undefined);
    } finally {
      if (wait) await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => undefined);
    }
  };

  const download = async (ctx: any, fileId: string, size?: number): Promise<Buffer | null> => {
    if (size && size > MAX_BYTES) return null;
    const link = await ctx.telegram.getFileLink(fileId);
    const r = await axios.get(String(link), { responseType: "arraybuffer", maxContentLength: MAX_BYTES, timeout: 20_000 });
    return Buffer.from(r.data);
  };

  bot.on("voice", async (ctx: any, next) => {
    if (ctx.chat?.type !== "private") return next();
    const v = ctx.message.voice;
    const data = await download(ctx, v.file_id, v.file_size).catch(() => null);
    if (!data) return void (await ctx.reply("I couldn't read that voice note. Keep it under a minute and try again."));
    await run(ctx, { media: { data, mime: v.mime_type || "audio/ogg" } });
  });

  bot.on("photo", async (ctx: any, next) => {
    if (ctx.chat?.type !== "private") return next();
    const sizes = ctx.message.photo as Array<{ file_id: string; file_size?: number }>;
    const best = [...sizes].reverse().find((p) => !p.file_size || p.file_size <= MAX_BYTES) || sizes[0];
    const data = await download(ctx, best.file_id, best.file_size).catch(() => null);
    if (!data) return void (await ctx.reply("I couldn't open that picture. Try sending it again."));
    await run(ctx, { text: ctx.message.caption, media: { data, mime: "image/jpeg" } });
  });

  bot.action(/^idf_(\w+)_(\d)$/, async (ctx) => {
    const s = pending.get(ctx.match[1]);
    const pick = s?.titles[Number(ctx.match[2])];
    if (!s || !pick) return void (await ctx.answerCbQuery("That list expired. Send it again.", { show_alert: true }));
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
    await deps.search(ctx, searchTextFor(pick));
  });

  /** Called when a typed search found nothing and reads like a description. true = handled. */
  return async (ctx: any, query: string): Promise<boolean> => {
    if (!aiFinderAvailable() || !looksLikeDescription(query)) return false;
    await run(ctx, { text: query });
    return true;
  };
}
