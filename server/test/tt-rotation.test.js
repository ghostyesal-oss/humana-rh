import assert from "node:assert/strict";
import test from "node:test";
import {
  assignTtRotation,
  isValidatedLeaveStatus,
  monthRotationOffset,
  ttQuotaForDept,
  ttWeekdaysForPerson
} from "../src/tt-rotation.js";

const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];

function kindsFor(assign, id) {
  return week.map((date) => assign[`${id}|${date}`]);
}

test("quotas : R&D 3j, CS/CES 2j", () => {
  assert.equal(ttQuotaForDept("rnd"), 3);
  assert.equal(ttQuotaForDept("cs"), 2);
  assert.equal(ttQuotaForDept("ces"), 2);
});

test("la rotation du mois décale le bloc de jours", () => {
  const a = ttWeekdaysForPerson(0, 0, 3);
  const b = ttWeekdaysForPerson(0, 1, 3);
  assert.notDeepEqual(a, b);
  assert.equal(a.length, 3);
  assert.equal(monthRotationOffset(2026, 10) !== monthRotationOffset(2026, 11), true);
});

test("R&D : 3 TT par semaine quand l'équipe le permet", () => {
  const people = [
    { id: "a", dept: "rnd" },
    { id: "b", dept: "rnd" },
    { id: "c", dept: "rnd" },
    { id: "d", dept: "rnd" }
  ];
  const assign = assignTtRotation(people, week, { year: 2026, monthIndex: 10 });
  people.forEach((person) => {
    const tt = kindsFor(assign, person.id).filter((kind) => kind === "TT").length;
    assert.equal(tt, 3);
  });
  week.forEach((date) => {
    const onsite = people.filter((person) => assign[`${person.id}|${date}`] === "PR");
    assert.ok(onsite.length >= 1, `bureau vide le ${date}`);
  });
});

test("petite équipe R&D : le bureau passe avant le quota", () => {
  const people = [
    { id: "a", dept: "rnd" },
    { id: "b", dept: "rnd" },
    { id: "c", dept: "rnd" }
  ];
  const assign = assignTtRotation(people, week, { year: 2026, monthIndex: 10 });
  week.forEach((date) => {
    assert.ok(people.some((person) => assign[`${person.id}|${date}`] === "PR"), date);
  });
  people.forEach((person) => {
    const tt = kindsFor(assign, person.id).filter((kind) => kind === "TT").length;
    assert.ok(tt >= 2 && tt <= 3);
  });
});

test("CS : 2 TT par semaine et bureau non vide", () => {
  const people = [
    { id: "c1", dept: "cs" },
    { id: "c2", dept: "cs" },
    { id: "c3", dept: "cs" }
  ];
  const assign = assignTtRotation(people, week, { year: 2026, monthIndex: 10 });
  people.forEach((person) => {
    const tt = kindsFor(assign, person.id).filter((kind) => kind === "TT").length;
    assert.equal(tt, 2);
  });
  week.forEach((date) => {
    assert.ok(people.some((person) => assign[`${person.id}|${date}`] === "PR"));
  });
});

test("2 personnes R&D : le bureau reste occupé même si le quota 3j se chevauche", () => {
  const people = [{ id: "r1", dept: "rnd" }, { id: "r2", dept: "rnd" }];
  const assign = assignTtRotation(people, week, { year: 2026, monthIndex: 10 });
  week.forEach((date) => {
    assert.ok(people.some((person) => assign[`${person.id}|${date}`] === "PR"), date);
  });
});

test("les congés (skip) ne comptent pas comme présence", () => {
  const people = [{ id: "a", dept: "cs" }, { id: "b", dept: "cs" }];
  const skip = new Set(["a|2026-11-02"]);
  const assign = assignTtRotation(people, week, { year: 2026, monthIndex: 10, skip });
  assert.equal(assign["a|2026-11-02"], undefined);
  assert.equal(assign["b|2026-11-02"], "PR");
});

test("récup / CP / déplacement : jours skippés, bureau toujours occupé", () => {
  const people = [
    { id: "a", dept: "cs" },
    { id: "b", dept: "cs" },
    { id: "c", dept: "cs" }
  ];
  const skip = new Set(["a|2026-11-02", "a|2026-11-03", "b|2026-11-02"]);
  const assign = assignTtRotation(people, week, { year: 2026, monthIndex: 10, skip });
  assert.equal(assign["a|2026-11-02"], undefined);
  assert.equal(assign["a|2026-11-03"], undefined);
  assert.equal(assign["b|2026-11-02"], undefined);
  week.forEach((date) => {
    const onsite = people.filter((person) => assign[`${person.id}|${date}`] === "PR");
    assert.ok(onsite.length >= 1, `bureau vide le ${date}`);
  });
});

test("statut congé validé (Validé / Approuve) sans matcher À valider", () => {
  assert.equal(isValidatedLeaveStatus("Validé"), true);
  assert.equal(isValidatedLeaveStatus("Approuve"), true);
  assert.equal(isValidatedLeaveStatus("Approuvé"), true);
  assert.equal(isValidatedLeaveStatus("A valider"), false);
  assert.equal(isValidatedLeaveStatus("A valider — Manager N+1"), false);
  assert.equal(isValidatedLeaveStatus("Refusé"), false);
  assert.equal(isValidatedLeaveStatus("Refuse"), false);
});
