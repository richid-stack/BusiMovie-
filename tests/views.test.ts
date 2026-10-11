import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TURSO_DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bm-views-")), "t.db")}`;
delete process.env.TURSO_AUTH_TOKEN;
let V: typeof import("../src/db/views.js");
before(async () => {
  await (await import("../src/db/index.js")).setupDatabase();
  V = await import("../src/db/views.js");
});

test("views are summed per title over the last week and ignore punctuation/case", async () => {
  const now = new Date("2026-10-11T12:00:00Z");
  await V.recordView("Dune: Part Two", now);
  await V.recordView("dune part two", now);
  await V.recordView("Heat", new Date("2026-10-08T00:00:00Z"));
  await V.recordView("Old One", new Date("2026-09-20T00:00:00Z"));
  const m = await V.recentViews(7, now);
  assert.equal(m.get(V.viewKey("Dune Part Two")), 2);
  assert.equal(m.get("heat"), 1);
  assert.equal(m.has("oldone"), false);
});

test("junk titles are not recorded", async () => {
  assert.equal(await V.recordView("  "), false);
  assert.equal(await V.recordView("!"), false);
});
