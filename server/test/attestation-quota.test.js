import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTESTATION_TYPE_LIMIT,
  evaluateAttestationRequest,
  attestationTypeCounts,
  addMonthsToDateKey
} from "../src/attestation-rules.js";

const now = new Date("2026-10-22T10:00:00Z");

test("un même type est bloqué pendant 3 mois après la demande", () => {
  const requests = [
    { document_type: "Attestation de travail", status: "A valider", created_at: "2026-10-02T09:00:00Z" }
  ];
  const blocked = evaluateAttestationRequest({
    type: "Attestation de travail",
    requests,
    now
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /Attestation de travail/);
  assert.match(blocked.reason, /02\/01\/2027|3 mois/);
  assert.equal(blocked.nextAvailable, "2027-01-02");

  const otherType = evaluateAttestationRequest({
    type: "Attestation de salaire",
    requests,
    now
  });
  assert.equal(otherType.ok, true);
  assert.equal(otherType.remaining, ATTESTATION_TYPE_LIMIT);
});

test("après 3 mois révolus, le même type redevient possible", () => {
  const ok = evaluateAttestationRequest({
    type: "Attestation de travail",
    requests: [
      { document_type: "Attestation de travail", status: "Validé", created_at: "2026-07-22T10:00:00Z" }
    ],
    now
  });
  assert.equal(ok.ok, true);
});

test("la veille des 3 mois, le même type reste bloqué", () => {
  const blocked = evaluateAttestationRequest({
    type: "Attestation de travail",
    requests: [
      { document_type: "Attestation de travail", status: "Validé", created_at: "2026-07-23T10:00:00Z" }
    ],
    now
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.nextAvailable, "2026-10-23");
});

test("un refus ne compte pas dans le délai", () => {
  const requests = [
    { document_type: "Attestation de salaire", status: "Refusé", created_at: "2026-10-05T10:00:00Z" }
  ];
  const ok = evaluateAttestationRequest({
    type: "Attestation de salaire",
    requests,
    now
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.used, 0);
  assert.equal(attestationTypeCounts(requests, now).counts["Attestation de salaire"], 0);
});

test("les autres demandes RH ne sont pas limitées", () => {
  const ok = evaluateAttestationRequest({
    type: "Assurances",
    requests: [
      { document_type: "Assurances", status: "A valider", created_at: "2026-10-05T10:00:00Z" }
    ],
    now
  });
  assert.equal(ok.ok, true);
});

test("deux documents identiques dans le même lot sont bloqués", () => {
  const first = evaluateAttestationRequest({
    type: "Domiciliation de salaire",
    requests: [],
    now,
    extraUsed: 0
  });
  assert.equal(first.ok, true);
  const second = evaluateAttestationRequest({
    type: "Domiciliation de salaire",
    requests: [],
    now,
    extraUsed: 1
  });
  assert.equal(second.ok, false);
});

test("3 mois se calculent à partir de la date de demande", () => {
  assert.equal(addMonthsToDateKey("2026-10-22"), "2027-01-22");
  assert.equal(addMonthsToDateKey("2026-07-22"), "2026-10-22");
});
