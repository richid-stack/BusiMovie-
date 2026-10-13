import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, isDigestDue } from "../src/bot/digest.js";

test("digest is due Friday evening, once a week", () => {
  const fri = new Date("2026-10-09T17:00:00Z"); // a Friday
  assert.equal(fri.getUTCDay(), 5);
  assert.ok(isDigestDue(fri, null));
  assert.ok(!isDigestDue(new Date("2026-10-09T10:00:00Z"), null)); // too early
  assert.ok(!isDigestDue(new Date("2026-10-10T17:00:00Z"), null)); // Saturday
  assert.ok(!isDigestDue(fri, fri.getTime() - 2 * 86_400_000)); // sent two days ago
  assert.ok(isDigestDue(fri, fri.getTime() - 7 * 86_400_000));
});

test("digest groups movies and series, escapes HTML, caps the list", () => {
  assert.equal(buildDigest([]), null);
  const d = buildDigest([
    { movie_title: "Fast <&> Furious", year: "2021", quality: "1080p" },
    { movie_title: "Fast <&> Furious", year: "2021", quality: "720p" },
    { movie_title: "Dark", season: 1, episode: 1 }, { movie_title: "Dark", season: 1, episode: 2 }, { movie_title: "Dark", season: 2, episode: 1 },
  ])!;
  assert.equal(d.count, 2);
  assert.match(d.text, /Fast &lt;&amp;&gt; Furious<\/b> \(2021\) · 1080p \/ 720p/);
  assert.match(d.text, /Dark<\/b> · S1 2 eps, S2 1 ep/);
  const many = buildDigest(Array.from({ length: 14 }, (_, i) => ({ movie_title: `Movie ${i}`, year: "2020" })), 10)!;
  assert.match(many.text, /and 4 more/);
});
