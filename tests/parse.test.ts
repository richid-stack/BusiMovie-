import test from "node:test";
import assert from "node:assert/strict";
import { parseMediaTitleAndSeriesInfo } from "../src/services/seriesParser.js";

type Case = { file: string; title: string; year?: string; quality?: string; series?: boolean; season?: number; episode?: number };

const CASES: Case[] = [
  // ---- movies whose names look like "navigation" words, numbers or years ----
  { file: "Home.Alone.1990.1080p.BluRay.x264-GRP.mkv", title: "Home Alone", year: "1990", quality: "1080P" },
  { file: "Back to the Future (1985) 720p.mkv", title: "Back to the Future", year: "1985" },
  { file: "Ad.Astra.2019.1080p.WEB-DL.mkv", title: "Ad Astra", year: "2019" },
  { file: "The.Help.2011.1080p.BluRay.mkv", title: "The Help", year: "2011" },
  { file: "Next.2007.720p.BluRay.mkv", title: "Next", year: "2007" },
  { file: "300.2006.1080p.BluRay.x264.mkv", title: "300", year: "2006" },
  { file: "1917.2019.1080p.BluRay.x264.mkv", title: "1917", year: "2019" },
  { file: "2012.2009.1080p.BluRay.mkv", title: "2012", year: "2009" },
  { file: "Blade.Runner.2049.2017.1080p.BluRay.mkv", title: "Blade Runner 2049", year: "2017" },
  { file: "21.Jump.Street.2012.1080p.BluRay.mkv", title: "21 Jump Street", year: "2012" },
  { file: "12.Years.a.Slave.2013.720p.BluRay.mkv", title: "12 Years a Slave", year: "2013" },
  { file: "28.Days.Later.2002.1080p.mkv", title: "28 Days Later", year: "2002" },
  { file: "Wonder.Woman.1984.2020.1080p.WEB-DL.mkv", title: "Wonder Woman 1984", year: "2020" },
  { file: "Dune.2021.2160p.UHD.BluRay.mkv", title: "Dune", year: "2021", quality: "4K" },
  { file: "[Apple_Movies] Joker (2019) 1080p.mkv", title: "Joker", year: "2019" },
  { file: "Get.Out.2017.1080p.BluRay.mkv", title: "Get Out", year: "2017" },
  // ---- series ----
  { file: "Stranger.Things.S02E03.1080p.WEB-DL.mkv", title: "Stranger Things", series: true, season: 2, episode: 3 },
  { file: "Severance S01E05 720p.mkv", title: "Severance", series: true, season: 1, episode: 5 },
  { file: "The.Last.of.Us.S01E01.1080p.mkv", title: "The Last of Us", series: true, season: 1, episode: 1 },
  { file: "Breaking.Bad.1x05.720p.mkv", title: "Breaking Bad", series: true, season: 1, episode: 5 },
  { file: "Money Heist Season 2 Episode 4.mkv", title: "Money Heist", series: true, season: 2, episode: 4 }
];

for (const c of CASES) {
  test(`parse: ${c.file}`, () => {
    const r = parseMediaTitleAndSeriesInfo(c.file);
    assert.equal(r.cleanTitle, c.title, `title (got "${r.cleanTitle}")`);
    if (c.year) assert.equal(r.year, c.year, `year (got ${r.year})`);
    if (c.quality) assert.equal(String(r.quality).toUpperCase(), c.quality, `quality (got ${r.quality})`);
    assert.equal(!!r.isSeries, !!c.series, "isSeries");
    if (c.season !== undefined) assert.equal(r.season, c.season, "season");
    if (c.episode !== undefined) assert.equal(r.episode, c.episode, "episode");
  });
}

test("parse: year in brackets wins, last plausible year otherwise", () => {
  const a = parseMediaTitleAndSeriesInfo("2012 (2009) 1080p BluRay.mkv");
  assert.equal(a.year, "2009");
  assert.equal(a.cleanTitle, "2012");
  const b = parseMediaTitleAndSeriesInfo("Blade Runner 2049 2017 1080p.mkv");
  assert.equal(b.year, "2017");
  assert.equal(b.cleanTitle, "Blade Runner 2049");
});
