import crypto from "node:crypto";

const KEY_VERSION = 1;

function digits(value, size) {
  return String(value || "").replace(/\D/g, "").slice(0, size);
}

export function bankDataKey() {
  const raw = String(process.env.BANK_DATA_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    const error = new Error("BANK_DATA_KEY manquant ou invalide. Générer avec : openssl rand -hex 32");
    error.status = 503;
    throw error;
  }
  return Buffer.from(raw, "hex");
}

export function expectedRibKey(first22) {
  const mod = BigInt(first22) % 97n;
  return String(97n - mod).padStart(2, "0");
}

export function parseRib(input) {
  const source = input && typeof input === "object" ? input : {};
  const bank = digits(source.bank, 3);
  const city = digits(source.city, 3);
  const account = digits(source.account, 16);
  const key = digits(source.key, 2);
  const holder = String(source.holder || "").trim().slice(0, 80);
  const first = `${bank}${city}${account}`;
  if (first.length !== 22 || key.length !== 2) {
    const error = new Error("Le RIB doit contenir 3 + 3 + 16 + 2 chiffres.");
    error.status = 400;
    throw error;
  }
  if (key !== expectedRibKey(first)) {
    const error = new Error("La clé RIB est incorrecte.");
    error.status = 400;
    throw error;
  }
  const rib = `${first}${key}`;
  return { bank, city, account, key, holder, rib, last4: rib.slice(-4) };
}

export function encryptRib(profileId, record) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", bankDataKey(), iv);
  cipher.setAAD(Buffer.from(String(profileId)));
  const plaintext = Buffer.from(JSON.stringify({
    bank: record.bank,
    city: record.city,
    account: record.account,
    key: record.key,
    holder: record.holder
  }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    last4: record.last4,
    keyVersion: KEY_VERSION
  };
}

export function decryptRib(profileId, row) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    bankDataKey(),
    Buffer.from(String(row.iv || ""), "base64")
  );
  decipher.setAAD(Buffer.from(String(profileId)));
  decipher.setAuthTag(Buffer.from(String(row.auth_tag || row.authTag || ""), "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(String(row.ciphertext || ""), "base64")),
    decipher.final()
  ]);
  const parsed = JSON.parse(plaintext.toString("utf8"));
  return parseRib(parsed);
}
