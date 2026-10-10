import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeScreen, Screen } from "../src/crawler/screen.js";
import type { Observation, Transport } from "../src/crawler/navigator.js";
import { collectSeason } from "../src/crawler/season.js";
import { FakeBot } from "./helpers/fakeBot.js";

process.env.TURSO_DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bm-eng-")), "t.db")}`;
delete process.env.TURSO_AUTH_TOKEN;

let J: typeof import("../src/crawler/jobs.js");
let E: typeof import("../src/crawler/engine.js");
before(async () => {
  const D = await import("../src/db/index.js");
  await D.setupDatabase();
  J = await import("../src/crawler/jobs.js");
  E = await import("../src/crawler/engine.js");
  await J.ensureCrawlerTables();
});

const vid = (fileName: string) => ({ isVideo: true, fileName, size: 1_000_000 });

// ── queue ───────────────────────────────────────────────────────────────────
test("queue: identical open requests share one job; user priority beats cron", async () => {
  const a = await J.enqueueJob({ kind: "movie", title: "Heat", year: "1995", priority: J.PRIORITY.cron });
  const b = await J.enqueueJob({ kind: "movie", title: "heat", year: "1995", priority: J.PRIORITY.user });
  assert.equal(a.id, b.id);
  assert.equal(b.existing, true);
  const c = await J.enqueueJob({ kind: "movie", title: "Alien", year: "1979", priority: J.PRIORITY.cron });
  const first = await J.claimNextJob();
  assert.equal(first!.id, a.id); // bumped to user priority
  assert.equal((await J.claimNextJob())!.id, c.id);
});

test("queue: interrupted jobs return to the line after a restart", async () => {
  const { id } = await J.enqueueJob({ kind: "movie", title: "Restart Test", year: "2000" });
  await J.claimNextJob();
  assert.equal((await J.getJob(id))!.status, "running");
  await J.resetInterruptedJobs();
  assert.equal((await J.getJob(id))!.status, "queued");
  await J.claimNextJob();
  await J.finishJob(id, "done");
});

test("queue: waitForJob resolves when the job finishes", async () => {
  const { id } = await J.enqueueJob({ kind: "movie", title: "Waiter", year: "2001" });
  const p = J.waitForJob(id, 2000);
  await J.finishJob(id, "done", { ok: 1 });
  assert.equal((await p)!.status, "done");
});

// ── engine failover ─────────────────────────────────────────────────────────
const job = async (o: any = {}) => {
  const { id } = await J.enqueueJob({ kind: "movie", title: "Inception", year: "2010", ...o });
  return (await J.getJob(id))!;
};

const listWithFile = (name: string) =>
  new FakeBot(
    { l: { text: "Results", buttons: [["Inception 2010 1080p"]], go: { "Inception 2010 1080p": "f" } }, f: { text: "", media: vid(name) } },
    "l"
  );
const emptyBot = () => new FakeBot({ e: { text: "No results found." } }, "e");

const deps = (bots: Record<string, Transport>, acquire?: any, scope: "movie" | "series" = "movie") => ({
  bots: async () => Object.keys(bots).map((h) => ({ handle: h, scope, commandTemplate: "{query}" })),
  open: async (h: string) => ({ transport: bots[h], close: async () => {} }),
  acquire: acquire ?? (async () => ({ mediaFileId: 1, vaultMsgId: 11 })),
  settleMs: 10,
});

test("engine: first bot has nothing, second delivers → done, with a trace per bot", async () => {
  E.resetCooldowns();
  const j = await job();
  const out = await E.runJob(j, deps({ "@a": emptyBot(), "@b": listWithFile("Inception.2010.1080p.mkv") }));
  assert.equal(out.status, "done");
  assert.equal(out.result!.bot, "@b");
  const traces = await J.getTraces(j.id);
  assert.deepEqual(traces.map((t: any) => t.outcome), ["not_found", "done"]);
});

test("engine: a bot whose file can't be stored is skipped (acquisition failover)", async () => {
  E.resetCooldowns();
  const j = await job({ title: "Inception2", year: "2011" });
  let calls = 0;
  const acquire = async () => { if (calls++ === 0) throw new Error("vault copy size differs"); return { mediaFileId: 2, vaultMsgId: 22 }; };
  const out = await E.runJob(
    { ...j, title: "Inception", year: "2010" },
    deps({ "@a": listWithFile("Inception.2010.mkv"), "@b": listWithFile("Inception.2010.mkv") }, acquire)
  );
  assert.equal(out.status, "done");
  assert.equal(out.result!.bot, "@b");
});

test("engine: everyone empty → not_found; everyone gated → needs_admin", async () => {
  E.resetCooldowns();
  const j = await job({ title: "Nothing Here", year: "1999" });
  assert.equal((await E.runJob(j, deps({ "@a": emptyBot(), "@b": emptyBot() }))).status, "not_found");
  const gate = () => new FakeBot({ g: { text: "Please join our channel first.", buttons: [[{ text: "Join", url: "https://t.me/x" }], [["Check", "c"]]], go: { Check: "g" } } }, "g");
  assert.equal((await E.runJob(j, deps({ "@a": gate() }))).status, "needs_admin");
});

test("engine: movies never use series-only bots, series never use movie bots", () => {
  const bots = [
    { handle: "@movie", scope: "movie" as const, commandTemplate: "{query}" },
    { handle: "@quinson", scope: "series" as const, commandTemplate: "{query}" },
  ];
  assert.deepEqual(E.eligible(bots, "movie").map((b) => b.handle), ["@movie"]);
  assert.deepEqual(E.eligible(bots, "episode").map((b) => b.handle), ["@quinson"]);
  assert.deepEqual(E.eligible(bots, "season").map((b) => b.handle), ["@quinson"]);
});

test("engine: query building and command templates", () => {
  assert.equal(E.buildQuery({ kind: "movie", title: "Spider-Man: No Way Home", year: "2021" }), "Spider Man No Way Home 2021");
  assert.equal(E.buildQuery({ kind: "season", title: "Breaking Bad", year: "2008" }), "Breaking Bad");
  assert.equal(E.commandFor({ handle: "@a", scope: "movie", commandTemplate: "/search {query}" }, "heat 1995"), "/search heat 1995");
});

// ── bulk season collector ───────────────────────────────────────────────────
class Stream implements Transport {
  constructor(private batches: Screen[][]) {}
  async send(): Promise<Observation> { return { screens: [] }; }
  async click(): Promise<Observation> { return { screens: [] }; }
  async settle(): Promise<Observation> { return { screens: this.batches.shift() ?? [] }; }
  async join() { return true; }
}
const file = (id: number, name: string) => makeScreen({ msgId: id, text: "", media: vid(name) });

test("season: takes files as they arrive, indexes the episode from the file name, stops at the expected count", async () => {
  const t = new Stream([[file(1, "Show.S02E01.mkv")], [], [file(2, "Show.S02E03.mkv"), file(3, "Show.S02E02.mkv")]]);
  const seen: number[] = [];
  const r = await collectSeason(t, { kind: "season", title: "Show", season: 2 }, async (_m, ep) => ({ mediaFileId: ep!, vaultMsgId: ep! * 10 }), {
    expected: 3, sliceMs: 1, idleMs: 1000, onEpisode: (e) => { seen.push(e.episode); },
  });
  assert.equal(r.reason, "complete");
  assert.deepEqual(seen, [1, 3, 2]); // delivered as they arrive, numbered by the file, not by arrival
});

test("season: wrong-season files and duplicates are not stored; idle ends the wait", async () => {
  const t = new Stream([[file(1, "Show.S02E01.mkv"), file(2, "Show.S03E01.mkv"), file(3, "Show.S02E01.mkv")]]);
  let now = 0;
  const r = await collectSeason(t, { kind: "season", title: "Show", season: 2 }, async (_m, ep) => ({ mediaFileId: ep!, vaultMsgId: 1 }), {
    expected: 5, sliceMs: 1, idleMs: 50, now: () => (now += 20),
  });
  assert.equal(r.episodes.length, 1);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.reason, "idle");
});

// ── browsing (season/episode lists) ─────────────────────────────────────────
test("browse: reads seasons and episodes from the bot and caches them", async () => {
  const B = await import("../src/crawler/browse.js");
  await B.ensureBlueprintTable();
  const mk = () =>
    new FakeBot(
      {
        list: { text: "Series", buttons: [[["Severance", "sv_1"]]], go: { Severance: "seasons" } },
        seasons: { text: "Seasons", buttons: [[["Season 1", "se_1_1"], ["Season 2", "se_1_2"]], ["🔙 Back"]] as any, go: { "Season 2": "eps" } },
        eps: { text: "Episodes", buttons: [[["E01", "epsel_1_2_1"], ["E02", "epsel_1_2_2"], ["E03", "epsel_1_2_3"]]] as any },
      },
      "list"
    );
  assert.deepEqual(await B.browseSeasons(mk(), "Severance", "Severance"), [1, 2]);
  assert.deepEqual(await B.browseEpisodes(mk(), "Severance", 2, "Severance"), [1, 2, 3]);
  assert.deepEqual(await B.cachedEpisodes("Severance", 2), [1, 2, 3]);
  assert.equal(await B.cachedEpisodes("Severance", 9), null);
});
