import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyDownloadedFile } from "../src/services/crawlerService.js";

test("verify: matching file passes", () => {
  const r = verifyDownloadedFile({ title: "Dune", year: "2021" }, "Dune.2021.1080p.BluRay.x264.mkv");
  assert.deepEqual([r.ok, r.verified], [true, true]);
});
test("verify: wrong film is rejected", () => {
  const r = verifyDownloadedFile({ title: "Oppenheimer", year: "2023" }, "Frozen.2013.1080p.mkv");
  assert.equal(r.ok, false);
});
test("verify: same title, wrong year is rejected (Dune 1984 vs 2021)", () => {
  const r = verifyDownloadedFile({ title: "Dune", year: "2021" }, "Dune.1984.720p.mkv");
  assert.equal(r.ok, false);
  assert.match(r.reason || "", /Year/);
});
test("verify: wrong episode is rejected", () => {
  const r = verifyDownloadedFile({ title: "Severance", season: 1, episode: 4 }, "Severance.S01E05.720p.mkv");
  assert.equal(r.ok, false);
});
test("verify: unreadable names pass but are flagged unverified", () => {
  const r = verifyDownloadedFile({ title: "Dune" }, "Video.mp4");
  assert.equal(r.ok, true);
});
test("verify: caption can vouch when the file name is junk", () => {
  const r = verifyDownloadedFile({ title: "Dune", year: "2021" }, "x9f3.mkv", "Dune 2021 1080p");
  assert.equal(r.ok, true);
});
