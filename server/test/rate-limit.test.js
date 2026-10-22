import assert from "node:assert/strict";
import test from "node:test";
import { rateLimit } from "../src/rate-limit.js";

function mockReq(ip = "10.0.0.1") {
  return { ip };
}

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    setHeader(key, value) { headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("rate-limit mémoire : autorise puis 429 sans base", () => {
  const mw = rateLimit({ windowMs: 60_000, max: 2, name: "test-rl" });
  let nextCount = 0;
  const next = () => { nextCount += 1; };

  mw(mockReq(), mockRes(), next);
  mw(mockReq(), mockRes(), next);
  const blocked = mockRes();
  mw(mockReq(), blocked, next);

  assert.equal(nextCount, 2);
  assert.equal(blocked.statusCode, 429);
});
