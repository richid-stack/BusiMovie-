import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bm-")), "t.db");
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;
delete process.env.TURSO_AUTH_TOKEN;
process.env.DISABLE_FIRESTORE = "1";

let M: typeof import("../src/db/index.js");
before(async () => {
  M = await import("../src/db/index.js");
  await M.setupDatabase();
});

test("settings round-trip and survive a second setupDatabase() (a 'restart')", async () => {
  await M.setSetting("k1", "v1");
  await M.setupDatabase();
  assert.equal(await M.getSetting("k1"), "v1");
  await M.deleteSetting("k1");
  await M.setupDatabase();
  assert.equal(await M.getSetting("k1"), null); // deletes never resurrect
});

test("callback keys expire and are purged", async () => {
  await M.setCallbackKey("live", "a", "t", 3600);
  await M.setCallbackKey("dead", "b", "t", -10);
  assert.equal(await M.getCallbackKey("live"), "a");
  assert.equal(await M.getCallbackKey("dead"), null);
  assert.ok((await M.purgeExpiredCallbacks()) >= 1);
});

test("default bots are seeded once and an admin deactivation survives restart", async () => {
  const bots1 = (await M.db.execute("SELECT * FROM search_bots")).rows;
  assert.ok(bots1.length >= 3);
  await M.db.execute("UPDATE search_bots SET status = 'inactive' WHERE bot_username = '@iPapkornEzPzBot'");
  await M.setupDatabase();
  const ez = (await M.db.execute("SELECT status FROM search_bots WHERE bot_username = '@iPapkornEzPzBot'")).rows[0] as any;
  assert.equal(ez.status, "inactive");
});

test("no mirror files are written next to the app", () => {
  for (const f of ["vault_library.json", "settings_backup.json", "bots_backup.json", "targets_backup.json", "queue_backup.json"]) {
    assert.equal(fs.existsSync(path.join(process.cwd(), f)), false, f);
  }
});
