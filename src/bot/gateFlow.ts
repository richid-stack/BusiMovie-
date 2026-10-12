/**
 * Telegram side of the join gate: the check before a delivery, the "join first" message, and completing the viewer's
 * remembered request the moment they join. See gate.ts for the data side.
 */
import { Context, Markup, Telegraf } from "telegraf";
import { isAdminTelegramId } from "../server/auth.js";
import { alertAdmin } from "../services/alerts.js";
import { M } from "./messages.js";
import {
  checkUser, getGateSettings, joinLinkOf, listGateChannels, logGateEvent, markJoined, markLeft, purgeOldPending,
  savePending, setPendingPrompt, takePending, isMemberStatus, type GateChannel, type Pending, type PendingKind,
} from "./gate.js";

type Deliver = (ctx: any, fileId: number) => Promise<void>;
let botRef: Telegraf | null = null;
let deliverRef: Deliver | null = null;

/** Callback data that ends in a delivery. Browsing steps (search, seasons, version pickers) are never gated. */
export const GATED_CALLBACK = /^(watch_\d+|qep_.+|qall_.+)$/;

/** A Context for a viewer when no update is in hand (we are acting because they just joined). */
async function contextFor(chatId: string, user: any): Promise<Context> {
  const bot = botRef!;
  const info = (bot as any).botInfo ?? (await bot.telegram.getMe());
  const update: any = {
    update_id: 0,
    message: { message_id: 0, date: Math.floor(Date.now() / 1000), chat: { id: Number(chatId), type: Number(chatId) > 0 ? "private" : "supergroup" }, from: user, text: "" },
  };
  return new Context(update, bot.telegram, info);
}

function keyboard(missing: GateChannel[]) {
  const rows: any[] = missing
    .map((c) => ({ c, url: joinLinkOf(c) }))
    .filter((x) => x.url)
    .map(({ c, url }) => [Markup.button.url(`${c.kind === "ads" ? "📣" : c.kind === "discussion" ? "💬" : "➕"} Join ${c.title}`, url as string)]);
  rows.push([Markup.button.callback("✅ I've joined", "gate_ok")]);
  return Markup.inlineKeyboard(rows);
}

/**
 * True when the viewer may continue. Otherwise the "join first" message has been sent and the request remembered;
 * the caller must stop. `chatMember`s of channels the bot cannot read never block (the admin is told instead).
 */
export async function gateOk(ctx: any, what: { kind: PendingKind; payload: any }): Promise<boolean> {
  try {
    const user = ctx.from;
    if (!user || !botRef) return true;
    if (isAdminTelegramId(user.id)) return true;
    const settings = await getGateSettings();
    if (!settings.enabled) return true;

    const { missing, broken } = await checkUser(ctx.telegram, user.id);
    for (const b of broken) {
      void alertAdmin(`gate-broken:${b.chat_id}`, `⚠️ Required channel "${b.title}" can't be checked, so viewers aren't being asked to join it. Make the bot an admin there (Admin → Required channels → Test).`, 6 * 3_600_000);
    }
    if (!missing.length) return true;

    const chatId = String(ctx.chat?.id ?? user.id);
    await savePending({ userId: String(user.id), chatId, kind: what.kind, payload: { ...what.payload, from: user }, promptMsgId: null });
    if (ctx.callbackQuery) await ctx.answerCbQuery("Join first, then I'll send it").catch(() => undefined);
    const sent = await ctx.telegram.sendMessage(chatId, M.gateAsk(missing.map((m) => m.kind)), { parse_mode: "HTML", ...keyboard(missing) });
    await setPendingPrompt(String(user.id), sent.message_id);
    await logGateEvent(user.id, null, "prompted");
    return false;
  } catch (e: any) {
    console.warn("[gate] check failed, letting the viewer through:", e?.message);
    return true; // never block people because of our own error
  }
}

/** Complete whatever the viewer was waiting for. Returns true when something was resumed. */
export async function resumeFor(userId: string | number, opts: { announce?: boolean } = {}): Promise<boolean> {
  const bot = botRef;
  if (!bot) return false;
  const p: Pending | null = await takePending(userId);
  if (!p) return false;
  await logGateEvent(userId, null, "resumed");
  if (p.promptMsgId) await bot.telegram.deleteMessage(p.chatId, p.promptMsgId).catch(() => undefined);
  if (opts.announce !== false) await bot.telegram.sendMessage(p.chatId, M.gateThanks, { parse_mode: "HTML" }).catch(() => undefined);
  try {
    if (p.kind === "file") {
      const ctx = await contextFor(p.chatId, p.payload.from);
      await deliverRef!(ctx, Number(p.payload.fileId));
    } else {
      // Replay the button they pressed. The original message is still there, so editing it works as before.
      await bot.handleUpdate({
        update_id: 0,
        callback_query: {
          id: `resume:${Date.now()}`,
          from: p.payload.from,
          chat_instance: "resume",
          data: p.payload.data,
          message: { message_id: p.payload.messageId, date: Math.floor(Date.now() / 1000), chat: { id: Number(p.chatId), type: p.payload.chatType || "private" } },
        },
      } as any);
    }
  } catch (e: any) {
    console.warn("[gate] could not complete the request:", e?.message);
    await bot.telegram.sendMessage(p.chatId, "Sorry, that didn't go through. Tap the title again and it will send.", {}).catch(() => undefined);
  }
  return true;
}

export function installGate(bot: Telegraf, deliver: Deliver) {
  botRef = bot;
  deliverRef = deliver;
  setInterval(() => void purgeOldPending().catch(() => undefined), 10 * 60_000).unref?.();

  // A replayed button has no real callback id: answering it must be a no-op.
  bot.use((ctx, next) => {
    if (ctx.callbackQuery?.id?.startsWith("resume:")) (ctx as any).answerCbQuery = async () => true;
    return next();
  });

  // Gate the buttons that end in a delivery.
  bot.use(async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data || !GATED_CALLBACK.test(data) || ctx.callbackQuery?.id?.startsWith("resume:")) return next();
    const msg: any = (ctx.callbackQuery as any).message;
    const ok = await gateOk(ctx, { kind: "callback", payload: { data, messageId: msg?.message_id, chatType: msg?.chat?.type } });
    if (!ok) return;
    return next();
  });

  // "I've joined": verify for real, then complete the request.
  bot.action("gate_ok", async (ctx) => {
    const user = ctx.from;
    if (!user) return;
    const { missing } = await checkUser(ctx.telegram, user.id, { fresh: true });
    if (missing.length) {
      await ctx.answerCbQuery(M.gateStillMissing(missing.map((m) => m.title)).replace(/<[^>]+>/g, ""), { show_alert: true }).catch(() => undefined);
      return;
    }
    await ctx.answerCbQuery("Thanks!").catch(() => undefined);
    await logGateEvent(user.id, null, "joined");
    if (!(await resumeFor(user.id))) {
      await ctx.reply(M.gateNothingWaiting, { parse_mode: "HTML" }).catch(() => undefined);
    }
  });

  // Telegram tells us the moment someone joins or leaves a channel the bot administers.
  bot.on("chat_member", async (ctx, next) => {
    try {
      const u: any = (ctx as any).chatMember;
      const chatId = String(u?.chat?.id ?? "");
      const user = u?.new_chat_member?.user;
      if (!chatId || !user) return next();
      const gate = (await listGateChannels(true)).find((c) => c.chat_id === chatId || (c.username && u.chat?.username && c.username.toLowerCase() === String(u.chat.username).toLowerCase()));
      if (!gate) return next();
      if (isMemberStatus(u.new_chat_member)) {
        await markJoined(user.id, gate.chat_id);
        await logGateEvent(user.id, gate.chat_id, "joined");
        const { missing } = await checkUser(ctx.telegram, user.id);
        if (!missing.length) await resumeFor(user.id);
      } else {
        await markLeft(user.id, gate.chat_id);
      }
    } catch (e: any) {
      console.warn("[gate] chat_member handling failed:", e?.message);
    }
    return next();
  });

  // Join-request channels: approve at once (viewers asked through our own button), then complete their request.
  bot.on("chat_join_request", async (ctx, next) => {
    try {
      const r: any = (ctx as any).chatJoinRequest;
      const chatId = String(r?.chat?.id ?? "");
      const gate = (await listGateChannels(true)).find((c) => c.chat_id === chatId);
      if (!gate || gate.mode !== "request") return next();
      await ctx.telegram.approveChatJoinRequest(chatId, r.from.id);
      await markJoined(r.from.id, gate.chat_id);
      await logGateEvent(r.from.id, gate.chat_id, "joined");
      const { missing } = await checkUser(ctx.telegram, r.from.id);
      if (!missing.length) await resumeFor(r.from.id);
    } catch (e: any) {
      console.warn("[gate] join request handling failed:", e?.message);
    }
    return next();
  });
}
