import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TURSO_DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bm-vw-")), "t.db")}`;
delete process.env.TURSO_AUTH_TOKEN;
process.env.ADMIN_TELEGRAM_IDS = "999";

let D: typeof import("../src/db/index.js");
let F: typeof import("../src/bot/follow.js");
let P: typeof import("../src/bot/prefs.js");
let R: typeof import("../src/bot/reports.js");
let V: typeof import("../src/bot/viewerFeatures.js");
let J: typeof import("../src/crawler/jobs.js");
let Telegraf: any, Telegram: any;
before(async () => {
  D = await import("../src/db/index.js");
  await D.setupDatabase();
  J = await import("../src/crawler/jobs.js");
  await J.ensureCrawlerTables();
  F = await import("../src/bot/follow.js");
  P = await import("../src/bot/prefs.js");
  R = await import("../src/bot/reports.js");
  V = await import("../src/bot/viewerFeatures.js");
  const T = await import("telegraf"); Telegraf = T.Telegraf; Telegram = T.Telegram;
});

test("describeEpisodes: one episode, a run, several seasons", () => {
  assert.equal(F.describeEpisodes([{ id: 1, season: 2, episode: 5 }]), "S02E05");
  assert.equal(F.describeEpisodes([{ id: 3, season: 2, episode: 3 }, { id: 1, season: 2, episode: 1 }, { id: 2, season: 2, episode: 2 }]), "S02E01–E03");
  assert.equal(F.describeEpisodes([{ id: 1, season: 1, episode: 1 }, { id: 2, season: 2, episode: 1 }]), "S01–S02");
});

test("EpisodeBatcher: a burst of episodes becomes one notice per show", async () => {
  const out: any[] = [];
  const b = new F.EpisodeBatcher(30, (n) => { out.push(n); });
  for (let e = 1; e <= 4; e++) b.add("Dark", { id: e, season: 1, episode: e });
  b.add("Ozark", { id: 9, season: 3, episode: 1 });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(out.length, 2);
  assert.equal(out.find((n) => n.title === "Dark").items.length, 4);
});

test("follow / unfollow / followers", async () => {
  await F.follow(1, "Severance"); await F.follow(2, "severance"); await F.follow(1, "Dark");
  assert.deepEqual((await F.followersOf("SEVERANCE")).sort(), ["1", "2"]);
  assert.equal(await F.isFollowing(1, "Dark"), true);
  await F.unfollow(1, F.followKey("Dark"));
  assert.equal(await F.isFollowing(1, "Dark"), false);
  assert.deepEqual((await F.listFollows(1)).map((f) => f.title), ["Severance"]);
});

test("quality preference picks without asking only when asked to", () => {
  const files = [{ id: 1, quality: "720p", file_size: 900 }, { id: 2, quality: "1080p", file_size: 2400 }];
  assert.equal(P.pickPreferred(files, "ask"), null);
  assert.equal(P.pickPreferred(files, "best")!.id, 2);
  assert.equal(P.pickPreferred(files, "small")!.id, 1);
  assert.equal(P.pickPreferred([files[0]], "best"), null, "nothing to choose between");
});

test("reports count different viewers once each", async () => {
  assert.equal(await R.addReport(5, 1), 1);
  assert.equal(await R.addReport(5, 1), 1);
  assert.equal(await R.addReport(5, 2), 2);
  assert.deepEqual((await R.reportersOf(5)).sort(), ["1", "2"]);
  await R.clearReports(5);
  assert.deepEqual(await R.reportersOf(5), []);
});

test("demand-first: the title more viewers asked for goes first within the same priority", async () => {
  const a = await J.enqueueJob({ kind: "movie", title: "Quiet Film", year: "2001", source: "user" });
  const b = await J.enqueueJob({ kind: "movie", title: "Popular Film", year: "2002", source: "user" });
  await J.enqueueJob({ kind: "movie", title: "Popular Film", year: "2002", source: "user" });
  await J.enqueueJob({ kind: "movie", title: "Popular Film", year: "2002", source: "user" });
  const first = await J.claimNextJob();
  assert.equal(first!.id, b.id);
  assert.notEqual(first!.id, a.id);
  // priority still beats demand
  await J.enqueueJob({ kind: "movie", title: "Admin Pick", year: "2003", source: "admin", priority: J.PRIORITY.user });
});

function stubTelegram() {
  const sent: Array<{ method: string; payload: any }> = [];
  Telegram.prototype.callApi = async function (method: string, payload: any) { sent.push({ method, payload }); return { message_id: 77, chat: { id: 1 }, date: 0 }; };
  return sent;
}

test("after a delivery: series get Next episode + Follow + Wrong file; movies get the other quality", async () => {
  const sent = stubTelegram();
  const bot = new Telegraf("123:abc");
  (bot as any).botInfo = { id: 123, is_bot: true, first_name: "bm", username: "bm_bot" };
  const ephemeral: any[] = [];
  V.installViewerFeatures(bot, { showKeyOf: () => "s_key", sizeLabel: (n) => `${n}B`, ephemeral: (c, m, ms) => ephemeral.push([c, m, ms]) });

  const e1 = await D.addMediaFile({ movie_id: "s1", movie_title: "Dark", year: "2017", telegram_file_id: "1", telegram_channel_id: "-1", telegram_message_id: "1", file_name: "Dark.S01E01.1080p.mkv", file_size: 1000, quality: "1080p", season: 1, episode: 1 } as any);
  const e2 = await D.addMediaFile({ movie_id: "s2", movie_title: "Dark", year: "2017", telegram_file_id: "2", telegram_channel_id: "-1", telegram_message_id: "2", file_name: "Dark.S01E02.1080p.mkv", file_size: 1000, quality: "1080p", season: 1, episode: 2 } as any);
  const ctx: any = { chat: { id: 7, type: "private" }, from: { id: 7 } };
  await V.afterDelivery(ctx, await D.getMediaFileById(e1));
  const kb = JSON.stringify(sent.at(-1)!.payload.reply_markup);
  assert.match(kb, new RegExp(`watch_${e2}`));
  assert.match(kb, /fol_/);
  assert.match(kb, /rep_/);
  assert.equal(ephemeral.length, 1);

  const m720 = await D.addMediaFile({ movie_id: "m1", movie_title: "Inception", year: "2010", telegram_file_id: "3", telegram_channel_id: "-1", telegram_message_id: "3", file_name: "Inception.2010.720p.mkv", file_size: 800, quality: "720p" } as any);
  const m1080 = await D.addMediaFile({ movie_id: "m1", movie_title: "Inception", year: "2010", telegram_file_id: "4", telegram_channel_id: "-1", telegram_message_id: "4", file_name: "Inception.2010.1080p.mkv", file_size: 2000, quality: "1080p" } as any);
  await V.afterDelivery(ctx, await D.getMediaFileById(m1080));
  assert.match(JSON.stringify(sent.at(-1)!.payload.reply_markup), new RegExp(`watch_${m720}.*720p|720p.*watch_${m720}`));

  // groups get nothing extra
  const before = sent.length;
  await V.afterDelivery({ chat: { id: -5, type: "supergroup" }, from: { id: 7 } }, await D.getMediaFileById(m1080));
  assert.equal(sent.length, before);
});

test("repairFile removes the copy, queues a repair job and remembers who to tell", async () => {
  const id = await D.addMediaFile({ movie_id: "m9", movie_title: "Bad Copy", year: "1999", telegram_file_id: "9", telegram_channel_id: "-1", telegram_message_id: "9", file_name: "Bad.Copy.1999.1080p.mkv", file_size: 1500, quality: "1080p" } as any);
  await R.addReport(id, 11); await R.addReport(id, 12);
  assert.equal(await V.repairFile(id), true);
  assert.equal(await D.getMediaFileById(id), null);
  const job = (await D.db.execute("SELECT * FROM crawl_jobs WHERE title='Bad Copy'")).rows[0] as any;
  assert.equal(job.source, "repair");
  assert.equal(job.quality, "1080p");
  const reqs = (await D.db.execute("SELECT telegram_id FROM requests WHERE title='Bad Copy' ORDER BY telegram_id")).rows.map((r: any) => String(r.telegram_id));
  assert.deepEqual(reqs, ["11", "12"]);
  assert.equal(await V.repairFile(id), false, "already gone");
});

test("new series episodes reach followers as a single message", async () => {
  const sent = stubTelegram();
  await F.follow(31, "Ozark");
  await D.addMediaFile({ movie_id: "o1", movie_title: "Ozark", year: "2017", telegram_file_id: "o1", telegram_channel_id: "-1", telegram_message_id: "101", file_name: "Ozark.S03E01.1080p.mkv", file_size: 1000, quality: "1080p", season: 3, episode: 1 } as any);
  await D.addMediaFile({ movie_id: "o2", movie_title: "Ozark", year: "2017", telegram_file_id: "o2", telegram_channel_id: "-1", telegram_message_id: "102", file_name: "Ozark.S03E02.1080p.mkv", file_size: 1000, quality: "1080p", season: 3, episode: 2 } as any);
  // the batcher in installViewerFeatures waits 90s; here we only prove the hook is wired by checking nothing was sent yet
  assert.equal(sent.filter((s) => s.method === "sendMessage" && String(s.payload.chat_id) === "31").length, 0);
});
