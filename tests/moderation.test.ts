import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TURSO_DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bm-mod-")), "t.db")}`;
delete process.env.TURSO_AUTH_TOKEN;

let D: typeof import("../src/db/index.js");
let M: typeof import("../src/services/moderation.js");
let B: typeof import("../src/crawler/blocklist.js");
let J: typeof import("../src/crawler/jobs.js");
before(async () => {
  D = await import("../src/db/index.js");
  await D.setupDatabase();
  J = await import("../src/crawler/jobs.js");
  await J.ensureCrawlerTables();
  M = await import("../src/services/moderation.js");
  B = await import("../src/crawler/blocklist.js");
});

test("capReached, parseViewerRef", () => {
  assert.equal(M.capReached(5, 0), false);
  assert.equal(M.capReached(4, 5), false);
  assert.equal(M.capReached(5, 5), true);
  assert.deepEqual(M.parseViewerRef("123456789"), { id: "123456789" });
  assert.deepEqual(M.parseViewerRef("@some_name"), { username: "some_name" });
  assert.deepEqual(M.parseViewerRef("tg:555555"), { id: "555555" });
  assert.equal(M.parseViewerRef("hi"), null);
});

test("daily cap counts, stops at the limit and refunds", async () => {
  assert.deepEqual(await M.takeDelivery(1), { ok: true, used: 0, cap: 0 }); // no cap → unlimited
  await M.setDailyCap(2);
  assert.equal((await M.takeDelivery(7)).ok, true);
  assert.equal((await M.takeDelivery(7)).ok, true);
  const third = await M.takeDelivery(7);
  assert.equal(third.ok, false);
  assert.equal(third.cap, 2);
  await M.refundDelivery(7);
  assert.equal((await M.takeDelivery(7)).ok, true);
  assert.equal((await M.takeDelivery(8)).ok, true); // someone else is unaffected
  await M.setDailyCap(0);
});

test("ban and unban", async () => {
  assert.equal(await M.isBanned(42), false);
  await M.banViewer(42, "spam");
  assert.equal(await M.isBanned(42), true);
  assert.equal((await M.listBans())[0].telegram_id, "42");
  await M.unbanViewer(42);
  assert.equal(await M.isBanned(42), false);
});

test("a blocked file is refused; a different copy is not", async () => {
  await B.blockFile({ fileName: "Bad.Movie.2020.720p.mkv", fileSize: 900_000_000, title: "Bad Movie", reason: "reported" });
  assert.match(String(await B.whyBlocked({ fileName: "bad movie 2020 720p.MKV", size: 900_500_000 })), /exact file/);
  assert.equal(await B.whyBlocked({ fileName: "Bad.Movie.2020.1080p.mkv", size: 2_000_000_000 }), null);
  const again = await B.blockFile({ fileName: "Bad.Movie.2020.720p.mkv", fileSize: 900_000_000 });
  assert.equal((await B.listBlocks()).filter((b) => b.kind === "file").length, 1);
  assert.ok(again);
});

test("takedown removes files, cancels queued jobs, blocks the title and spares others", async () => {
  const mk = (id: string, title: string, year: string, n: number) => D.addMediaFile({ movie_id: id, movie_title: title, year, telegram_file_id: String(n), telegram_channel_id: "", telegram_message_id: "", file_name: `${title.replace(/ /g, ".")}.${year}.${n === 2 ? "720p" : "1080p"}.BluRay.x264-G${n}.mkv`, file_size: 1_000_000_000, quality: n === 2 ? "720p" : "1080p" } as any);
  await mk("a1", "Gone Movie", "2019", 1);
  await mk("a2", "Gone Movie", "2019", 2);
  await mk("b1", "Safe Movie", "2019", 3);
  await J.enqueueJob({ kind: "movie", title: "Gone Movie", year: "2019", priority: 2, source: "cron" } as any);
  await J.enqueueJob({ kind: "movie", title: "Safe Movie", year: "2019", priority: 2, source: "cron" } as any);

  const r = await M.takedownTitle({ title: "gone movie", year: "2019", reason: "test" });
  assert.equal(r.removedFiles, 2);
  assert.equal(r.cancelledJobs, 1);
  const left = (await D.db.execute("SELECT movie_title FROM media_files")).rows.map((x: any) => x.movie_title);
  assert.deepEqual(left, ["Safe Movie"]);
  assert.match(String(await B.whyBlocked({ title: "The Gone Movie", year: "2019" })), /takedown/);
  assert.equal(await B.whyBlocked({ title: "Safe Movie", year: "2019" }), null);
  // taking it down twice is harmless
  assert.equal((await M.takedownTitle({ title: "Gone Movie", year: "2019" })).removedFiles, 0);
});
