import assert from "node:assert/strict";
import test from "node:test";
import { decryptRib, encryptRib, expectedRibKey, parseRib } from "../src/bank-crypto.js";

const PROFILE = "11111111-1111-4111-8111-111111111111";
const KEY = "ab".repeat(32);

function sample() {
  const first = "0078100000000000000019";
  return {
    bank: "007",
    city: "810",
    account: "0000000000000019",
    key: expectedRibKey(first),
    holder: "Camille Moreau"
  };
}

test("RIB : la clé se vérifie et un mauvais chiffre est refusé", () => {
  const record = parseRib(sample());
  assert.equal(record.rib, "007810000000000000001982");
  assert.equal(record.last4, "1982");
  assert.throws(() => parseRib({ ...sample(), key: "00" }), /clé RIB/i);
});

test("RIB : le chiffré ne contient pas le numéro et se déchiffre pour le même salarié", () => {
  const previous = process.env.BANK_DATA_KEY;
  process.env.BANK_DATA_KEY = KEY;
  try {
    const record = parseRib(sample());
    const sealed = encryptRib(PROFILE, record);
    assert.equal(sealed.ciphertext.includes("007810"), false);
    assert.equal(sealed.iv.includes(record.rib), false);
    const opened = decryptRib(PROFILE, sealed);
    assert.equal(opened.rib, record.rib);
    assert.equal(opened.holder, "Camille Moreau");
    assert.throws(() => decryptRib("22222222-2222-4222-8222-222222222222", sealed));
  } finally {
    process.env.BANK_DATA_KEY = previous;
  }
});

test("BANK_DATA_KEY : une clé trop courte est refusée", () => {
  const previous = process.env.BANK_DATA_KEY;
  process.env.BANK_DATA_KEY = "court";
  try {
    assert.throws(() => encryptRib(PROFILE, parseRib(sample())), /BANK_DATA_KEY/);
  } finally {
    process.env.BANK_DATA_KEY = previous;
  }
});
