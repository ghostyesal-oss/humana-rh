import assert from "node:assert/strict";
import test from "node:test";
import { assertJwtSecret } from "../src/jwt-secret.js";

test("JWT_SECRET: refuse un secret trop court", () => {
  const prev = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "trop-court";
  try {
    assert.throws(() => assertJwtSecret(), /32 caractères/);
  } finally {
    process.env.JWT_SECRET = prev;
  }
});

test("JWT_SECRET: refuse la valeur d'exemple", () => {
  const prev = process.env.JWT_SECRET;
  process.env.JWT_SECRET = ["changez-moi", "une-chaine", "de-plus-de", "32-caracteres"].join("-");
  try {
    assert.throws(() => assertJwtSecret(), /valeur d'exemple/);
  } finally {
    process.env.JWT_SECRET = prev;
  }
});

test("JWT_SECRET: accepte un secret assez long", () => {
  const prev = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "a".repeat(32);
  try {
    assert.equal(assertJwtSecret(), "a".repeat(32));
  } finally {
    process.env.JWT_SECRET = prev;
  }
});
