/** Admin-side helpers for the join gate: look at a channel through the bot and prepare a join link. */
import type { Telegraf } from "telegraf";
import { updateGateChannel, type GateChannel } from "./gate.js";

export interface Inspection {
  ok: boolean;
  title?: string;
  username?: string | null;
  isAdmin: boolean;
  canInvite: boolean;
  problem?: string;
}

/** Plain-English reasons for the errors Telegram gives when the bot isn't set up in a channel. */
export function explainTelegramError(msg: string): string {
  const m = String(msg || "");
  if (/chat not found/i.test(m)) return "Telegram can't find that channel. Check the id, and make sure the bot has been added to it.";
  if (/not enough rights|CHAT_ADMIN_REQUIRED|administrator rights/i.test(m)) return "The bot needs to be an administrator of that channel (with permission to invite users).";
  if (/kicked|forbidden|not a member/i.test(m)) return "The bot isn't in that channel. Add it as an administrator.";
  return m.replace(/^\d+:\s*/, "") || "Telegram refused the request.";
}

export async function inspectChannel(bot: Telegraf, chatId: string): Promise<Inspection> {
  try {
    const chat: any = await bot.telegram.getChat(chatId);
    const me = await bot.telegram.getMe();
    let status = "";
    let canInvite = false;
    try {
      const m: any = await bot.telegram.getChatMember(chatId, me.id);
      status = m.status;
      canInvite = status === "creator" || (status === "administrator" && m.can_invite_users !== false);
    } catch { /* not a member */ }
    const isAdmin = status === "administrator" || status === "creator";
    return {
      ok: isAdmin,
      title: chat.title,
      username: chat.username ?? null,
      isAdmin,
      canInvite,
      problem: isAdmin ? undefined : "The bot isn't an administrator there, so it can't see who has joined. Add it as an admin (it only needs the invite-users permission).",
    };
  } catch (e: any) {
    return { ok: false, isAdmin: false, canInvite: false, problem: explainTelegramError(e?.message) };
  }
}

/** Create the link viewers will tap. Public channels use their @name unless they want join-request mode. */
export async function ensureInviteLink(bot: Telegraf, ch: GateChannel): Promise<string | null> {
  if (ch.invite_link) return ch.invite_link;
  if (ch.username && ch.mode === "check") return `https://t.me/${ch.username}`;
  try {
    const link: any = await bot.telegram.createChatInviteLink(ch.chat_id, { name: "BusiMovie", creates_join_request: ch.mode === "request" });
    if (link?.invite_link) { await updateGateChannel(ch.id, { invite_link: link.invite_link }); return link.invite_link; }
  } catch { /* the admin can paste a link by hand */ }
  return null;
}
