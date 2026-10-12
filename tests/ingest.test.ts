import { test } from "node:test";
import assert from "node:assert/strict";
import { alreadyHave, judgePost } from "../src/crawler/ingest.js";

const post = (o: any) => ({ msgId: 1, size: 2e9, isVideo: true, ...o });
const rules = { min_file_size_mb: 300, quality_filter: "all" };

test("a normal 1080p film is accepted with its title, year and quality", () => {
  const v = judgePost(post({ fileName: "Dune.Part.Two.2024.1080p.WEB-DL.mkv" }), rules);
  assert.equal(v.ok, true);
  if (v.ok) { assert.equal(v.title, "Dune Part Two"); assert.equal(v.year, "2024"); assert.equal(v.quality, "1080p"); assert.equal(v.isSeries, false); }
});

test("a series episode keeps season and episode", () => {
  const v = judgePost(post({ fileName: "Severance.S02E03.720p.WEB.mkv", size: 5e8 }), rules);
  assert.equal(v.ok, true);
  if (v.ok) { assert.equal(v.isSeries, true); assert.equal(v.season, 2); assert.equal(v.episode, 3); assert.equal(v.quality, "720p"); }
});

test("rejects: below 720p, 4K, samples, tiny files, short clips, non-videos", () => {
  assert.equal((judgePost(post({ fileName: "Heat.1995.480p.mkv" }), rules) as any).code, "quality");
  assert.equal((judgePost(post({ fileName: "Heat.1995.2160p.mkv" }), rules) as any).code, "quality");
  assert.equal((judgePost(post({ fileName: "Heat.1995.1080p.SAMPLE.mkv" }), rules) as any).code, "junk");
  assert.equal((judgePost(post({ fileName: "Heat.1995.1080p.mkv", size: 5e6 }), rules) as any).code, "too_small");
  assert.equal((judgePost(post({ fileName: "Heat.1995.1080p.mkv", durationSec: 90 }), rules) as any).code, "too_short");
  assert.equal((judgePost(post({ fileName: "x.pdf", isVideo: false }), rules) as any).code, "not_video");
});

test("real dimensions override a misleading name", () => {
  assert.equal((judgePost(post({ fileName: "Heat.1995.1080p.mkv", width: 720, height: 404 }), rules) as any).code, "quality");
});

test("channel set to 1080p only skips 720p and unknown", () => {
  const r = { ...rules, quality_filter: "1080p" };
  assert.equal(judgePost(post({ fileName: "A.Film.2020.1080p.mkv" }), r).ok, true);
  assert.equal((judgePost(post({ fileName: "A.Film.2020.720p.mkv" }), r) as any).code, "filter");
  assert.equal((judgePost(post({ fileName: "A.Film.2020.mkv" }), r) as any).code, "filter");
  // legacy "4k" filter means "any accepted quality"
  assert.equal(judgePost(post({ fileName: "A.Film.2020.720p.mkv" }), { ...rules, quality_filter: "4k" }).ok, true);
});

test("title comes from the caption when the file name says nothing", () => {
  const v = judgePost(post({ fileName: "video_8812.mp4", caption: "Arrival (2016) 1080p" }), rules);
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.title, "Arrival");
  assert.equal((judgePost(post({ fileName: "video_8812.mp4" }), rules) as any).code, "no_title");
});

test("duplicates: same version is skipped, a different quality is not", () => {
  const a: any = { ok: true, title: "Dune Part Two", year: "2024", quality: "1080p", isSeries: false, season: null, episode: null, fileName: "x.mkv" };
  const held = [{ movie_title: "Dune: Part Two", year: "2024", quality: "720p" }];
  assert.equal(alreadyHave(a, 1, held), null);
  assert.match(alreadyHave(a, 1, [...held, { movie_title: "Dune Part Two", year: "2024", quality: "1080p" }]) || "", /already have/);
  assert.equal(alreadyHave(a, 1, [{ movie_title: "Dune Part Two", year: "1984", quality: "1080p" }]), null);
  assert.match(alreadyHave(a, 5, [{ movie_title: "Other", file_name: "x.mkv", file_size: 5 }]) || "", /exact file/);
});
