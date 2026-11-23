import pg from "pg";

let pool = null;

export function bankDatabaseConfigured() {
  return Boolean(String(process.env.BANK_DATABASE_URL || "").trim());
}

function bankPool() {
  if (!bankDatabaseConfigured()) {
    const error = new Error("Base bancaire non configurée.");
    error.status = 503;
    throw error;
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.BANK_DATABASE_URL,
      max: 4
    });
  }
  return pool;
}

export async function bankQuery(text, params) {
  if (params && params.length) return bankPool().query(text, params);
  return bankPool().query(text);
}

export async function ensureBankSchema() {
  if (!bankDatabaseConfigured()) return false;
  const ownerPassword = String(process.env.POSTGRES_PASSWORD || "");
  const bankPassword = String(process.env.BANK_POSTGRES_PASSWORD || "");
  if (ownerPassword && bankPassword && ownerPassword === bankPassword) {
    throw new Error("BANK_POSTGRES_PASSWORD doit être différent de POSTGRES_PASSWORD.");
  }
  await bankQuery(`
    create table if not exists public.bank_accounts (
      profile_id uuid primary key,
      ciphertext text not null,
      iv text not null,
      auth_tag text not null,
      last4 text not null,
      key_version smallint not null default 1,
      updated_at timestamptz not null default now(),
      updated_by uuid
    )
  `);
  return true;
}
