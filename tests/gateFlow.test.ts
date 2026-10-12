import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TURSO_DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bm-gf-")), "t.db")}`;
delete process.env.TURSO_AUTH_TOKEN;
process.env.ADMIN_TELEGRAM_IDS = "999";

let G: typeof import("../src/bot/gate.js");
let F: typeof import("../src/bot/gateFlow.js");
let Telegraf: any;
let Telegram: any;
before(async () => {
  const D = await import("../src/db/index.js");
  await D.setupDatabase();
  G = await import("../src/bot/gate.js");
  F = await import("../src/bot/gateFlow.js");
  const T = await import("telegraf");
  Telegraf = T.Telegraf; Telegram = T.Telegram;
  await G.addGateChannel({ chat_id: "-100777", title: "Community", username: null, invite_link: "https://t.me/+abc", kind: "discussion" });
  await G.saveGateSettings({ enabled: true });
});

function makeBot() {
  const calls: Array<{ method: string; payload: any }> = [];
  const members = new Set<string>();
  const bot = new Telegraf("123:abc");
  (bot as any).botInfo = { id: 123, is_bot: true, first_name: "bm", username: "bm_bot" };
  // Telegraf builds a fresh Telegram client per update, so the stub goes on the prototype (the last bot made wins)
  Telegram.prototype.callApi = async function (method: string, payload: any) {
    calls.push({ method, payload });
    if (method === "getChatMember") return { status: members.has(`${payload.chat_id}:${payload.user_id}`) ? "member" : "left" };
    if (method === "sendMessage") return { message_id: 500 + calls.length, chat: { id: payload.chat_id }, date: 0 };
    return true;
  };
  return { bot, calls, members };
}
const user = { id: 7, is_bot: false, first_name: "Ama" };
const cb = (data: string, id = "cb1") => ({
  update_id: 1,
  callback_query: { id, from: user, chat_instance: "x", data, message: { message_id: 42, date: 0, chat: { id: 7, type: "private" } } },
});

test("not joined → join prompt, nothing delivered; joining completes the same request automatically", async () => {
  const { bot, calls, members } = makeBot();
  const delivered: number[] = [];
  const watched: string[] = [];
  F.installGate(bot, async (_ctx, fileId) => { delivered.push(fileId); });
  bot.action(/^watch_(\d+)$/, async (ctx: any) => { watched.push(ctx.callbackQuery.id); await ctx.answerCbQuery(); });

  await bot.handleUpdate(cb("watch_5") as any);
  assert.equal(watched.length, 0, "the handler must not run before the viewer has joined");
  const prompt = calls.find((c) => c.method === "sendMessage");
  assert.ok(prompt, "a join message is sent");
  assert.match(JSON.stringify(prompt!.payload.reply_markup), /https:\/\/t\.me\/\+abc/);
  assert.match(JSON.stringify(prompt!.payload.reply_markup), /gate_ok/);

  // Telegram reports the join
  members.add("-100777:7");
  calls.length = 0;
  await bot.handleUpdate({ update_id: 2, chat_member: { chat: { id: -100777, type: "channel", title: "Community" }, from: user, date: 0, old_chat_member: { status: "left", user }, new_chat_member: { status: "member", user } } } as any);
  assert.equal(watched.length, 1, "the pressed button is replayed");
  assert.match(watched[0], /^resume:/);
  assert.ok(!calls.some((c) => c.method === "answerCallbackQuery"), "a replayed button never answers a fake callback id");
  assert.ok(calls.some((c) => c.method === "deleteMessage"), "the join prompt is cleaned up");
  assert.ok(calls.some((c) => c.method === "sendMessage" && /Thanks for joining/.test(String(c.payload.text))));

  // and it only happens once
  calls.length = 0;
  await bot.handleUpdate({ update_id: 3, chat_member: { chat: { id: -100777, type: "channel" }, from: user, date: 0, old_chat_member: { status: "left", user }, new_chat_member: { status: "member", user } } } as any);
  assert.equal(watched.length, 1);
});

test("already a member → straight through; admins are never gated; browsing buttons are never gated", async () => {
  const { bot, members } = makeBot();
  members.add("-100777:7");
  const watched: string[] = [];
  const browsed: string[] = [];
  F.installGate(bot, async () => {});
  bot.action(/^watch_(\d+)$/, async (ctx: any) => { watched.push("x"); await ctx.answerCbQuery(); });
  bot.action(/^mov_sel_(.+)$/, async (ctx: any) => { browsed.push("x"); await ctx.answerCbQuery(); });
  await bot.handleUpdate(cb("watch_5") as any);
  assert.equal(watched.length, 1);

  const other = makeBot();
  F.installGate(other.bot, async () => {});
  other.bot.action(/^watch_(\d+)$/, async (ctx: any) => { watched.push("admin"); await ctx.answerCbQuery(); });
  other.bot.action(/^mov_sel_(.+)$/, async (ctx: any) => { browsed.push("nm"); await ctx.answerCbQuery(); });
  await other.bot.handleUpdate({ ...cb("watch_5"), callback_query: { ...cb("watch_5").callback_query, from: { id: 999, is_bot: false, first_name: "Admin" } } } as any);
  assert.equal(watched.length, 2);
  await other.bot.handleUpdate(cb("mov_sel_abc") as any);
  assert.equal(browsed.length, 1);
});

test("'I've joined' verifies for real: still missing → alert, joined → request completes", async () => {
  const { db } = await import("../src/db/index.js");
  await db.execute("DELETE FROM gate_members");
  const { bot, calls, members } = makeBot();
  const delivered: number[] = [];
  F.installGate(bot, async (_c, id) => { delivered.push(id); });
  // a delivery-time check (deep link / inline) remembers a file request
  const ctx: any = { from: user, chat: { id: 7 }, telegram: bot.telegram };
  assert.equal(await F.gateOk(ctx, { kind: "file", payload: { fileId: 11 } }), false);

  await bot.handleUpdate(cb("gate_ok", "cb2") as any);
  assert.ok(calls.some((c) => c.method === "answerCallbackQuery" && c.payload.show_alert), "told they're still missing");
  assert.deepEqual(delivered, []);

  members.add("-100777:7");
  await bot.handleUpdate(cb("gate_ok", "cb3") as any);
  assert.deepEqual(delivered, [11]);
});

test("a channel the bot cannot read never blocks viewers", async () => {
  const { bot } = makeBot();
  Telegram.prototype.callApi = async function (m: string) { if (m === "getChatMember") throw new Error("Bad Request: chat not found"); return { message_id: 1 }; };
  F.installGate(bot, async () => {});
  const ctx: any = { from: { id: 55, is_bot: false, first_name: "Kofi" }, chat: { id: 55 }, telegram: bot.telegram };
  assert.equal(await F.gateOk(ctx, { kind: "file", payload: { fileId: 1 } }), true);
});
