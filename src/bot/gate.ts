/**
 * Join gate: channels (your community, a discussion group, sponsor/ad channels) a viewer must be in before a file is delivered.
 *
 *  - The admin lists the channels (Admin → Required channels). The bot must be an admin there to see who is a member.
 *  - Before a delivery the bot checks membership. Missing → a short "join first" message with one button per channel,
 *    and the viewer's request is remembered.
 *  - The moment the viewer joins (Telegram tells the bot, or they tap "I've joined") the remembered request is completed
 *    automatically, right in their chat.
 *  - A channel the bot can't read (bot not in it, wrong id) never blocks anyone: it is skipped and the admin is told.
 */
import { db, getSetting, setSetting } from "../db/index.js";

export type GateKind = "discussion" | "ads" | "general";
export type GateMode = "check" | "request";
export interface GateChannel {
  id: number; chat_id: string; title: string; username: string | null; invite_link: string | null;
  kind: GateKind; mode: GateMode; active: number; position: number; created_at: string;
}
export interface GateMember { status: string; is_member?: boolean }
export interface GateTelegram { getChatMember(chatId: string | number, userId: number): Promise<GateMember> }
export interface GateSettings { enabled: boolean; ttlHours: number }

const DAY = 24 * 3_600_000;

let ready = false;
export async function ensureGateTables() {
  if (ready) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS gate_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '', username TEXT, invite_link TEXT,
    kind TEXT NOT NULL DEFAULT 'general', mode TEXT NOT NULL DEFAULT 'check', active INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS gate_members (
    user_id TEXT NOT NULL, chat_id TEXT NOT NULL, verified_at INTEGER NOT NULL, PRIMARY KEY (user_id, chat_id))`);
  await db.execute(`CREATE TABLE IF NOT EXISTS gate_pending (
    user_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, prompt_msg_id INTEGER, created_at INTEGER NOT NULL)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS gate_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, chat_id TEXT, event TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  ready = true;
}

// ── settings ───────────────────────────────────────────────────────────────
export async function getGateSettings(): Promise<GateSettings> {
  const enabled = (await getSetting("gate_enabled")) === "1";
  const ttl = Number(await getSetting("gate_ttl_hours"));
  return { enabled, ttlHours: Number.isFinite(ttl) && ttl >= 1 && ttl <= 720 ? ttl : 24 };
}
export async function saveGateSettings(p: Partial<GateSettings>) {
  if (p.enabled !== undefined) await setSetting("gate_enabled", p.enabled ? "1" : "0");
  if (p.ttlHours !== undefined) await setSetting("gate_ttl_hours", String(Math.min(720, Math.max(1, Math.round(p.ttlHours)))));
}

// ── channels ───────────────────────────────────────────────────────────────
/** "@name", "t.me/name", "https://t.me/name" → "@name"; numeric ids stay as they are. Invite links (t.me/+x) are not ids. */
export function normalizeChatRef(input: string): { chat_id: string; username: string | null } | { error: string } {
  const t = String(input || "").trim();
  if (!t) return { error: "Enter a channel id or @username." };
  if (/^-?\d{5,}$/.test(t)) return { chat_id: t.startsWith("-") ? t : `-100${t}`, username: null };
  if (/t\.me\/(\+|joinchat)/i.test(t)) return { error: "That is a private invite link. Use the channel's numeric id (pick it from the list, or forward a post to a bot like @getidsbot) and paste the invite link in the link field." };
  const m = t.match(/^(?:https?:\/\/)?(?:t\.me\/)?@?([A-Za-z][A-Za-z0-9_]{3,31})\/?$/);
  if (m) return { chat_id: `@${m[1]}`, username: m[1] };
  return { error: "That doesn't look like a channel id or @username." };
}

export const joinLinkOf = (c: Pick<GateChannel, "invite_link" | "username">): string | null =>
  c.invite_link || (c.username ? `https://t.me/${c.username}` : null);

export async function listGateChannels(onlyActive = false): Promise<GateChannel[]> {
  await ensureGateTables();
  const rows = (await db.execute(`SELECT * FROM gate_channels ${onlyActive ? "WHERE active=1" : ""} ORDER BY position ASC, id ASC`)).rows as unknown as GateChannel[];
  return rows;
}

export async function addGateChannel(c: { chat_id: string; title?: string; username?: string | null; invite_link?: string | null; kind?: GateKind; mode?: GateMode }): Promise<number> {
  await ensureGateTables();
  const kind: GateKind = c.kind === "discussion" || c.kind === "ads" ? c.kind : "general";
  const mode: GateMode = c.mode === "request" ? "request" : "check";
  const pos = Number((await db.execute("SELECT COALESCE(MAX(position),0)+1 AS p FROM gate_channels")).rows[0]?.p ?? 1);
  const r = await db.execute({
    sql: `INSERT INTO gate_channels (chat_id,title,username,invite_link,kind,mode,position) VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(chat_id) DO UPDATE SET title=excluded.title, username=excluded.username, invite_link=COALESCE(excluded.invite_link, invite_link), kind=excluded.kind, mode=excluded.mode, active=1`,
    args: [c.chat_id, c.title || c.chat_id, c.username ?? null, c.invite_link ?? null, kind, mode, pos],
  });
  const row = (await db.execute({ sql: "SELECT id FROM gate_channels WHERE chat_id=?", args: [c.chat_id] })).rows[0] as any;
  return Number(row?.id ?? r.lastInsertRowid);
}

export async function updateGateChannel(id: number, p: Partial<Pick<GateChannel, "title" | "invite_link" | "kind" | "mode" | "active" | "position">>) {
  await ensureGateTables();
  const sets: string[] = []; const args: any[] = [];
  for (const k of ["title", "invite_link", "kind", "mode", "active", "position"] as const) {
    if ((p as any)[k] !== undefined) { sets.push(`${k}=?`); args.push((p as any)[k]); }
  }
  if (!sets.length) return;
  await db.execute({ sql: `UPDATE gate_channels SET ${sets.join(", ")} WHERE id=?`, args: [...args, id] });
}
export async function deleteGateChannel(id: number) {
  await ensureGateTables();
  const row = (await db.execute({ sql: "SELECT chat_id FROM gate_channels WHERE id=?", args: [id] })).rows[0] as any;
  await db.execute({ sql: "DELETE FROM gate_channels WHERE id=?", args: [id] });
  if (row) await db.execute({ sql: "DELETE FROM gate_members WHERE chat_id=?", args: [row.chat_id] });
}

// ── membership ─────────────────────────────────────────────────────────────
export const isMemberStatus = (m: GateMember) =>
  ["creator", "administrator", "member"].includes(m.status) || (m.status === "restricted" && m.is_member !== false);

export async function markJoined(userId: string | number, chatId: string | number, now = Date.now()) {
  await ensureGateTables();
  await db.execute({ sql: "INSERT OR REPLACE INTO gate_members (user_id, chat_id, verified_at) VALUES (?,?,?)", args: [String(userId), String(chatId), now] });
}
export async function markLeft(userId: string | number, chatId: string | number) {
  await ensureGateTables();
  await db.execute({ sql: "DELETE FROM gate_members WHERE user_id=? AND chat_id=?", args: [String(userId), String(chatId)] });
}

export interface GateCheck { missing: GateChannel[]; broken: GateChannel[] }
/**
 * Which required channels is this viewer still missing? A recent positive check is remembered (ttl), so most
 * deliveries cost no Telegram call. Channels the bot cannot read are reported as `broken` and never block.
 */
export async function checkUser(tg: GateTelegram, userId: string | number, opts: { now?: number; fresh?: boolean } = {}): Promise<GateCheck> {
  await ensureGateTables();
  const now = opts.now ?? Date.now();
  const { ttlHours } = await getGateSettings();
  const channels = await listGateChannels(true);
  const missing: GateChannel[] = []; const broken: GateChannel[] = [];
  for (const ch of channels) {
    if (!opts.fresh) {
      const hit = (await db.execute({ sql: "SELECT verified_at FROM gate_members WHERE user_id=? AND chat_id=?", args: [String(userId), ch.chat_id] })).rows[0] as any;
      if (hit && now - Number(hit.verified_at) < ttlHours * 3_600_000) continue;
    }
    try {
      const m = await tg.getChatMember(ch.chat_id, Number(userId));
      if (isMemberStatus(m)) await markJoined(userId, ch.chat_id, now);
      else { missing.push(ch); await markLeft(userId, ch.chat_id); }
    } catch {
      broken.push(ch);
    }
  }
  return { missing, broken };
}

// ── remembered request ─────────────────────────────────────────────────────
export type PendingKind = "callback" | "file";
export interface Pending { userId: string; chatId: string; kind: PendingKind; payload: any; promptMsgId: number | null }
const PENDING_TTL_MS = 30 * 60_000;

export async function savePending(p: Pending, now = Date.now()) {
  await ensureGateTables();
  await db.execute({
    sql: "INSERT OR REPLACE INTO gate_pending (user_id, chat_id, kind, payload, prompt_msg_id, created_at) VALUES (?,?,?,?,?,?)",
    args: [p.userId, p.chatId, p.kind, JSON.stringify(p.payload), p.promptMsgId, now],
  });
}
export async function setPendingPrompt(userId: string, msgId: number) {
  await ensureGateTables();
  await db.execute({ sql: "UPDATE gate_pending SET prompt_msg_id=? WHERE user_id=?", args: [msgId, userId] });
}
/** The viewer's remembered request, removed from the list. Null when there is none or it is too old to still make sense. */
export async function takePending(userId: string | number, now = Date.now()): Promise<Pending | null> {
  await ensureGateTables();
  const row = (await db.execute({ sql: "SELECT * FROM gate_pending WHERE user_id=?", args: [String(userId)] })).rows[0] as any;
  if (!row) return null;
  await db.execute({ sql: "DELETE FROM gate_pending WHERE user_id=?", args: [String(userId)] });
  if (now - Number(row.created_at) > PENDING_TTL_MS) return null;
  let payload: any = {};
  try { payload = JSON.parse(row.payload); } catch { /* keep {} */ }
  return { userId: String(row.user_id), chatId: String(row.chat_id), kind: row.kind, payload, promptMsgId: row.prompt_msg_id ?? null };
}
export async function purgeOldPending(now = Date.now()) {
  await ensureGateTables();
  await db.execute({ sql: "DELETE FROM gate_pending WHERE created_at < ?", args: [now - PENDING_TTL_MS] });
}

export async function logGateEvent(userId: string | number, chatId: string | number | null, event: "prompted" | "joined" | "resumed") {
  await ensureGateTables();
  await db.execute({ sql: "INSERT INTO gate_events (user_id, chat_id, event) VALUES (?,?,?)", args: [String(userId), chatId === null ? null : String(chatId), event] });
}

export async function gateStats() {
  await ensureGateTables();
  const per = (await db.execute("SELECT chat_id, COUNT(*) AS n FROM gate_members GROUP BY chat_id")).rows as any[];
  const ev = (await db.execute("SELECT event, COUNT(*) AS n FROM gate_events GROUP BY event")).rows as any[];
  const pending = Number((await db.execute("SELECT COUNT(*) AS n FROM gate_pending")).rows[0]?.n ?? 0);
  const count = (e: string) => Number(ev.find((r) => r.event === e)?.n ?? 0);
  return {
    members: Object.fromEntries(per.map((r) => [String(r.chat_id), Number(r.n)])) as Record<string, number>,
    prompted: count("prompted"), joined: count("joined"), resumed: count("resumed"), waiting: pending,
  };
}
