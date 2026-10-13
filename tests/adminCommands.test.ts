import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TURSO_DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bm-ac-")), "t.db")}`;
delete process.env.TURSO_AUTH_TOKEN;
process.env.ADMIN_TELEGRAM_IDS = "999";

let Telegraf: any, Telegram: any, A: typeof import("../src/bot/adminCommands.js"), D: typeof import("../src/db/index.js");
before(async () => {
  D = await import("../src/db/index.js");
  await D.setupDatabase();
  const jobs = await import("../src/crawler/jobs.js");
  await jobs.ensureCrawlerTables();
  const T = await import("telegraf");
  Telegraf = T.Telegraf; Telegram = T.Telegram;
  A = await import("../src/bot/adminCommands.js");
});

function makeBot() {
  const sent: Array<{ method: string; payload: any }> = [];
  const bot = new Telegraf("123:abc");
  (bot as any).botInfo = { id: 123, is_bot: true, first_name: "bm", username: "bm_bot" };
  Telegram.prototype.callApi = async function (method: string, payload: any) { sent.push({ method, payload }); return { message_id: 1, chat: { id: 1 }, date: 0 }; };
  A.installAdminCommands(bot);
  return { bot, sent };
}
const msg = (from: number, text: string) => ({
  update_id: 1,
  message: { message_id: 1, date: 0, chat: { id: from, type: "private" }, from: { id: from, is_bot: false, first_name: "x" }, text, entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] },
});

test("admin commands answer admins and stay silent for viewers", async () => {
  const { bot, sent } = makeBot();
  await bot.handleUpdate(msg(5, "/health") as any);
  assert.equal(sent.length, 0, "a viewer gets nothing");
  await bot.handleUpdate(msg(999, "/health") as any);
  const text = String(sent.at(-1)!.payload.text);
  assert.match(text, /BusiMovie health/);
  assert.match(text, /Userbot:/);
  assert.match(text, /Queue:/);
});

test("/wish adds to the wishlist, /fetch queues an admin job, /queue shows it", async () => {
  const { bot, sent } = makeBot();
  await bot.handleUpdate(msg(999, "/wish Dark S1-S2") as any);
  assert.match(String(sent.at(-1)!.payload.text), /Added.*Dark.*seasons 1, 2/s);
  const W = await import("../src/crawler/wishlist.js");
  const wishes = await W.listWishes();
  assert.equal(wishes[0].title, "Dark");
  assert.deepEqual(wishes[0].seasonsWanted, [1, 2]);

  await bot.handleUpdate(msg(999, "/fetch Inception 2010") as any);
  assert.match(String(sent.at(-1)!.payload.text), /Inception/);
  const row = (await D.db.execute("SELECT * FROM crawl_jobs WHERE title='Inception'")).rows[0] as any;
  assert.equal(row.source, "admin");
  assert.equal(row.requested_by, "tg:999");
  await bot.handleUpdate(msg(999, "/queue") as any);
  assert.match(String(sent.at(-1)!.payload.text), /Inception/);
});

test("/requests groups identical requests and Ready tells every requester", async () => {
  const { bot, sent } = makeBot();
  for (const u of ["101", "102", "103"]) await D.db.execute({ sql: "INSERT INTO requests (telegram_id,tmdb_id,title) VALUES (?,?,?)", args: [u, "x", "Dune"] });
  await bot.handleUpdate(msg(999, "/requests") as any);
  const listing = sent.at(-1)!.payload;
  assert.match(String(listing.text), /Dune.*3.*people/s);
  const id = (await D.db.execute("SELECT MIN(id) AS id FROM requests WHERE title='Dune'")).rows[0].id;
  sent.length = 0;
  await bot.handleUpdate({ update_id: 2, callback_query: { id: "c1", from: { id: 999, is_bot: false, first_name: "A" }, chat_instance: "x", data: `adm_ready_${id}`, message: { message_id: 3, date: 0, chat: { id: 999, type: "private" } } } } as any);
  assert.equal(sent.filter((s) => s.method === "sendMessage").length, 3, "all three viewers are told");
  assert.equal(Number((await D.db.execute("SELECT COUNT(*) AS n FROM requests WHERE title='Dune' AND status='fulfilled'")).rows[0].n), 3);
});
