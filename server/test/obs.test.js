import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHealth,
  percentile,
  shouldSkipAccessLog
} from "../src/obs.js";

test("percentile p50 / p95", () => {
  const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(samples, 50), 50);
  assert.equal(percentile(samples, 95), 100);
  assert.equal(percentile([], 50), 0);
});

test("le health OK n'encombre pas les logs d'accès", () => {
  assert.equal(shouldSkipAccessLog({ method: "GET", originalUrl: "/api/health" }, 200), true);
  assert.equal(shouldSkipAccessLog({ method: "GET", originalUrl: "/api/health" }, 503), false);
  assert.equal(shouldSkipAccessLog({ method: "POST", originalUrl: "/api/db" }, 200), false);
});

test("health : db ok vs timeout", async () => {
  const ok = await buildHealth(async () => true);
  assert.equal(ok.ok, true);
  assert.equal(ok.db, "ok");
  assert.equal(typeof ok.uptimeSec, "number");
  assert.equal(typeof ok.requests, "number");

  const bad = await buildHealth(async () => {
    throw new Error("down");
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.db, "error");
});
