import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSeriesLine, seasonGap } from "../src/crawler/wishlist.js";

test("plain movie lines are not series", () => {
  assert.equal(parseSeriesLine("Inception 2010"), null);
  assert.equal(parseSeriesLine("The Dark Knight"), null);
  assert.equal(parseSeriesLine(""), null);
});

test("series markers", () => {
  assert.deepEqual(parseSeriesLine("series: Severance"), { title: "Severance", mode: "all", seasons: null });
  assert.deepEqual(parseSeriesLine("Severance (series)"), { title: "Severance", mode: "all", seasons: null });
  assert.equal(parseSeriesLine("Breaking Bad complete series")?.title, "Breaking Bad");
  assert.equal(parseSeriesLine("Breaking Bad complete series")?.mode, "all");
  assert.equal(parseSeriesLine("The Office all seasons")?.mode, "all");
});

test("season selectors", () => {
  assert.deepEqual(parseSeriesLine("Severance S2"), { title: "Severance", mode: "seasons", seasons: [2] });
  assert.deepEqual(parseSeriesLine("Dark S01-S03"), { title: "Dark", mode: "seasons", seasons: [1, 2, 3] });
  assert.deepEqual(parseSeriesLine("Ozark season 4"), { title: "Ozark", mode: "seasons", seasons: [4] });
  assert.deepEqual(parseSeriesLine("Ozark seasons 1 to 2"), { title: "Ozark", mode: "seasons", seasons: [1, 2] });
});

test("seasonGap: what is missing, and when to leave it alone", () => {
  const now = Date.now();
  assert.deepEqual(seasonGap([1, 2, 3], [1, 2, 3], { attempts24h: 0 }, now), { missing: [] });
  assert.deepEqual(seasonGap([1, 2, 3], [1], { attempts24h: 0 }, now), { missing: [2, 3] });
  assert.ok(seasonGap([1, 2], [1], { attempts24h: 3 }, now).blocked);
  assert.ok(seasonGap([1, 2], [1], { attempts24h: 1, lastFailedAt: now - 3600_000 }, now).blocked);
  assert.equal(seasonGap([1, 2], [1], { attempts24h: 1, lastFailedAt: now - 7 * 3600_000 }, now).blocked, undefined);
});
