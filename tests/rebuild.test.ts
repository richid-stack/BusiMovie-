import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TURSO_DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bm-rb-")), "t.db")}`;
delete process.env.TURSO_AUTH_TOKEN;

let D: typeof import("../src/db/index.js");
let R: typeof import("../src/crawler/rebuild.js");
let B: typeof import("../src/crawler/blocklist.js");
before(async () => {
  D = await import("../src/db/index.js");
  await D.setupDatabase();
  R = await import("../src/crawler/rebuild.js");
  B = await import("../src/crawler/blocklist.js");
});

const msg = (id: number, name: string, size = 1_500_000_000, h = 1080) => ({
  id, message: "",
  document: { className: "Document", size, mimeType: "video/x-matroska", attributes: [{ className: "DocumentAttributeFilename", fileName: name }, { className: "DocumentAttributeVideo", duration: 7200, w: h === 480 ? 854 : 1920, h }] },
});

test("re-indexes vault files, skips ones it already has, and never announces them", async () => {
  let announced = 0;
  D.setMediaAddedHook(() => { announced++; });
  const a = await R.indexVaultMessage("-100111", msg(10, "Rebuilt.Movie.2021.1080p.BluRay.x264-GRP.mkv"));
  assert.equal(a.status, "added");
  const row: any = (await D.db.execute("SELECT * FROM media_files WHERE telegram_message_id='10'")).rows[0];
  assert.equal(row.telegram_channel_id, "-100111");
  assert.equal(String(row.year), "2021");
  assert.equal((await R.indexVaultMessage("-100111", msg(10, "Rebuilt.Movie.2021.1080p.BluRay.x264-GRP.mkv"))).status, "already");
  assert.equal(announced, 0);
  D.setMediaAddedHook(null);
});

test("rebuild ignores non-video posts, rejects low quality, and respects the blocklist", async () => {
  assert.equal((await R.indexVaultMessage("-100111", { id: 11, message: "hello" })).status, "ignored");
  const low = await R.indexVaultMessage("-100111", msg(12, "Tiny.Movie.2020.480p.WEB.mkv", 400_000_000, 480));
  assert.equal(low.status, "skipped");
  await B.blockTitle("Taken Down Movie", "2018", "test");
  const blocked = await R.indexVaultMessage("-100111", msg(13, "Taken.Down.Movie.2018.1080p.BluRay.x264-GRP.mkv"));
  assert.deepEqual(blocked, { status: "skipped", reason: "blocked" });
});
