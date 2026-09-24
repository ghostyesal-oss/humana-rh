import pg from "pg";

const adminUrl = process.env.DATABASE_URL || "";
if (!adminUrl) {
  throw new Error("DATABASE_URL manquant.");
}

const appUrl = process.env.APP_DATABASE_URL || "";
if (process.env.NODE_ENV === "production" && !appUrl) {
  throw new Error("APP_DATABASE_URL manquant: l'API ne doit pas parler en superuser.");
}

export const adminPool = new pg.Pool({
  connectionString: adminUrl,
  max: 4
});

export const pool = new pg.Pool({
  connectionString: appUrl || adminUrl,
  max: 20
});

export async function adminQuery(text, params) {
  if (params && params.length) return adminPool.query(text, params);
  return adminPool.query(text);
}

export async function query(text, params) {
  if (params && params.length) return pool.query(text, params);
  return pool.query(text);
}

export async function withAdmin(fn) {
  const client = await adminPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withUser(user, fn) {
  return withClient(async (client) => {
    await client.query("begin");
    try {
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [String(user?.sub || "")]);
      await client.query("select set_config('request.jwt.claim.role', $1, true)", [String(user?.role || "")]);
      await client.query("select set_config('request.jwt.claim.email', $1, true)", [String(user?.email || "")]);
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        /* connexion déjà abortée */
      }
      throw error;
    }
  });
}

export async function logSensitiveAccess({ actor, action, table, targetId, targetUserId, meta }) {
  try {
    await adminQuery(
      `insert into public.audit_log
        (actor_id, actor_email, action, target_table, target_id, target_user_id, meta)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        actor?.sub || null,
        actor?.email || null,
        action,
        table || null,
        targetId || null,
        targetUserId || null,
        JSON.stringify(meta || {})
      ]
    );
  } catch (error) {
    console.error("audit_log", error.message);
  }
}

export function rlsDenied(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "42501" || /row-level security|violates row-level/i.test(message);
}
