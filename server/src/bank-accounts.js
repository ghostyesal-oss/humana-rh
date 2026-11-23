import { hasIbiStepUp } from "./auth.js";
import { bankQuery } from "./bank-db.js";
import { decryptRib, encryptRib, parseRib } from "./bank-crypto.js";
import { adminQuery, logSensitiveAccess } from "./db.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function operatorAllowed(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return false;
  const result = await adminQuery(
    "select value from public.app_settings where key = 'ibi_operators' limit 1"
  );
  let value = result.rows[0]?.value;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch (_) { value = []; }
  }
  const list = Array.isArray(value) ? value : [];
  return list.some((item) => String(item || "").trim().toLowerCase() === email);
}

async function assertAccess(user, req) {
  if (!user?.sub || !hasIbiStepUp(req, user.sub)) {
    throw fail("Confirmation Microsoft requise.", 401);
  }
  if (!await operatorAllowed(user)) throw fail("Accès refusé.", 403);
}

function profileIdOf(raw) {
  const id = String(raw || "").trim().toLowerCase();
  if (!UUID.test(id)) throw fail("Collaborateur inconnu.", 400);
  return id;
}

export async function listBankAccounts(user, req) {
  await assertAccess(user, req);
  const result = await bankQuery(
    "select profile_id, last4 from public.bank_accounts order by updated_at desc"
  );
  return result.rows.map((row) => ({
    profile_id: row.profile_id,
    last4: String(row.last4 || "")
  }));
}

export async function readBankAccount(user, req, rawProfileId) {
  await assertAccess(user, req);
  const profileId = profileIdOf(rawProfileId);
  const result = await bankQuery(
    "select profile_id, ciphertext, iv, auth_tag from public.bank_accounts where profile_id = $1",
    [profileId]
  );
  const row = result.rows[0];
  if (!row) return null;
  let record;
  try {
    record = decryptRib(profileId, row);
  } catch (_) {
    throw fail("Compte illisible.", 500);
  }
  await logSensitiveAccess({
    actor: user,
    action: "bank.read",
    table: "bank_accounts",
    targetUserId: profileId
  });
  return {
    profile_id: profileId,
    bank: record.bank,
    city: record.city,
    account: record.account,
    key: record.key,
    holder: record.holder
  };
}

export async function saveBankAccount(user, req, rawProfileId, input) {
  await assertAccess(user, req);
  const profileId = profileIdOf(rawProfileId);
  const found = await adminQuery("select id from public.profiles where id = $1", [profileId]);
  if (!found.rows[0]) throw fail("Collaborateur inconnu.", 404);
  const record = parseRib(input);
  const sealed = encryptRib(profileId, record);
  await bankQuery(
    `insert into public.bank_accounts
       (profile_id, ciphertext, iv, auth_tag, last4, key_version, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (profile_id) do update set
       ciphertext = excluded.ciphertext,
       iv = excluded.iv,
       auth_tag = excluded.auth_tag,
       last4 = excluded.last4,
       key_version = excluded.key_version,
       updated_at = now(),
       updated_by = excluded.updated_by`,
    [
      profileId,
      sealed.ciphertext,
      sealed.iv,
      sealed.authTag,
      sealed.last4,
      sealed.keyVersion,
      user.sub
    ]
  );
  await logSensitiveAccess({
    actor: user,
    action: "bank.write",
    table: "bank_accounts",
    targetUserId: profileId
  });
  return { profile_id: profileId, last4: sealed.last4 };
}
