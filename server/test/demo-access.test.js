import assert from "node:assert/strict";
import test from "node:test";
import { demoAccessCodeMatches, demoAccessConfigured } from "../src/demo-access.js";

test("démo refusée sans code serveur", () => {
  const previous = process.env.DEMO_ACCESS_CODE;
  delete process.env.DEMO_ACCESS_CODE;
  try {
    assert.equal(demoAccessConfigured(), false);
    assert.equal(demoAccessCodeMatches("oifnbd7884cs"), false);
  } finally {
    if (previous == null) delete process.env.DEMO_ACCESS_CODE;
    else process.env.DEMO_ACCESS_CODE = previous;
  }
});

test("démo acceptée seulement avec le code exact", () => {
  const previous = process.env.DEMO_ACCESS_CODE;
  process.env.DEMO_ACCESS_CODE = "oifnbd7884cs";
  try {
    assert.equal(demoAccessConfigured(), true);
    assert.equal(demoAccessCodeMatches("oifnbd7884cs"), true);
    assert.equal(demoAccessCodeMatches(" oifnbd7884cs "), true);
    assert.equal(demoAccessCodeMatches("OIFNBD7884CS"), false);
    assert.equal(demoAccessCodeMatches("wrong"), false);
    assert.equal(demoAccessCodeMatches(""), false);
  } finally {
    if (previous == null) delete process.env.DEMO_ACCESS_CODE;
    else process.env.DEMO_ACCESS_CODE = previous;
  }
});
