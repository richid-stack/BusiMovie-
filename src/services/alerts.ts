/**
 * Short Telegram messages to the admins when something needs a human (session expired, a bot wants you to join,
 * a job timed out…). The bot registers a sender at start-up; until then (or without a bot) alerts only go to the log.
 * Identical alerts are rate limited so a failure loop cannot spam the phone.
 */
import { getAdminTelegramIds } from "../server/auth.js";

type Sender = (adminIds: string[], text: string) => Promise<void>;
let sender: Sender | null = null;
const last = new Map<string, number>();
const recent: Array<{ at: number; key: string; text: string }> = [];

export function setAlertSender(fn: Sender | null) { sender = fn; }

export function shouldSend(key: string, now: number, cooldownMs: number): boolean {
  const prev = last.get(key);
  if (prev !== undefined && now - prev < cooldownMs) return false;
  last.set(key, now);
  return true;
}

export function recentAlerts() { return recent.slice(-20).reverse(); }

export async function alertAdmin(key: string, text: string, cooldownMs = 30 * 60_000): Promise<boolean> {
  const now = Date.now();
  if (!shouldSend(key, now, cooldownMs)) return false;
  recent.push({ at: now, key, text });
  if (recent.length > 50) recent.shift();
  console.warn(`[alert] ${text}`);
  const ids = [...getAdminTelegramIds()];
  if (!sender || !ids.length) return false;
  try { await sender(ids, text); return true; } catch (e: any) { console.warn("[alert] could not send:", e?.message); return false; }
}
