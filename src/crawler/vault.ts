/**
 * Moving a file the external bot sent into our vault channel, and proving which message it became.
 * Old code guessed ids from "the latest message"; this never does: no confirmed id = failure.
 */
import { TelegramClient } from "telegram";
import { tg } from "./flood.js";

export function extractForwardedIds(result: any): number[] {
  const ids: number[] = [];
  const push = (x: any) => { if (x && Number.isFinite(Number(x)) && Number(x) > 0) ids.push(Number(x)); };
  if (Array.isArray(result)) {
    for (const it of result.flat()) push(it?.id);
  } else if (result) {
    for (const u of result.updates || []) {
      if (u?.message?.id) push(u.message.id);
      else if (u?.className === "UpdateNewChannelMessage" || u?.className === "UpdateNewMessage") push(u.message?.id);
    }
    if (!ids.length && result.id) push(result.id);
  }
  return Array.from(new Set(ids));
}

export interface VaultCopy { vaultMsgId: number; fileName?: string; size?: number }

export async function forwardToVault(client: TelegramClient, fromBot: any, vault: any, botMsgId: number, expectedSize?: number): Promise<VaultCopy> {
  const res = await tg(() => client.forwardMessages(vault, { messages: [botMsgId], fromPeer: fromBot }));
  const ids = extractForwardedIds(res);
  if (ids.length !== 1) throw new Error(`could not confirm which vault message the file became (got ${ids.length} ids)`);
  const [msg]: any[] = await tg(() => client.getMessages(vault, { ids: [ids[0]] }));
  const doc = msg?.document;
  if (!doc) throw new Error("the forwarded message has no file in the vault");
  const size = Number(doc.size || 0);
  if (expectedSize && size && Math.abs(size - expectedSize) > 1024) throw new Error("vault copy size differs from the original");
  const fileName = (doc.attributes || []).find((a: any) => a.className === "DocumentAttributeFilename")?.fileName;
  return { vaultMsgId: ids[0], fileName, size };
}
