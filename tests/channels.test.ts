import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TURSO_DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bm-ch-")), "t.db")}`;
delete process.env.TURSO_AUTH_TOKEN;

let C: typeof import("../src/crawler/channels.js");
let D: typeof import("../src/db/index.js");
before(async () => {
  D = await import("../src/db/index.js");
  await D.setupDatabase();
  await D.setSetting("telegram_vault_channel_id", "-100MOVIES");
  await D.setSetting("telegram_series_vault_channel_id", "-100SERIES");
  C = await import("../src/crawler/channels.js");
  await D.db.execute(`CREATE TABLE IF NOT EXISTS channel_ingest (target_id INTEGER NOT NULL, msg_id INTEGER NOT NULL, status TEXT NOT NULL, reason TEXT, title TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (target_id, msg_id))`);
  await D.db.execute(`INSERT OR IGNORE INTO crawler_targets (id, channel_identifier, title, status, min_file_size_mb, quality_filter) VALUES (1,'@src','Source','active',300,'all')`);
});

let nextVault = 5000;
const forwards: Array<{ to: string; msg: number }> = [];
const client: any = {
  async getEntity(id: string) { return { id, title: id }; },
  async forwardMessages(vault: any, o: any) { forwards.push({ to: vault.id, msg: o.messages[0] }); return [{ id: ++nextVault }]; },
  async getMessages(_v: any, o: any) { return [{ id: o.ids[0], document: { size: lastSize, attributes: [{ className: "DocumentAttributeFilename", fileName: "x" }] } }]; },
};
let lastSize = 0;
const src = { id: "@src" };
const target = { id: 1, channel_identifier: "@src", title: "Source", status: "active", min_file_size_mb: 300, quality_filter: "all" };

const msg = (id: number, fileName: string, o: { size?: number; w?: number; h?: number; dur?: number } = {}) => {
  const size = o.size ?? 2_000_000_000;
  lastSize = size;
  return {
    id, message: "",
    document: {
      size, mimeType: "video/x-matroska",
      attributes: [
        { className: "DocumentAttributeFilename", fileName },
        { className: "DocumentAttributeVideo", duration: o.dur ?? 7200, w: o.w, h: o.h },
      ],
    },
  };
};

test("a 1080p film is saved into the movies vault with its quality", async () => {
  const r = await C.ingestPost(client, target, src, msg(1, "Dune.Part.Two.2024.1080p.WEB-DL.mkv", { w: 1920, h: 800 }));
  assert.equal(r.status, "saved");
  assert.deepEqual(forwards.at(-1), { to: "-100MOVIES", msg: 1 });
  const rows = (await D.db.execute("SELECT quality, season FROM media_files WHERE movie_title LIKE 'Dune%'")).rows as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quality, "1080p");
});

test("the same post twice is not forwarded again", async () => {
  const before = forwards.length;
  const r = await C.ingestPost(client, target, src, msg(1, "Dune.Part.Two.2024.1080p.WEB-DL.mkv", { w: 1920, h: 800 }));
  assert.equal(r.status, "ignored");
  assert.equal(forwards.length, before);
});

test("the same version re-posted elsewhere is skipped; the other quality is saved", async () => {
  const before = forwards.length;
  const dup = await C.ingestPost(client, target, src, msg(2, "Dune.Part.Two.2024.1080p.BluRay.mkv", { size: 3_000_000_000, w: 1920, h: 800 }));
  assert.equal(dup.status, "skipped");
  assert.match(dup.reason || "", /already have/);
  assert.equal(forwards.length, before);
  const p720 = await C.ingestPost(client, target, src, msg(3, "Dune.Part.Two.2024.720p.WEB-DL.mkv", { size: 1_200_000_000, w: 1280, h: 536 }));
  assert.equal(p720.status, "saved");
  const q = (await D.db.execute("SELECT quality FROM media_files WHERE movie_title LIKE 'Dune%' ORDER BY quality")).rows.map((r: any) => r.quality);
  assert.deepEqual(q, ["1080p", "720p"]);
});

test("below 720p and 4K never reach the vault", async () => {
  const before = forwards.length;
  const a = await C.ingestPost(client, target, src, msg(4, "Heat.1995.480p.DVDRip.mkv", { w: 854, h: 480 }));
  const b = await C.ingestPost(client, target, src, msg(5, "Heat.1995.2160p.UHD.mkv", { w: 3840, h: 1600 }));
  assert.equal(a.status, "skipped"); assert.match(a.reason || "", /below 720p/);
  assert.equal(b.status, "skipped"); assert.match(b.reason || "", /4K/);
  assert.equal(forwards.length, before);
});

test("series episodes go to the series vault", async () => {
  const r = await C.ingestPost(client, target, src, msg(6, "Severance.S02E03.1080p.WEB.mkv", { size: 900_000_000, w: 1920, h: 1080 }));
  assert.equal(r.status, "saved");
  assert.deepEqual(forwards.at(-1), { to: "-100SERIES", msg: 6 });
  const row = (await D.db.execute("SELECT season, episode FROM media_files WHERE movie_title LIKE 'Severance%'")).rows[0] as any;
  assert.equal(Number(row.season), 2); assert.equal(Number(row.episode), 3);
});

test("a failed forward is recorded as failed and retried next time", async () => {
  const bad: any = { ...client, async forwardMessages() { throw new Error("CHAT_WRITE_FORBIDDEN"); } };
  const r1 = await C.ingestPost(bad, target, src, msg(7, "Alien.1979.1080p.mkv", { w: 1920, h: 1038 }));
  assert.equal(r1.status, "failed");
  const r2 = await C.ingestPost(client, target, src, msg(7, "Alien.1979.1080p.mkv", { w: 1920, h: 1038 }));
  assert.equal(r2.status, "saved");
});
