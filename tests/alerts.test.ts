import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSend } from "../src/services/alerts.js";
import { withDeadline, DeadlineError } from "../src/crawler/lock.js";

test("alerts: the same alert is rate limited, others are not", () => {
  assert.equal(shouldSend("a", 1000, 60_000), true);
  assert.equal(shouldSend("a", 2000, 60_000), false);
  assert.equal(shouldSend("b", 2000, 60_000), true);
  assert.equal(shouldSend("a", 70_000, 60_000), true);
});

test("withDeadline: returns results, rethrows task errors, and cuts off a hung task", async () => {
  assert.equal(await withDeadline("x", 100, async () => 7), 7);
  await assert.rejects(withDeadline("x", 100, async () => { throw new Error("boom"); }), /boom/);
  let cleaned = false;
  await assert.rejects(withDeadline("slow", 40, () => new Promise(() => {}), () => { cleaned = true; }), DeadlineError);
  assert.equal(cleaned, true);
});
