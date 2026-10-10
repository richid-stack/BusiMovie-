import { test } from "node:test";
import assert from "node:assert/strict";
import { isBackOrNavButton, selectBestMatchingButton } from "../src/services/crawlerService.js";

const btn = (text: string, i = 0) => ({ text, row: i, col: 0 });

test("nav: real navigation buttons", () => {
  for (const t of ["Back", "🔙 Back", "« Back", "Next ›", "1/5", "⬅️", "Main Menu", "Cancel", "Back to results", "Join our channel", "Join @movies"]) {
    assert.equal(isBackOrNavButton(t), true, t);
  }
});

test("nav: film titles are NOT navigation", () => {
  for (const t of ["Home Alone (1990)", "Return of the Jedi 1983", "Close Encounters of the Third Kind", "Ad Astra 2019", "Support Your Local Sheriff", "The Next Three Days"]) {
    assert.equal(isBackOrNavButton(t), false, t);
  }
});

test("select: picks the right sequel", () => {
  const b = [btn("Dune 1984", 0), btn("Dune: Part Two 2024", 1), btn("Dune 2021", 2)];
  assert.equal(selectBestMatchingButton(b, "Dune", "2021")?.text, "Dune 2021");
});

test("select: refuses an unrelated list instead of taking the first", () => {
  const b = [btn("Frozen 2013", 0), btn("Shrek 2001", 1)];
  assert.equal(selectBestMatchingButton(b, "Oppenheimer", "2023"), null);
});

test("select: never returns a Back button", () => {
  assert.equal(selectBestMatchingButton([btn("Back"), btn("Next ›", 1)], "Oppenheimer"), null);
});

test("select: bare quality buttons still resolve by quality", () => {
  const b = [btn("720p • 900 MB", 0), btn("1080p • 2.1 GB", 1)];
  assert.equal(selectBestMatchingButton(b, "Oppenheimer", "2023", "1080p")?.text, "1080p • 2.1 GB");
});
