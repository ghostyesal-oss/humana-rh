import assert from "node:assert/strict";
import test from "node:test";
import { resolveSelectLimit } from "../src/query-limit.js";

test("select: un oubli de limit ne rapatrie plus tout l'historique", () => {
  assert.equal(resolveSelectLimit("time_punches"), 2000);
  assert.equal(resolveSelectLimit("attestation_requests"), 200);
  assert.equal(resolveSelectLimit("salary_advance_requests"), 200);
  assert.equal(resolveSelectLimit("leave_requests"), 500);
});

test("select: le client peut demander plus, dans un plafond", () => {
  assert.equal(resolveSelectLimit("time_punches", 8000), 8000);
  assert.equal(resolveSelectLimit("time_punches", 999999), 20000);
  assert.equal(resolveSelectLimit("attestation_requests", 200), 200);
  assert.equal(resolveSelectLimit("attestation_requests", 9000), 400);
});

test("select: l'annuaire n'est pas tronqué", () => {
  assert.equal(resolveSelectLimit("profiles"), 0);
  assert.equal(resolveSelectLimit("profiles_directory"), 0);
  assert.equal(resolveSelectLimit("app_settings"), 0);
  assert.equal(resolveSelectLimit("profiles", 10), 10);
});
