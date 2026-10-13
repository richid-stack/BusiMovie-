import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeDescription, DailyAllowance, searchTextFor } from "../src/bot/finder.js";
import { parseIdentifyJson } from "../src/services/gemini.js";

test("descriptions vs titles", () => {
  assert.equal(looksLikeDescription("Inception"), false);
  assert.equal(looksLikeDescription("the dark knight rises"), false);
  assert.equal(looksLikeDescription("movie where a guy wakes up in a loop"), true);
  assert.equal(looksLikeDescription("a man who lives the same day over and over again"), true);
  assert.equal(looksLikeDescription("Spider Man No Way Home"), false);
});
test("daily allowance", () => {
  const a = new DailyAllowance(2);
  const d = new Date("2026-01-01T10:00:00Z");
  assert.ok(a.take(1, d)); assert.ok(a.take(1, d)); assert.ok(!a.take(1, d));
  assert.ok(a.take(2, d));
  assert.ok(a.take(1, new Date("2026-01-02T00:01:00Z"))); // next day
});
test("parseIdentifyJson cleans, dedupes and caps", () => {
  const r = parseIdentifyJson('```json\n{"heard":"a loop movie","titles":[{"title":"Groundhog Day","year":"1993"},{"title":"groundhog day"},{"title":"Dark","year":"c. 2017","kind":"series"},{"title":""},{"title":"A"},{"title":"B1"},{"title":"C1"},{"title":"D1"}]}\n```');
  assert.equal(r.heard, "a loop movie");
  assert.deepEqual(r.titles.slice(0, 2), [{ title: "Groundhog Day", year: "1993", kind: "movie" }, { title: "Dark", year: "2017", kind: "tv" }]);
  assert.equal(r.titles.length, 5);
  assert.deepEqual(parseIdentifyJson("not json"), { titles: [] });
  assert.deepEqual(parseIdentifyJson('{"titles":"oops"}'), { titles: [] });
  assert.equal(searchTextFor({ title: "Dark", year: "2017" }), "Dark 2017");
});
