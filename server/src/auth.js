import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { query, withClient } from "./db.js";

const COOKIE = "humana_session";
const STATE_COOKIE = "humana_oauth_state";

function privilegedCreatorEmails() {
  return String(process.env.BOOTSTRAP_CREATOR_EMAILS || "")
    .split(/[,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isPrivilegedCreatorEmail(email) {
  return privilegedCreatorEmails().includes(String(email || "").trim().toLowerCase());
}

async function grantCreatorAccess(profile, email) {
  if (!profile?.id || !isPrivilegedCreatorEmail(email)) return profile;
  const normalized = String(email).trim().toLowerCase();
  try {
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await client.query("set local session_replication_role = replica");
        if (profile.role !== "creator") {
          await client.query("update public.profiles set role = 'creator' where id = $1", [profile.id]);
          profile = { ...profile, role: "creator" };
        }
        const { rows } = await client.query(
          "select value from public.app_settings where key = 'studio_creators' limit 1"
        );
        let emails = [];
        const raw = rows[0]?.value;
        if (Array.isArray(raw)) emails = raw;
        else if (raw) {
          try {
            emails = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
          } catch {
            emails = [];
          }
        }
        if (!Array.isArray(emails)) emails = [];
        const next = [...new Set([
          ...emails.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean),
          normalized
        ])];
        const payload = JSON.stringify(next);
        if (rows.length) {
          await client.query(
            "update public.app_settings set value = $1::jsonb where key = 'studio_creators'",
            [payload]
          );
        } else {
          await client.query(
            "insert into public.app_settings (key, value) values ('studio_creators', $1::jsonb)",
            [payload]
          );
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
  } catch (error) {
    console.error("grantCreatorAccess", error);
  }
  return profile;
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new Error("JWT_SECRET doit faire au moins 32 caractères.");
  }
  return secret;
}

export function signUser(profile) {
  return jwt.sign(
    {
      sub: profile.id,
      email: profile.email,
      role: profile.role || "employee",
      name: profile.full_name || ""
    },
    jwtSecret(),
    { expiresIn: "7d" }
  );
}

export function readToken(req) {
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const token = bearer || req.cookies?.[COOKIE] || "";
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret());
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false"
  });
}

export async function loadProfile(userId) {
  const { rows } = await query("select * from public.profiles where id = $1 limit 1", [userId]);
  return rows[0] || null;
}

export async function findProfileByEmail(email) {
  const { rows } = await query(
    "select * from public.profiles where lower(email) = lower($1) limit 1",
    [email]
  );
  return rows[0] || null;
}

export function requireAuth(req, res, next) {
  const payload = readToken(req);
  if (!payload?.sub) {
    return res.status(401).json({ data: null, error: { message: "Non authentifié." } });
  }
  req.user = payload;
  loadProfile(payload.sub)
    .then((profile) => {
      if (profile?.role) {
        req.user = {
          ...payload,
          role: profile.role,
          email: profile.email || payload.email
        };
      }
      next();
    })
    .catch((error) => next(error));
}

function entraEnv(name) {
  return String(process.env[name] || "").trim();
}

function tenantUrl() {
  let tenant = entraEnv("ENTRA_TENANT_ID") || "common";
  if (tenant === "commun") tenant = "common";
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
}

function callbackUrl(req) {
  const configured = entraEnv("ENTRA_REDIRECT_URI");
  if (configured) return configured;
  const origin = entraEnv("APP_ORIGIN").replace(/\/$/, "");
  if (origin) return `${origin}/api/auth/microsoft/callback`;
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/auth/microsoft/callback`;
}

export function startMicrosoftLogin(req, res) {
  const clientId = entraEnv("ENTRA_CLIENT_ID");
  if (!clientId) {
    return res.status(500).send("ENTRA_CLIENT_ID manquant.");
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false",
    maxAge: 10 * 60 * 1000,
    path: "/"
  });
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: callbackUrl(req),
    response_mode: "query",
    scope: "openid email profile User.Read",
    state
  });
  res.redirect(`${tenantUrl()}/authorize?${params.toString()}`);
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return {};
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export async function finishMicrosoftLogin(req, res) {
  try {
    const { code, state, error, error_description: description } = req.query;
    if (error) {
      return res.redirect(`/?error=${encodeURIComponent(description || error)}`);
    }
    if (!code || !state || state !== req.cookies?.[STATE_COOKIE]) {
      return res.redirect("/?error=Etat+OAuth+invalide");
    }
    res.clearCookie(STATE_COOKIE, { path: "/" });

    const tokenRes = await fetch(`${tenantUrl()}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: entraEnv("ENTRA_CLIENT_ID"),
        client_secret: entraEnv("ENTRA_CLIENT_SECRET"),
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: callbackUrl(req)
      })
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.redirect(`/?error=${encodeURIComponent(tokenJson.error_description || "Echange+token+Microsoft+echoue")}`);
    }

    const claims = decodeJwtPayload(tokenJson.id_token);
    let email = String(claims.email || claims.preferred_username || "").trim().toLowerCase();
    let fullName = String(claims.name || "").trim();
    if (!email && tokenJson.access_token) {
      const me = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` }
      });
      if (me.ok) {
        const body = await me.json();
        email = String(body.mail || body.userPrincipalName || "").trim().toLowerCase();
        fullName = fullName || String(body.displayName || "").trim();
      }
    }
    if (!email) {
      return res.redirect("/?error=Microsoft+n+a+pas+transmis+d+e-mail");
    }

    let profile = await findProfileByEmail(email);
    if (!profile) {
      let row = null;
      try {
        const invite = await query(
          "select * from public.pending_invites where lower(email) = $1 limit 1",
          [email]
        );
        row = invite.rows[0];
      } catch (_) {
        row = null;
      }
      const privileged = isPrivilegedCreatorEmail(email);
      if (!row && !privileged && process.env.ALLOW_UNKNOWN_LOGIN !== "true") {
        return res.redirect("/?error=Compte+non+invite.+Contactez+un+administrateur.");
      }
      const created = await query(
        `insert into public.profiles (id, email, full_name, role, job_title, department)
         values (gen_random_uuid(), $1, $2, $3, $4, $5)
         returning *`,
        [
          email,
          row?.full_name || fullName || email,
          row?.role || (privileged ? "creator" : "employee"),
          row?.job_title || (privileged ? "Administrateur" : "Collaborateur"),
          row?.department || "General"
        ]
      );
      profile = created.rows[0];
      if (row?.id) {
        await query("delete from public.pending_invites where id = $1", [row.id]);
      }
    }

    profile = await grantCreatorAccess(profile, email);
    const token = signUser(profile);
    setSessionCookie(res, token);
    res.redirect("/");
  } catch (error) {
    console.error(error);
    res.redirect("/?error=Connexion+Microsoft+impossible");
  }
}

export function sessionPayload(user, profile) {
  return {
    access_token: "cookie",
    token_type: "bearer",
    user: {
      id: user.sub,
      email: user.email,
      role: profile?.role || user.role,
      user_metadata: { full_name: profile?.full_name || user.name || user.email }
    }
  };
}
