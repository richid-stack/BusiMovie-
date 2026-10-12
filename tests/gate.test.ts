import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TURSO_DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bm-gate-")), "t.db")}`;
delete process.env.TURSO_AUTH_TOKEN;

let G: typeof import("../src/bot/gate.js");
before(async () => {
  const D = await import("../src/db/index.js");
  await D.setupDatabase();
  G = await import("../src/bot/gate.js");
});

test("normalizeChatRef accepts ids, @names and t.me links, and explains private invite links", () => {
  assert.deepEqual(G.normalizeChatRef("@busimovie_chat"), { chat_id: "@busimovie_chat", username: "busimovie_chat" });
  assert.deepEqual(G.normalizeChatRef("https://t.me/busimovie_chat"), { chat_id: "@busimovie_chat", username: "busimovie_chat" });
  assert.deepEqual(G.normalizeChatRef("-1001234567890"), { chat_id: "-1001234567890", username: null });
  assert.deepEqual(G.normalizeChatRef("1234567890"), { chat_id: "-1001234567890", username: null });
  assert.ok("error" in G.normalizeChatRef("https://t.me/+AbCdEf123"));
  assert.ok("error" in G.normalizeChatRef(""));
});

test("member statuses", () => {
  assert.equal(G.isMemberStatus({ status: "member" }), true);
  assert.equal(G.isMemberStatus({ status: "creator" }), true);
  assert.equal(G.isMemberStatus({ status: "left" }), false);
  assert.equal(G.isMemberStatus({ status: "kicked" }), false);
  assert.equal(G.isMemberStatus({ status: "restricted", is_member: true }), true);
  assert.equal(G.isMemberStatus({ status: "restricted", is_member: false }), false);
});

test("gate: missing vs joined vs broken channels, with a remembered positive check", async () => {
  await G.addGateChannel({ chat_id: "@one", username: "one", title: "One", kind: "discussion" });
  await G.addGateChannel({ chat_id: "-100222", title: "Two", kind: "ads", invite_link: "https://t.me/+xyz" });
  await G.addGateChannel({ chat_id: "-100333", title: "Broken" });
  const calls: string[] = [];
  const member = new Set<string>();
  const tg = {
    async getChatMember(chat: string | number, user: number) {
      calls.push(`${chat}:${user}`);
      if (String(chat) === "-100333") throw new Error("chat not found");
      return { status: member.has(`${chat}:${user}`) ? "member" : "left" };
    },
  };
  let r = await G.checkUser(tg, 7);
  assert.deepEqual(r.missing.map((c) => c.chat_id), ["@one", "-100222"]);
  assert.deepEqual(r.broken.map((c) => c.chat_id), ["-100333"]);
  assert.equal(G.joinLinkOf(r.missing[0]), "https://t.me/one");
  assert.equal(G.joinLinkOf(r.missing[1]), "https://t.me/+xyz");

  member.add("@one:7");
  r = await G.checkUser(tg, 7);
  assert.deepEqual(r.missing.map((c) => c.chat_id), ["-100222"]);

  member.add("-100222:7");
  r = await G.checkUser(tg, 7);
  assert.equal(r.missing.length, 0);

  // the positive answers are remembered: no new Telegram calls for those two channels
  calls.length = 0;
  r = await G.checkUser(tg, 7);
  assert.deepEqual(calls, ["-100333:7"]);
  // …until it is time to re-check, or a fresh check is asked for
  calls.length = 0;
  await G.checkUser(tg, 7, { fresh: true });
  assert.equal(calls.length, 3);
  calls.length = 0;
  await G.checkUser(tg, 7, { now: Date.now() + 25 * 3_600_000 });
  assert.equal(calls.length, 3);
});

test("a viewer who left is asked again after the next fresh check", async () => {
  const tg = { async getChatMember() { return { status: "left" }; } };
  const r = await G.checkUser(tg, 7, { fresh: true });
  assert.ok(r.missing.some((c) => c.chat_id === "@one"));
});

test("pending request: one per viewer, latest wins, expires, and is taken exactly once", async () => {
  await G.savePending({ userId: "9", chatId: "9", kind: "callback", payload: { data: "watch_1" }, promptMsgId: null });
  await G.savePending({ userId: "9", chatId: "9", kind: "callback", payload: { data: "watch_2" }, promptMsgId: null });
  const p = await G.takePending(9);
  assert.equal(p!.payload.data, "watch_2");
  assert.equal(await G.takePending(9), null);
  await G.savePending({ userId: "9", chatId: "9", kind: "file", payload: { fileId: 3 }, promptMsgId: 5 }, Date.now() - 31 * 60_000);
  assert.equal(await G.takePending(9), null);
});

test("settings default to off, 24h", async () => {
  assert.deepEqual(await G.getGateSettings(), { enabled: false, ttlHours: 24 });
  await G.saveGateSettings({ enabled: true, ttlHours: 6 });
  assert.deepEqual(await G.getGateSettings(), { enabled: true, ttlHours: 6 });
});
