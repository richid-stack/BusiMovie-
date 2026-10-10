import { test } from "node:test";
import assert from "node:assert/strict";
import { navigate, Goal, Advisor } from "../src/crawler/navigator.js";
import { classifyScreen } from "../src/crawler/classify.js";
import { makeScreen, buttonsFrom } from "../src/crawler/screen.js";
import { FakeBot } from "./helpers/fakeBot.js";

const movie = (title: string, year?: string, quality?: string): Goal => ({ kind: "movie", title, year, quality });
const vid = (fileName: string) => ({ isVideo: true, fileName, size: 1_500_000_000 });

// ── Delta-like: placeholder → results list → quality list → file ─────────────
const deltaLike = () =>
  new FakeBot(
    {
      searching: { text: "🔍 Searching…", then: "results" },
      results: {
        text: "Results for dune",
        buttons: [["Dune 1984"], ["Dune 2021"], ["Dune: Part Two 2024"], ["➡️ Next"]],
        go: { "Dune 2021": "quality" },
      },
      quality: {
        text: "Choose quality",
        buttons: [["480p • 700 MB"], ["1080p • 2.1 GB"], ["⬅️ Back"]],
        go: { "1080p • 2.1 GB": "file" },
      },
      file: { text: "", media: vid("Dune.2021.1080p.WEB-DL.mkv") },
    },
    "searching"
  );

test("delta-like: waits through the placeholder, picks the right film and quality, accepts the file", async () => {
  const bot = deltaLike();
  const r = await navigate(bot, movie("Dune", "2021", "1080p"), { command: "dune" });
  assert.equal(r.status, "media");
  assert.deepEqual(bot.clicks, ["Dune 2021", "1080p • 2.1 GB"]);
  assert.ok(r.trace.some((s) => s.action === "wait for edit"));
});

test("delta-like: never clicks Back or the wrong sequel", async () => {
  const bot = deltaLike();
  await navigate(bot, movie("Dune: Part Two", "2024"), { command: "dune part two" });
  assert.equal(bot.clicks[0], "Dune: Part Two 2024");
  assert.ok(!bot.clicks.some((c) => /back/i.test(c)));
});

// ── Apple-like: direct results with file buttons, then the file ─────────────
test("apple-like: direct buttons, then file", async () => {
  const bot = new FakeBot(
    {
      list: { text: "Found:", buttons: [["Inception 2010 1080p 2.3GB"], ["Inception 2010 720p 1.1GB"]], go: { "Inception 2010 1080p 2.3GB": "file" } },
      file: { text: "", media: vid("Inception.2010.1080p.BluRay.mkv") },
    },
    "list"
  );
  const r = await navigate(bot, movie("Inception", "2010", "1080p"), { command: "/search Inception" });
  assert.equal(r.status, "media");
  assert.equal((r as any).verified, true);
});

// ── Join gate ───────────────────────────────────────────────────────────────
test("gate: joins required channels, presses 'I joined', continues", async () => {
  const bot = new FakeBot(
    {
      gate: {
        text: "You must join our channels to use this bot.",
        buttons: [[{ text: "Join Channel 1", url: "https://t.me/+AbCdEf" }], [["✅ I Joined", "chk"]]],
        go: { "✅ I Joined": "list" },
      },
      list: { text: "Results", buttons: [["Heat 1995"]], go: { "Heat 1995": "file" } },
      file: { text: "", media: vid("Heat.1995.1080p.mkv") },
    },
    "gate"
  );
  const r = await navigate(bot, movie("Heat", "1995"), { command: "heat" });
  assert.equal(r.status, "media");
  assert.deepEqual(bot.joined, ["https://t.me/+AbCdEf"]);
});

test("gate: that never clears ends as blocked, not an endless loop", async () => {
  const bot = new FakeBot(
    {
      gate: { text: "Please join our channel first.", buttons: [[{ text: "Join", url: "https://t.me/chan" }], [["Check", "chk"]]], go: { Check: "gate" } },
    },
    "gate"
  );
  const r = await navigate(bot, movie("Heat"), { command: "heat" });
  assert.equal(r.status, "blocked");
});

// ── Empty / throttled / silent ──────────────────────────────────────────────
test("empty: 'no results' is not_found", async () => {
  const bot = new FakeBot({ e: { text: "❌ No results found for your query." } }, "e");
  const r = await navigate(bot, movie("Zzzz"), { command: "zzzz" });
  assert.equal(r.status, "not_found");
});

test("throttled: reports wait seconds", async () => {
  const bot = new FakeBot({ r: { text: "Too many requests. Try again in 30 seconds." } }, "r");
  const r = await navigate(bot, movie("Heat"), { command: "heat" });
  assert.equal(r.status, "blocked");
  assert.equal((r as any).waitSec, 30);
});

test("wrong film in the list: no confident match", async () => {
  const bot = new FakeBot({ l: { text: "Results", buttons: [["Titanic 1997"], ["Avatar 2009"]] } }, "l");
  const r = await navigate(bot, movie("Inception", "2010"), { command: "inception" });
  assert.equal(r.status, "not_found");
  assert.equal(bot.clicks.length, 0);
});

test("loop: bot returns to the same screen → stops", async () => {
  const bot = new FakeBot(
    { a: { text: "Pick", buttons: [["Heat 1995"]], go: { "Heat 1995": "b" } }, b: { text: "Pick again", buttons: [["Heat 1995 HD"]], go: { "Heat 1995 HD": "a" } } },
    "a"
  );
  const r = await navigate(bot, movie("Heat", "1995"), { command: "heat" });
  assert.equal(r.status, "failed");
  assert.match((r as any).reason, /same screen/);
});

test("wrong file is rejected after delivery", async () => {
  const bot = new FakeBot(
    { l: { text: "Results", buttons: [["Heat 1995 1080p"]], go: { "Heat 1995 1080p": "f" } }, f: { text: "", media: vid("Titanic.1997.1080p.mkv") } },
    "l"
  );
  const r = await navigate(bot, movie("Heat", "1995"), { command: "heat" });
  assert.equal(r.status, "wrong_file");
});

// ── Pagination ──────────────────────────────────────────────────────────────
test("pagination: follows Next until the title appears", async () => {
  const bot = new FakeBot(
    {
      p1: { text: "Page 1", buttons: [["Alien 1979"], ["Aliens 1986"], ["Next ›"]], go: { "Next ›": "p2" } },
      p2: { text: "Page 2", buttons: [["Arrival 2016"], ["Next ›"]], go: { "Arrival 2016": "f", "Next ›": "p1" } },
      f: { text: "", media: vid("Arrival.2016.1080p.mkv") },
    },
    "p1"
  );
  const r = await navigate(bot, movie("Arrival", "2016"), { command: "arrival" });
  assert.equal(r.status, "media");
});

// ── Series: Quinson-like ────────────────────────────────────────────────────
const quinson = () =>
  new FakeBot(
    {
      list: { text: "Series results", buttons: [["Breaking Bad", ["Breaking Bad", "sv_1"]].slice(0, 1) as any], go: { "Breaking Bad": "seasons" } },
      seasons: { text: "Seasons", buttons: [[["Season 1", "se_1_1"], ["Season 2", "se_1_2"]], ["🔙 Back"]] as any, go: { "Season 2": "eps" } },
      eps: {
        text: "Episodes",
        buttons: [[["E01", "epsel_1_2_1"], ["E02", "epsel_1_2_2"]], [["Send All", "sa_1_2"]]] as any,
        go: { E02: "file", "Send All": "bulk" },
      },
      file: { text: "", media: vid("Breaking.Bad.S02E02.720p.mkv") },
      bulk: { text: "Sending all episodes…" },
    },
    "list"
  );

test("series: picks season then episode", async () => {
  const bot = quinson();
  const r = await navigate(bot, { kind: "episode", title: "Breaking Bad", season: 2, episode: 2 }, { command: "Breaking Bad" });
  assert.equal(r.status, "media");
  assert.deepEqual(bot.clicks, ["Breaking Bad", "Season 2", "E02"]);
});

test("series: missing season → not_found, no wrong click", async () => {
  const bot = quinson();
  const r = await navigate(bot, { kind: "episode", title: "Breaking Bad", season: 7, episode: 1 }, { command: "Breaking Bad" });
  assert.equal(r.status, "not_found");
  assert.deepEqual(bot.clicks, ["Breaking Bad"]);
});

test("series: whole season presses send-all and hands over", async () => {
  const bot = quinson();
  const r = await navigate(bot, { kind: "season", title: "Breaking Bad", season: 2 }, { command: "Breaking Bad" });
  assert.equal(r.status, "delivering");
  assert.ok(bot.clicks.includes("Send All"));
});

// ── Advisor (AI eye) fallback ───────────────────────────────────────────────
test("advisor: used only when rules cannot decide, and its pick is still safety-checked", async () => {
  const bot = new FakeBot({ l: { text: "Pick one", buttons: [["🎞 Option A"], ["🎞 Option B"]], go: { "🎞 Option B": "f" } }, f: { text: "", media: vid("Heat.1995.mkv") } }, "l");
  const advisor: Advisor = { decide: async () => ({ action: "click", buttonIndex: 1, why: "B looks like the film" }) };
  const r = await navigate(bot, movie("Heat", "1995"), { command: "heat", advisor });
  assert.equal(r.status, "media");
});

test("advisor: cannot click Back", async () => {
  const bot = new FakeBot({ l: { text: "Pick one", buttons: [["🎞 Option A"], ["Back"]] } }, "l");
  const advisor: Advisor = { decide: async () => ({ action: "click", buttonIndex: 1, why: "bad idea" }) };
  const r = await navigate(bot, movie("Heat"), { command: "heat", advisor });
  assert.equal(r.status, "not_found");
  assert.equal(bot.clicks.length, 0);
});

// ── Classifier ──────────────────────────────────────────────────────────────
test("classifier: basic shapes", () => {
  const k = (text: string, rows: any[]) => classifyScreen(makeScreen({ msgId: 1, text, buttons: buttonsFrom(rows) })).kind;
  assert.equal(k("Choose season", [["Season 1"], ["Season 2"]]), "SEASONS");
  assert.equal(k("Eps", [["E1", "E2", "E3"]]), "EPISODES");
  assert.equal(k("Quality", [["720p • 1GB"], ["1080p • 2GB"]]), "QUALITY");
  assert.equal(k("Results", [["Heat 1995"], ["Heat 2 1999"]]), "LIST");
  assert.equal(k("Searching...", []), "PLACEHOLDER");
  assert.equal(k("Nothing found", []), "EMPTY");
});
