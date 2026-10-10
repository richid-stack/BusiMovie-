import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLineMovieInfo, cleanMovieReleaseTitle } from "../src/services/crawlerService.js";

const t = (l: string) => extractLineMovieInfo(l);

test("lines: plain, numbered, bulleted", () => {
  assert.equal(t("Inception").cleanTitle, "Inception");
  assert.equal(t("19. Inception (2010)").cleanTitle, "Inception");
  assert.equal(t("19. Inception (2010)").year, "2010");
  assert.equal(t("- The Dark Knight").cleanTitle, "The Dark Knight");
});

test("lines: comma stays in the title", () => {
  assert.equal(t("Hello, Dolly!").cleanTitle, "Hello, Dolly!");
});

test("lines: real CSV rows", () => {
  const r = t("3,Inception,2010,720p");
  assert.equal(r.cleanTitle, "Inception");
  assert.equal(r.year, "2010");
  assert.equal(r.quality, "720p");
});

test("lines: digit-only titles survive, row indexes don't", () => {
  assert.equal(t("300").cleanTitle, "300");
  assert.equal(t("1917").cleanTitle, "1917");
  assert.equal(t("12,").cleanTitle, "");
});

test("lines: headers and dividers are skipped", () => {
  assert.equal(t("title,year,quality").cleanTitle, "");
  assert.equal(t("| # | Movie | Year |").cleanTitle, "");
  assert.equal(t("|---|---|---|").cleanTitle, "");
});

test("lines: markdown table row", () => {
  const r = t("| 1 | Inception | 2010 | 1080p |");
  assert.equal(r.cleanTitle, "Inception");
  assert.equal(r.year, "2010");
});

test("clean: title with a number in it keeps it", () => {
  assert.equal(cleanMovieReleaseTitle("Blade.Runner.2049.2017.1080p.BluRay.x264").cleanTitle, "Blade Runner 2049");
  assert.equal(cleanMovieReleaseTitle("Blade.Runner.2049.2017.1080p.BluRay.x264").year, "2017");
});
