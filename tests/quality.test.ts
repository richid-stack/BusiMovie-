import { test } from "node:test";
import assert from "node:assert/strict";
import { detectQuality, judgeQuality, labelFor, missingTier } from "../src/crawler/quality.js";
import { chooseQuality } from "../src/crawler/navigator.js";
import { wantsCompanion } from "../src/crawler/settings.js";
import type { Button } from "../src/crawler/screen.js";

const btn = (text: string, i = 0): Button => ({ text, row: i, col: 0, data: `q_${i}` });

test("dimensions beat names; scope (cropped) movies are classified by width", () => {
  assert.equal(detectQuality({ width: 1920, height: 800, fileName: "x.720p.mkv" }), "1080p");
  assert.equal(detectQuality({ width: 1280, height: 536 }), "720p");
  assert.equal(detectQuality({ width: 854, height: 480 }), "below");
  assert.equal(detectQuality({ width: 3840, height: 1600 }), "4k");
});

test("names: 480p/CAM/DVDRip are below, 2160p/4K is 4k, nothing known is unknown", () => {
  assert.equal(detectQuality({ fileName: "Movie.2020.480p.WEBRip.mkv" }), "below");
  assert.equal(detectQuality({ fileName: "Movie.2020.HDCAM.mkv" }), "below");
  assert.equal(detectQuality({ fileName: "Movie.2020.DVDRip.x264.mkv" }), "below");
  assert.equal(detectQuality({ fileName: "Movie.2020.2160p.UHD.mkv" }), "4k");
  assert.equal(detectQuality({ fileName: "Movie.2020.1080p.WEB-DL.mkv" }), "1080p");
  assert.equal(detectQuality({ fileName: "Movie.2020.720p.mkv" }), "720p");
  assert.equal(detectQuality({ fileName: "Movie.mkv" }), "unknown");
});

test("judge: below 720p and 4K are rejected, unknown passes", () => {
  assert.equal(judgeQuality({ fileName: "a.480p.mkv" }).ok, false);
  assert.equal(judgeQuality({ fileName: "a.4k.mkv" }).ok, false);
  assert.equal(judgeQuality({ fileName: "a.mkv" }).ok, true);
  assert.equal(judgeQuality({ fileName: "a.1080p.mkv" }).ok, true);
});

test("label: measured wins, else what was asked, else HD", () => {
  assert.equal(labelFor("720p", "1080p"), "720p");
  assert.equal(labelFor("unknown", "1080p"), "1080p");
  assert.equal(labelFor("unknown", null), "HD");
  assert.equal(labelFor("unknown", "4k"), "HD");
});

test("chooseQuality never picks 4K or below 720p", () => {
  assert.equal(chooseQuality([btn("480p 700MB"), btn("720p 1.2GB", 1), btn("1080p 2.4GB", 2), btn("4K 9GB", 3)])?.text, "1080p 2.4GB");
  assert.equal(chooseQuality([btn("480p 700MB"), btn("720p 1.2GB", 1), btn("4K 9GB", 3)])?.text, "720p 1.2GB");
  assert.equal(chooseQuality([btn("480p 700MB"), btn("360p 400MB", 1)]), null);
  assert.equal(chooseQuality([btn("4K 9GB"), btn("2160p HDR", 1)]), null);
  assert.equal(chooseQuality([btn("1080p 2.4GB"), btn("720p 1.2GB", 1)], "720p")?.text, "720p 1.2GB");
});

test("bare size buttons are a last resort", () => {
  assert.equal(chooseQuality([btn("2.1 GB"), btn("1.1 GB", 1)])?.text, "2.1 GB");
  assert.equal(chooseQuality([btn("480p 700MB"), btn("2.1 GB", 1)])?.text, "2.1 GB");
});

test("second quality: the missing tier, and never a third copy", () => {
  assert.equal(missingTier(["1080p"]), "720p");
  assert.equal(missingTier(["720p"]), "1080p");
  assert.equal(missingTier(["1080p", "720p"]), null);
  assert.equal(missingTier(["HD"]), null); // unknown label: nothing to complement
  assert.equal(missingTier(["1080p", "HD"]), null);
  assert.equal(missingTier([]), null);
});

test("when a finished job queues a companion", () => {
  assert.equal(wantsCompanion("off", "user"), false);
  assert.equal(wantsCompanion("requested", "user"), true);
  assert.equal(wantsCompanion("requested", "cron"), false);
  assert.equal(wantsCompanion("all", "cron"), true);
  assert.equal(wantsCompanion("all", "companion"), false);
});
