import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TURSO_DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bm-rc-")), "t.db")}`;
delete process.env.TURSO_AUTH_TOKEN;

let D: typeof import("../src/db/index.js");
before(async () => { D = await import("../src/db/index.js"); await D.setupDatabase(); });

const add = (n: number, title = `Movie Number ${n}`) => D.addMediaFile({ movie_id: `m${n}`, movie_title: title, year: "2020", telegram_file_id: String(1000 + n), telegram_channel_id: "-100", telegram_message_id: String(n), file_name: `${title.replace(/ /g, ".")}.2020.1080p.BluRay.x264-G${n}.mkv`, file_size: 1_000_000_000, quality: "1080p" } as any);

test("the library is read once, then served from memory until something changes", async () => {
  await add(1);
  let reads = 0;
  const orig = D.db.execute;
  (D.db as any).execute = async (s: any) => { if (String(typeof s === "string" ? s : s.sql).startsWith("SELECT * FROM media_files ORDER BY")) reads++; return orig(s); };
  try {
    const a = await D.getAllMediaFiles();
    await D.getAllMediaFiles(); await D.getVaultMovieCatalog("movie"); await D.getVaultSeriesCatalog("movie");
    assert.equal(reads, 1, "four lookups, one database read");
    assert.equal(a.length, 1);

    await add(2);                                   // a write invalidates it
    assert.equal((await D.getAllMediaFiles()).length, 2);
    assert.equal(reads, 2);

    await D.deleteMediaFile(Number(a[0].id));       // so does a delete
    assert.equal((await D.getAllMediaFiles()).length, 1);
    assert.equal(reads, 3);

    await D.db.execute({ sql: "UPDATE media_files SET poster_url = ? WHERE id > 0", args: ["x"] }); // and a raw update
    assert.equal((await D.getAllMediaFiles())[0].poster_url, "x");
    assert.equal(reads, 4);
  } finally { (D.db as any).execute = orig; }
});

test("callers cannot corrupt the cache by changing the list they get", async () => {
  const a = await D.getAllMediaFiles();
  a.length = 0;
  assert.ok((await D.getAllMediaFiles()).length >= 1);
});

test("library totals follow changes", async () => {
  const before_ = await D.getLibraryTotals();
  await add(3);
  const after = await D.getLibraryTotals();
  assert.equal(after.count, before_.count + 1);
});

test("title lookups use an index instead of scanning the table", async () => {
  const plan = async (sql: string, args: any[]) => (await D.db.execute({ sql: "EXPLAIN QUERY PLAN " + sql, args })).rows.map((r: any) => r.detail).join(" | ");
  const p1 = await plan(`SELECT id FROM media_files WHERE (LOWER(movie_title) = LOWER(?) OR REPLACE(REPLACE(REPLACE(REPLACE(LOWER(movie_title), ' ', ''), '.', ''), '-', ''), ':', '') = ?) LIMIT 1`, ["a", "a"]);
  assert.match(p1, /idx_media_title_lower/);
  assert.match(p1, /idx_media_title_flat4/);
  assert.match(await plan(`SELECT 1 FROM media_files WHERE telegram_channel_id=? AND telegram_message_id=?`, ["a", "1"]), /idx_media_msg/);
  assert.doesNotMatch(p1, /SCAN media_files/);
});
