import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TURSO_DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bm-rc-")), "t.db")}`;
delete process.env.TURSO_AUTH_TOKEN;
process.env.ADMIN_TELEGRAM_IDS = "999";

let D: typeof import("../src/db/index.js");
let X: typeof import("../src/bot/discovery.js");
let Reach: typeof import("../src/bot/reach.js");
let Telegraf: any, Telegram: any;
before(async () => {
  D = await import("../src/db/index.js");
  await D.setupDatabase();
  X = await import("../src/bot/discovery.js");
  Reach = await import("../src/bot/reach.js");
  const T = await import("telegraf"); Telegraf = T.Telegraf; Telegram = T.Telegram;
  const add = (o: any) => D.addMediaFile({ telegram_channel_id: "-1", language: "English", ...o } as any);
  await add({ movie_id: "a", movie_title: "Inception", year: "2010", telegram_file_id: "1", telegram_message_id: "1", file_name: "Inception.2010.720p.mkv", file_size: 800, quality: "720p" });
  await add({ movie_id: "a", movie_title: "Inception", year: "2010", telegram_file_id: "2", telegram_message_id: "2", file_name: "Inception.2010.1080p.mkv", file_size: 2000, quality: "1080p" });
  await add({ movie_id: "b", movie_title: "Dark", year: "2017", telegram_file_id: "3", telegram_message_id: "3", file_name: "Dark.S02E03.1080p.mkv", file_size: 900, quality: "1080p", season: 2, episode: 3 });
  await add({ movie_id: "c", movie_title: "Dark", year: "2017", telegram_file_id: "4", telegram_message_id: "4", file_name: "Dark.S01E02.1080p.mkv", file_size: 900, quality: "1080p", season: 1, episode: 2 });
});

test("group triggers: commands, mentions and replies answer; chatter does not", () => {
  const T = X.parseGroupTrigger;
  assert.deepEqual(T("/movie Inception", "bm_bot"), { kind: "search", query: "Inception" });
  assert.deepEqual(T("/search@bm_bot The Dark Knight", "bm_bot"), { kind: "search", query: "The Dark Knight" });
  assert.deepEqual(T("/movie", "bm_bot"), { kind: "empty" });
  assert.deepEqual(T("@bm_bot Dune", "bm_bot"), { kind: "search", query: "Dune" });
  assert.deepEqual(T("@bm_bot", "bm_bot"), { kind: "help" });
  assert.deepEqual(T("/start@bm_bot", "bm_bot"), { kind: "help" });
  assert.deepEqual(T("Dune", "bm_bot", true), { kind: "search", query: "Dune" });
  assert.equal(T("anyone seen Dune?", "bm_bot"), null);
  assert.equal(T("/random stuff", "bm_bot"), null);
});

test("library search groups qualities and starts a show at its first episode", async () => {
  const inc = (await X.libraryHits("inception"))[0];
  assert.equal(inc.inVault, true);
  assert.deepEqual(inc.qualities.sort(), ["1080p", "720p"]);
  const dark = (await X.libraryHits("dark"))[0];
  assert.equal(dark.kind, "series");
  const first = await D.getMediaFileById(dark.watchId!);
  assert.equal(`${first!.season}-${first!.episode}`, "1-2");
  assert.equal(X.hitLink(dark, "bm_bot"), `https://t.me/bm_bot?start=watch_${dark.watchId}`);
});

test("titles not in the library come from metadata and link to a request", async () => {
  const hits = await X.findHits("dune", 5, { searchMeta: async () => [{ id: "tt1160419", title: "Dune", year: "2021" }], isSeries: () => false });
  assert.equal(hits[0].inVault, false);
  assert.equal(X.hitLink(hits[0], "bm_bot"), "https://t.me/bm_bot?start=req_tt1160419");
  assert.match(X.hitLabel(hits[0]), /📝/);
});

test("recent additions for an empty inline query", async () => {
  const r = await X.recentHits(5);
  assert.ok(r.length >= 2);
});

function stub() {
  const sent: Array<{ method: string; payload: any }> = [];
  Telegram.prototype.callApi = async function (method: string, payload: any) { sent.push({ method, payload }); return { message_id: 5, chat: { id: 1 }, date: 0 }; };
  return sent;
}
const mkBot = () => {
  const bot = new Telegraf("123:abc");
  (bot as any).botInfo = { id: 123, is_bot: true, first_name: "bm", username: "bm_bot" };
  Reach.installReach(bot, { searchMeta: async () => [], isSeries: () => false });
  let leaked = 0;
  bot.on("text", () => { leaked++; });
  return { bot, leaked: () => leaked };
};
const groupMsg = (text: string, from = 5) => ({ update_id: Math.floor(Math.random() * 1e6), message: { message_id: 1, date: 0, chat: { id: -500 - from, type: "supergroup", title: "G" }, from: { id: from, is_bot: false, first_name: "x" }, text, ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } : {}) } });

test("group: /movie answers with deep-link buttons; chatter never reaches the search handler", async () => {
  const sent = stub();
  const { bot, leaked } = mkBot();
  await bot.handleUpdate(groupMsg("/movie inception", 1) as any);
  const reply = sent.find((s) => s.method === "sendMessage")!;
  assert.match(JSON.stringify(reply.payload.reply_markup), /t\.me\/bm_bot\?start=watch_/);
  await bot.handleUpdate(groupMsg("did anyone watch inception yesterday", 2) as any);
  assert.equal(leaked(), 0, "plain group chatter is ignored");
});

test("group: a busy chat gets one answer per few seconds", async () => {
  const sent = stub();
  const { bot } = mkBot();
  const upd = (n: number) => ({ ...groupMsg("/movie inception", 77), update_id: n });
  await bot.handleUpdate(upd(1) as any);
  await bot.handleUpdate(upd(2) as any);
  assert.equal(sent.filter((s) => s.method === "sendMessage").length, 1);
});

test("group: buttons that deliver files are refused in the group; admins keep their commands", async () => {
  const sent = stub();
  const { bot, leaked } = mkBot();
  bot.action(/^watch_/, async () => { throw new Error("must not deliver into a group"); });
  await bot.handleUpdate({ update_id: 9, callback_query: { id: "c", from: { id: 5, is_bot: false, first_name: "x" }, chat_instance: "x", data: "watch_1", message: { message_id: 1, date: 0, chat: { id: -9, type: "supergroup" } } } } as any);
  assert.ok(sent.some((s) => s.method === "answerCallbackQuery"));
  await bot.handleUpdate(groupMsg("/sync", 999) as any);
  assert.equal(leaked(), 1, "an admin's /sync still reaches the normal handlers");
});

test("inline: results are article cards with a deep link; empty query shows recent additions", async () => {
  const sent = stub();
  const { bot } = mkBot();
  const inline = (q: string) => ({ update_id: 3, inline_query: { id: "i1", from: { id: 5, is_bot: false, first_name: "x" }, query: q, offset: "" } });
  await bot.handleUpdate(inline("incep") as any);
  let ans = sent.find((s) => s.method === "answerInlineQuery")!.payload;
  const results = typeof ans.results === "string" ? JSON.parse(ans.results) : ans.results;
  assert.equal(results[0].type, "article");
  assert.match(JSON.stringify(results[0].reply_markup), /start=watch_/);
  sent.length = 0;
  await bot.handleUpdate(inline("") as any);
  ans = sent.find((s) => s.method === "answerInlineQuery")!.payload;
  const recent = typeof ans.results === "string" ? JSON.parse(ans.results) : ans.results;
  assert.ok(recent.length >= 2);
});
