import crypto from "node:crypto";

const COOKIE = "_csrf";

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false",
    path: "/"
  };
}

function readSecret(req) {
  return String(req.cookies?.[COOKIE] || "");
}

function tokenFromSecret(secret) {
  return crypto.createHmac("sha256", secret).update("humana-csrf").digest("hex");
}

function ensureSecret(req, res) {
  let secret = readSecret(req);
  if (!/^[0-9a-f]{64}$/i.test(secret)) {
    secret = crypto.randomBytes(32).toString("hex");
    res.cookie(COOKIE, secret, cookieOpts());
  }
  return secret;
}

function sentToken(req) {
  return String(req.headers["x-csrf-token"] || req.body?._csrf || "");
}

function sameToken(sent, expected) {
  const a = Buffer.from(String(sent));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function csrfProtection(req, res, next) {
  const secret = ensureSecret(req, res);
  const expected = tokenFromSecret(secret);
  req.csrfToken = () => expected;
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  if (!sameToken(sentToken(req), expected)) {
    const error = new Error("csrf token invalid");
    error.code = "EBADCSRFTOKEN";
    error.status = 403;
    return next(error);
  }
  next();
}
