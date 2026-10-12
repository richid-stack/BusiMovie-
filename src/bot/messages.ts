/**
 * Every sentence the Telegram bot says to a viewer lives here.
 *
 * House rules (so no future edit re-introduces the old problems):
 *  - Say what is happening or what the viewer can do. Never describe how it works.
 *  - Never mention: other bots, channel ids, "relay", "nodes", "ingest", "acquisition", "userbot", "vault".
 *  - Never show raw error text. Log it; show a calm, specific next step instead.
 *  - Progress is only shown when it is real. No fake "Step 2/4".
 *  - Titles go through esc() before they reach HTML.
 */

export const DAILY_REQUEST_LIMIT = Math.max(1, Number(process.env.DAILY_REQUEST_LIMIT || 5));

export function esc(text: string): string {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const epTag = (s?: number, e?: number) =>
  s !== undefined && e !== undefined ? `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}` : "";

export const M = {
  // ── Join gate ──────────────────────────────────────────────
  gateAsk: (kinds: Array<"discussion" | "ads" | "general">) =>
    `🔒 <b>One quick step</b>\nJoin ${kinds.length > 1 ? "these channels" : "this channel"} and your pick is sent here automatically, no need to ask again.`,
  gateStillMissing: (names: string[]) =>
    `Not yet: I can't see you in ${names.map(esc).join(", ")}. Join, then tap the button again.`,
  gateThanks: "✅ <b>Thanks for joining.</b> Here it comes…",
  gateNothingWaiting: "✅ You're all set. Go ahead and pick something to watch.",
  // ── Requests ───────────────────────────────────────────────
  searching: (title: string) =>
    `🔎 <b>Looking for ${esc(title)}…</b>\nThis can take up to a minute.`,

  found: (title: string) =>
    `📥 <b>Found it.</b> Getting ${esc(title)} ready for you…`,

  chooseVersion: (title: string) =>
    `🎬 <b>${esc(title)}</b> is available in more than one version.\nPick the one you want:`,

  notAvailable: (title: string) =>
    `🎬 <b>${esc(title)}</b> isn't available yet.\n\n✅ Your request is saved. We'll message you as soon as it's added.`,

  seriesNotAvailable: (title: string) =>
    `📺 <b>${esc(title)}</b> isn't available yet.\n\n✅ Your request is saved. We'll message you when the first episode is added.`,

  takingLonger: (title: string) =>
    `⏳ <b>${esc(title)}</b> is taking longer than usual.\n\nYour request is saved. We'll message you as soon as it's ready.`,

  readyToWatch: (title: string) =>
    `🎬 <b>${esc(title)}</b> is ready.`,

  dailyLimit: () =>
    `❌ <b>Daily limit reached</b>\n\nYou can make up to ${DAILY_REQUEST_LIMIT} requests a day. The limit resets at midnight UTC.`,

  dailyLimitToast: () => `Daily limit reached (${DAILY_REQUEST_LIMIT} requests). Try again tomorrow.`,

  requestUsage: () =>
    `📝 <b>Request a movie or show</b>\n\nSend: <code>/request Movie Title</code>\nExample: <code>/request Interstellar</code>`,

  // ── Episodes & seasons ─────────────────────────────────────
  episodeGetting: (title: string, s: number, e: number) =>
    `📥 <b>Getting ${esc(title)} ${epTag(s, e)}…</b>\nYour episode will arrive in a moment.`,

  episodeNotAvailable: (title: string, s: number, e: number) =>
    `📺 <b>${esc(title)} ${epTag(s, e)}</b> isn't available yet.\n\nWe'll message you as soon as it's added.`,

  episodeDelayed: (title: string, s: number, e: number) =>
    `⏳ <b>${esc(title)} ${epTag(s, e)}</b> is taking longer than usual.\n\nTry again in a moment.`,

  episodeListUnavailable: (title: string, s: number) =>
    `📺 <b>${esc(title)} — Season ${s}</b>\nWe couldn't load the episode list just now. Please try again in a moment.`,

  seasonStarting: (title: string, s: number) =>
    `📦 <b>Getting Season ${s} of ${esc(title)}…</b>\nEpisodes will be sent to you as they become ready.`,

  seasonProgress: (title: string, s: number, count: number) =>
    `📦 <b>Season ${s} of ${esc(title)}</b>\n<b>${count}</b> episode${count === 1 ? "" : "s"} ready so far…`,

  seasonDone: (title: string, s: number, count: number) =>
    `✅ <b>Season ${s} of ${esc(title)}</b> is ready.\n<b>${count}</b> episode${count === 1 ? "" : "s"} added.`,

  seasonNone: (title: string, s: number) =>
    `⚠️ We couldn't get Season ${s} of <b>${esc(title)}</b> just now.\nYou can still pick individual episodes.`,

  seasonDelayed: (_title: string, s: number) =>
    `⏳ Season ${s} is taking longer than usual. You can pick individual episodes while we keep trying.`,

  seriesPickSeason: (title: string) =>
    `📺 <b>${esc(title)}</b>\nChoose a season:`,

  seriesNeedsRequest: (title: string) =>
    `📺 <b>${esc(title)}</b>\n\nWe don't have this series yet. Would you like to request it?`,

  // ── Delivery ───────────────────────────────────────────────
  deliveryFailed: (title: string, s?: number, e?: number) =>
    `⚠️ <b>Couldn't send ${esc(title)}${s !== undefined && e !== undefined ? " " + epTag(s, e) : ""}</b> just now.\nPlease try again.`,

  fileCaption: (o: { title: string; year?: string | number; season?: number | null; episode?: number | null; quality?: string; size: string }) =>
    `${o.season && o.episode ? "📺" : "🎬"} <b>${esc(o.title)}</b>${o.year ? ` (${o.year})` : ""}` +
    `${o.season && o.episode ? `\n📺 Season ${o.season}, Episode ${o.episode}` : ""}` +
    `\n🎞 ${esc(o.quality || "HD")}  •  💾 ${o.size}` +
    `\n\n⏳ This message disappears in 2 minutes. Forward it to Saved Messages to keep it.`,

  notifyReady: (title: string, year: string | undefined, quality: string) =>
    `🎉 <b>Your request is ready</b>\n\n🎬 <b>${esc(title)}</b>${year ? ` (${year})` : ""}\n🎞 ${esc(quality)}\n\nTap below to watch.`,

  // ── Generic ────────────────────────────────────────────────
  genericError: () => `⚠️ Something went wrong on our side. Please try again in a moment.`,
  selectionExpired: () => `This selection has expired. Please search again.`,
};
