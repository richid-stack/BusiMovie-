/**
 * Real Telegram transport (GramJS). Event-driven: we listen for NEW and EDITED messages from the
 * bot instead of polling "the latest 5 messages", so we see the screen the bot actually shows,
 * including screens it edits in place.
 */
import { TelegramClient, Api } from "telegram";
import { NewMessage } from "telegram/events/NewMessage.js";
import { EditedMessage } from "telegram/events/EditedMessage.js";
import { Button, MediaInfo, Screen, makeScreen } from "./screen.js";
import type { Observation, Transport } from "./navigator.js";
import { Pacer, sleep, tg } from "./flood.js";

const VIDEO_EXT = /\.(mkv|mp4|avi|mov|webm|m4v|ts|wmv|flv)$/i;

export function mediaOf(m: any): MediaInfo | undefined {
  const doc = m?.document ?? m?.media?.document;
  if (!doc || doc.className === "DocumentEmpty") return undefined;
  const attrs: any[] = doc.attributes || [];
  const fileName = attrs.find((a) => a.className === "DocumentAttributeFilename")?.fileName as string | undefined;
  const video = attrs.find((a) => a.className === "DocumentAttributeVideo");
  const mime = String(doc.mimeType || "");
  const isVideo = Boolean(video) || mime.startsWith("video/") || mime === "application/x-matroska" || (fileName ? VIDEO_EXT.test(fileName) : false);
  if (!isVideo) return undefined; // stickers, images, subtitles and PDFs are not what we're after
  return { fileName, size: Number(doc.size || 0), mime, isVideo, durationSec: video?.duration ? Number(video.duration) : undefined };
}

export function buttonsOf(m: any): Button[] {
  const out: Button[] = [];
  const rows: any[] = m?.replyMarkup?.rows || [];
  rows.forEach((row, r) =>
    (row.buttons || []).forEach((b: any, c: number) => {
      const data = b.data ? (Buffer.isBuffer(b.data) ? b.data.toString("utf8") : String(b.data)) : undefined;
      out.push({ text: String(b.text ?? ""), row: r, col: c, data, url: b.url ? String(b.url) : undefined });
    })
  );
  return out;
}

export function screenOfMessage(m: any): Screen {
  return makeScreen({
    msgId: Number(m.id),
    text: String(m.message ?? m.text ?? ""),
    buttons: buttonsOf(m),
    media: mediaOf(m),
    editedAt: m.editDate ? Number(m.editDate) * 1000 : undefined,
  });
}

export interface GramTransportOptions {
  /** how long the bot must be quiet before we call the screen "settled" */
  quietMs?: number;
  minGapMs?: number;
  firstReplyMs?: number;
}

export class GramTransport implements Transport {
  private inbox = new Map<number, Screen>();
  private lastEventAt = 0;
  private botId: string;
  private handlers: Array<[(e: any) => void, any]> = [];
  private pacer: Pacer;
  private quietMs: number;
  private firstReplyMs: number;
  /** raw messages by id, so callers can forward the exact message later */
  readonly raw = new Map<number, any>();

  constructor(private client: TelegramClient, private botEntity: any, opts: GramTransportOptions = {}) {
    this.botId = String(botEntity.id);
    this.pacer = new Pacer(opts.minGapMs ?? 1200);
    this.quietMs = opts.quietMs ?? 1500;
    this.firstReplyMs = opts.firstReplyMs ?? 12_000;
  }

  start() {
    const onMsg = (event: any) => {
      const m = event?.message;
      if (!m || m.out) return;
      const from = String(m.peerId?.userId ?? m.senderId ?? "");
      if (from !== this.botId) return;
      const s = screenOfMessage(m);
      this.raw.set(s.msgId, m);
      this.inbox.delete(s.msgId); // newest version goes last
      this.inbox.set(s.msgId, s);
      this.lastEventAt = Date.now();
    };
    const nm = new NewMessage({});
    const em = new EditedMessage({});
    this.client.addEventHandler(onMsg, nm);
    this.client.addEventHandler(onMsg, em);
    this.handlers = [[onMsg, nm], [onMsg, em]];
  }

  stop() {
    for (const [h, ev] of this.handlers) {
      try { this.client.removeEventHandler(h, ev); } catch { /* already gone */ }
    }
    this.handlers = [];
  }

  private drain(): Screen[] {
    const out = Array.from(this.inbox.values());
    this.inbox.clear();
    return out;
  }

  /** Wait until the bot has said something and then gone quiet (or media arrived, or we ran out of time). */
  private async collect(timeoutMs: number): Promise<Screen[]> {
    const begin = Date.now();
    while (Date.now() - begin < timeoutMs) {
      await sleep(150);
      if (this.inbox.size === 0) continue;
      const quiet = Date.now() - this.lastEventAt;
      const hasMedia = Array.from(this.inbox.values()).some((s) => s.media);
      if (quiet >= (hasMedia ? 500 : this.quietMs)) break;
    }
    return this.drain();
  }

  async send(text: string): Promise<Observation> {
    await this.pacer.wait();
    this.inbox.clear();
    await tg(() => this.client.sendMessage(this.botEntity, { message: text }));
    return { screens: await this.collect(this.firstReplyMs) };
  }

  async click(screen: Screen, b: Button): Promise<Observation> {
    if (b.data === undefined) return { screens: [] }; // url / switch-inline buttons cannot be pressed from here
    await this.pacer.wait();
    this.inbox.clear();
    let answer: string | undefined;
    try {
      const res: any = await tg(() =>
        Promise.race([
          this.client.invoke(new Api.messages.GetBotCallbackAnswer({ peer: this.botEntity, msgId: screen.msgId, data: Buffer.from(b.data!, "utf8") })),
          sleep(15_000).then(() => { throw new Error("BOT_RESPONSE_TIMEOUT"); }),
        ])
      );
      answer = res?.message || undefined;
    } catch (e: any) {
      // Many bots never answer the callback and just edit the message; that's fine, events tell us what happened.
      if (!/BOT_RESPONSE_TIMEOUT|DATA_INVALID|MESSAGE_ID_INVALID/i.test(String(e?.message || e?.errorMessage || ""))) throw e;
    }
    return { screens: await this.collect(this.firstReplyMs), answer };
  }

  async settle(_after: Screen | null, timeoutMs: number): Promise<Observation> {
    return { screens: await this.collect(timeoutMs) };
  }

  async join(target: string): Promise<boolean> {
    const inv = target.match(/t\.me\/(?:\+|joinchat\/)([\w-]+)/i);
    try {
      if (inv) {
        await tg(() => this.client.invoke(new Api.messages.ImportChatInvite({ hash: inv[1] })));
        return true;
      }
      const uname = target.match(/(?:t\.me\/|^@)([A-Za-z][\w]{3,31})/i)?.[1];
      if (!uname || /bot$/i.test(uname)) return false; // never "join" a bot
      await tg(async () => this.client.invoke(new Api.channels.JoinChannel({ channel: await this.client.getInputEntity(uname) })));
      return true;
    } catch (e: any) {
      const msg = String(e?.errorMessage || e?.message || "");
      if (/USER_ALREADY_PARTICIPANT/i.test(msg)) return true;
      return false; // INVITE_REQUEST_SENT, expired link, banned… the navigator reports "blocked: gate"
    }
  }
}
