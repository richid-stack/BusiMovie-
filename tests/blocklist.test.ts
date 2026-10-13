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
