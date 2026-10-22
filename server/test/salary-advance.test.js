import assert from "node:assert/strict";
import test from "node:test";
import {
  ADVANCE_CUTOFF_DAY,
  evaluateSalaryAdvance,
  hasAdvanceSeniority,
  isAdvanceWindowOpen,
  latestNetSalary,
  minAdvanceMonths
} from "../src/salary-advance-rules.js";

const hired = { hired_at: "2025-01-15", leave_grade: "employee", job_title: "Conseiller" };
const cadre = { hired_at: "2026-07-20", leave_grade: "manager", job_title: "Responsable" };

test("collaborateur : 6 mois, cadre : 3 mois", () => {
  assert.equal(minAdvanceMonths(hired), 6);
  assert.equal(minAdvanceMonths(cadre), 3);
  assert.equal(hasAdvanceSeniority(hired, new Date("2025-07-15T12:00:00Z")), true);
  assert.equal(hasAdvanceSeniority(hired, new Date("2025-07-14T12:00:00Z")), false);
  assert.equal(hasAdvanceSeniority(cadre, new Date("2026-10-20T12:00:00Z")), true);
  assert.equal(hasAdvanceSeniority(cadre, new Date("2026-10-19T12:00:00Z")), false);
});

test("fenêtre bloquée à partir du 6 du mois (GMT+1)", () => {
  assert.equal(ADVANCE_CUTOFF_DAY, 6);
  assert.equal(isAdvanceWindowOpen(new Date("2026-10-05T22:30:00Z"), 60), true);
  assert.equal(isAdvanceWindowOpen(new Date("2026-10-05T23:30:00Z"), 60), false);
});

test("30 % du dernier salaire net EDS", () => {
  const net = latestNetSalary({
    "2026-08-01_2026-08-31": { u1: { salaireNet: "8000" } },
    "2026-09-01_2026-09-30": { u1: { salaireNet: "10000" } }
  }, "u1");
  const result = evaluateSalaryAdvance({
    profile: hired,
    requests: [],
    netSalary: net,
    amount: 3001,
    now: new Date("2026-10-03T10:00:00Z"),
    offsetMinutes: 60
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /30 %/);
  assert.equal(result.quota.maxAmount, 3000);
});

test("4 avances par an, hors refus", () => {
  const requests = [
    { status: "Approuve", created_at: "2026-01-02" },
    { status: "A valider", created_at: "2026-03-02" },
    { status: "Approuve", created_at: "2026-04-02" },
    { status: "Refuse", created_at: "2026-05-02" },
    { status: "Approuve", created_at: "2025-12-02" }
  ];
  const ok = evaluateSalaryAdvance({
    profile: hired,
    requests,
    netSalary: 10000,
    amount: 1000,
    now: new Date("2026-10-03T10:00:00Z")
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.quota.yearUsed, 3);
  const blocked = evaluateSalaryAdvance({
    profile: hired,
    requests: requests.concat({ status: "A valider", created_at: "2026-06-02" }),
    netSalary: 10000,
    amount: 1000,
    now: new Date("2026-10-03T10:00:00Z")
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /Quatre avances/);
});
