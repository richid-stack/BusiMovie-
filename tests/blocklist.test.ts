import { test } from "node:test";
import assert from "node:assert/strict";
import { fileKey, sameSize, titleKey, matchFile, matchTitle } from "../src/crawler/blocklist.js";

test("file names compare regardless of punctuation and case", () => {
  assert.equal(fileKey("The.Movie.2020.1080p.mkv"), fileKey("the movie 2020 1080P MKV"));
  assert.equal(fileKey(""), "");
});
test("sizes within 1% match, unknown sizes match anything", () => {
  assert.ok(sameSize(1_000_000_000, 1_005_000_000));
  assert.ok(!sameSize(1_000_000_000, 1_200_000_000));
  assert.ok(sameSize(0, 5));
});
test("a blocked file is recognised only when name and size agree", () => {
  const rows = [{ id: 1, kind: "file", file_key: fileKey("Bad.Movie.2020.720p.mkv"), file_size: 900_000_000 }];
  assert.equal(matchFile(rows, "bad movie 2020 720p.MKV", 901_000_000)?.id, 1);
  assert.equal(matchFile(rows, "Bad.Movie.2020.720p.mkv", 1_900_000_000), null);
  assert.equal(matchFile(rows, "Other.mkv", 900_000_000), null);
});
test("a blocked title ignores 'The', punctuation and year unless both carry a different year", () => {
  const rows = [{ id: 2, kind: "title", title_key: titleKey("The Night: Returns"), year: "2019" }];
  assert.equal(matchTitle(rows, "Night Returns", "2019")?.id, 2);
  assert.equal(matchTitle(rows, "Night Returns", null)?.id, 2);
  assert.equal(matchTitle(rows, "Night Returns", "2024"), null);
  const any = [{ id: 3, kind: "title", title_key: titleKey("Ghost"), year: null }];
  assert.equal(matchTitle(any, "Ghost", "1990")?.id, 3);
});

import { assessBot, WINDOW, REST_MS } from "../src/crawler/botHealth.js";
const at = (o: string, ago = 0, now = 1_000_000_000_000) => ({ outcome: o, at: now - ago });
test("bot health: not-found and wrong-file never count against a bot", () => {
  const h = assessBot(Array.from({ length: 10 }, () => at("not_found")), 1_000_000_000_000);
  assert.equal(h.state, "ok");
});
test("bot health: pauses after repeated breakage, spares a bot with a recent success", () => {
  const now = 1_000_000_000_000;
  const broke = ["error", "timeout", "acquire_failed", "failed", "error", "done"].map((o, i) => at(o, i * 1000, now));
  assert.equal(assessBot(broke, now).state, "demoted");
  const mixed = ["error", "done", "error", "error", "error", "error"].map((o, i) => at(o, i * 1000, now));
  assert.notEqual(assessBot(mixed, now).state, "demoted");
  assert.equal(assessBot(["error", "error", "error", "done"].map((o, i) => at(o, i * 1000, now)), now).state, "degraded");
});
test("bot health: a rested bot gets another try, and a success clears it", () => {
  const now = 1_000_000_000_000;
  const old = ["error", "error", "error", "error", "error"].map((o, i) => at(o, REST_MS + 60_000 + i * 1000, now));
  assert.equal(assessBot(old, now).state, "probation");
  assert.equal(assessBot([at("done", 0, now), ...old], now).state, "ok");
  assert.ok(WINDOW >= 5);
});
