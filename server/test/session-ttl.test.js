import assert from "node:assert/strict";
import test from "node:test";
import {
  jwtMaxAgeMs,
  jwtTtl,
  sessionAuthTimeSec,
  sessionDeadlineMs,
  sessionRemainingMs
} from "../src/session-ttl.js";

test("durée de session par défaut : 22 h", () => {
  const previous = process.env.JWT_EXPIRES_IN;
  delete process.env.JWT_EXPIRES_IN;
  try {
    assert.equal(jwtTtl(), "22h");
    assert.equal(jwtMaxAgeMs(), 22 * 60 * 60 * 1000);
  } finally {
    if (previous == null) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN = previous;
  }
});

test("auth_time est conservé et la deadline ne glisse pas", () => {
  const previous = process.env.JWT_EXPIRES_IN;
  process.env.JWT_EXPIRES_IN = "22h";
  try {
    const authTime = 1_700_000_000;
    const payload = { auth_time: authTime };
    assert.equal(sessionAuthTimeSec(payload), authTime);
    assert.equal(sessionDeadlineMs(payload), authTime * 1000 + 22 * 60 * 60 * 1000);
    const now = authTime * 1000 + 10 * 60 * 60 * 1000;
    assert.equal(sessionRemainingMs(payload, now), 12 * 60 * 60 * 1000);
    const late = authTime * 1000 + 22 * 60 * 60 * 1000 + 1;
    assert.equal(sessionRemainingMs(payload, late) < 0, true);
  } finally {
    if (previous == null) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN = previous;
  }
});
