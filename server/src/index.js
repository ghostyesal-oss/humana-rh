import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import multer from "multer";
import {
  bumpSessionEpoch,
  clearSessionCookie,
  finishMicrosoftLogin,
  loadProfile,
  readToken,
  requireAuth,
  sessionMatchesProfile,
  sessionPayload,
  setSessionCookie,
  signUser,
  startMicrosoftLogin
} from "./auth.js";
import { assertJwtSecret } from "./jwt-secret.js";
import csrf from "csurf";
import { rateLimit } from "./rate-limit.js";
import { runQuery } from "./query.js";
import { runRpc } from "./rpc.js";
import { publicUrl, readFile, removeFile, saveFile, assertCanReadStorage } from "./storage.js";
import { runMigrations } from "./migrate.js";
import { logSensitiveAccess, query } from "./db.js";
import { buildHealth, installProcessHandlers, logJson, requestLogger } from "./obs.js";
import { demoAccessCodeMatches, demoAccessConfigured } from "./demo-access.js";

installProcessHandlers();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
function allowedOrigins() {
  const items = new Set();
  const add = (raw) => {
    const value = String(raw || "").trim().replace(/\/$/, "");
    if (!value) return;
    if (/^https?:\/\//i.test(value)) {
      items.add(value);
      return;
    }
    const host = value.replace(/^https?:\/\//i, "");
    items.add(`https://${host}`);
    if (process.env.COOKIE_SECURE === "false") items.add(`http://${host}`);
  };
  add(process.env.APP_ORIGIN);
  add(process.env.HUMANA_DOMAIN);
  String(process.env.CORS_ORIGINS || "").split(/[,;]+/).forEach(add);
  const host = String(process.env.HUMANA_DOMAIN || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
  if (host && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && !/^www\./i.test(host)) {
    add(`https://${host}`);
    add(`https://www.${host}`);
  }
  return items;
}

const origins = allowedOrigins();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(requestLogger);
app.use(cookieParser());
app.use(express.json({ limit: "8mb" }));
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, false);
    callback(null, origins.has(String(origin).replace(/\/$/, "")));
  },
  credentials: true
}));

function sameOrigin(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  if (!origin) return next();
  if (!origins.size || !origins.has(origin)) {
    return res.status(403).json({ error: "Origine refusée." });
  }
  next();
}

function readQueryRequest(body) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  return {
    table: String(input.table || ""),
    op: String(input.op || "select"),
    select: input.select == null ? "*" : String(input.select),
    filters: Array.isArray(input.filters) ? input.filters : [],
    payload: input.payload,
    order: input.order && typeof input.order === "object"
      ? { column: String(input.order.column || ""), ascending: input.order.ascending !== false }
      : null,
    limit: Number(input.limit) || 0,
    onConflict: String(input.onConflict || "id"),
    maybeSingle: Boolean(input.maybeSingle),
    single: Boolean(input.single)
  };
}

app.use("/api", sameOrigin);
app.use("/api", csrf({
  cookie: {
    key: "_csrf",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false",
    path: "/"
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, name: "auth" });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 90, name: "write" });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, name: "api" });
app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  return apiLimiter(req, res, next);
});

app.get("/api/auth/csrf", authLimiter, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

app.get("/api/health", async (_req, res) => {
  const payload = await buildHealth(() => query("select 1"));
  res.status(payload.ok ? 200 : 503).json(payload);
});

app.post("/api/demo/unlock", authLimiter, (req, res) => {
  if (!demoAccessConfigured()) {
    return res.status(503).json({ data: null, error: { message: "Démo indisponible." } });
  }
  const code = req.body && typeof req.body === "object" ? req.body.code : "";
  if (!demoAccessCodeMatches(code)) {
    logJson("info", "demo.unlock.denied");
    return res.status(403).json({ data: null, error: { message: "Code d'accès incorrect." } });
  }
  res.json({ data: { ok: true }, error: null });
});

app.get("/api/auth/microsoft", authLimiter, startMicrosoftLogin);
app.get("/api/auth/microsoft/callback", authLimiter, finishMicrosoftLogin);

app.get("/api/auth/session", async (req, res) => {
  const user = readToken(req);
  if (!user) return res.json({ data: { session: null }, error: null });
  const profile = await loadProfile(user.sub);
  if (!sessionMatchesProfile(user, profile)) {
    return res.json({ data: { session: null }, error: null });
  }
  res.json({ data: { session: sessionPayload(user, profile) }, error: null });
});

app.post("/api/auth/logout", async (req, res) => {
  const user = readToken(req);
  try {
    if (user?.sub) await bumpSessionEpoch(user.sub);
  } catch (error) {
    logJson("error", "logout epoch", { err: error });
    return res.status(500).json({
      error: { message: "Déconnexion incomplète. Réessayez." }
    });
  }
  clearSessionCookie(res);
  res.json({ error: null });
});

app.post("/api/auth/refresh", async (req, res) => {
  const user = readToken(req);
  if (!user) return res.status(401).json({ data: { session: null }, error: { message: "Session expirée." } });
  const profile = await loadProfile(user.sub);
  if (!sessionMatchesProfile(user, profile)) {
    clearSessionCookie(res);
    return res.status(401).json({ data: { session: null }, error: { message: "Session révoquée." } });
  }
  const token = signUser(profile);
  setSessionCookie(res, token);
  res.json({ data: { session: sessionPayload({ ...user, epoch: profile.session_epoch }, profile) }, error: null });
});

app.post("/api/db", requireAuth, writeLimiter, async (req, res) => {
  try {
    const result = await runQuery(req.user, readQueryRequest(req.body));
    const status = result.error ? (result.error.code === "PGRST116" ? 406 : 400) : 200;
    res.status(status).json(result);
  } catch (error) {
    logJson("error", "db query", { err: error, status: error.status || 500 });
    res.status(error.status || 500).json({ data: null, error: { message: error.message || "Erreur serveur" } });
  }
});

app.post("/api/rpc/:name", requireAuth, writeLimiter, async (req, res) => {
  try {
    const result = await runRpc(req.user, String(req.params.name || ""), req.body || {});
    res.json(result);
  } catch (error) {
    logJson("error", "rpc", { err: error, status: error.status || 500, name: String(req.params.name || "") });
    res.status(error.status || 500).json({ data: null, error: { message: error.message || "Erreur serveur" } });
  }
});

app.post("/api/storage/:bucket", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!["admin", "creator"].includes(req.user.role)) {
      return res.status(403).json({ data: null, error: { message: "Accès refusé." } });
    }
    const filePath = String(req.body.path || req.file?.originalname || "");
    if (!req.file) return res.status(400).json({ data: null, error: { message: "Fichier manquant." } });
    await saveFile(req.params.bucket, filePath, req.file.buffer);
    res.json({
      data: {
        path: filePath,
        fullPath: `${req.params.bucket}/${filePath}`
      },
      error: null
    });
  } catch (error) {
    res.status(400).json({ data: null, error: { message: error.message } });
  }
});

app.get("/api/storage/:bucket", requireAuth, async (req, res) => {
  try {
    const filePath = await assertCanReadStorage(req.user, req.params.bucket, req.query.path);
    const data = await readFile(req.params.bucket, filePath);
    await logSensitiveAccess({
      actor: req.user,
      action: "storage.read",
      table: req.params.bucket,
      meta: { path: filePath }
    });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "attachment");
    res.send(data);
  } catch (error) {
    res.status(error.status || 404).json({ error: { message: error.message || "Fichier introuvable." } });
  }
});

app.post("/api/storage/:bucket/signed-url", requireAuth, async (req, res) => {
  try {
    const filePath = await assertCanReadStorage(
      req.user,
      req.params.bucket,
      req.body.path || req.query.path
    );
    res.json({
      data: { signedUrl: publicUrl(req, req.params.bucket, filePath) },
      error: null
    });
  } catch (error) {
    res.status(error.status || 404).json({ data: null, error: { message: error.message || "Fichier introuvable." } });
  }
});

app.post("/api/storage/:bucket/remove", requireAuth, async (req, res) => {
  try {
    if (!["admin", "creator"].includes(req.user.role)) {
      return res.status(403).json({ data: null, error: { message: "Accès refusé." } });
    }
    const paths = Array.isArray(req.body.paths) ? req.body.paths : [req.body.path];
    for (const item of paths.filter(Boolean)) {
      await removeFile(req.params.bucket, item);
    }
    res.json({ data: true, error: null });
  } catch (error) {
    res.status(400).json({ data: null, error: { message: error.message } });
  }
});

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ data: null, error: { message: "csrf token invalid" } });
  }
  const status = Number(error.status || error.statusCode || 500);
  if (status >= 500) logJson("error", "unhandled", { err: error, status });
  return res.status(status).json({
    data: null,
    error: { message: error.message || "Erreur serveur" }
  });
});

app.use("/api", (req, res) => {
  res.status(404).json({
    data: null,
    error: { message: `Route API introuvable: ${req.method} ${req.originalUrl}` }
  });
});

const port = Number(process.env.PORT || 3000);
try {
  assertJwtSecret();
} catch (error) {
  logJson("error", "JWT_SECRET", { err: error });
  process.exit(1);
}
runMigrations()
  .then(() => query("select 1"))
  .then(() => {
    app.listen(port, () => {
      logJson("info", "api.listen", { port });
    });
  })
  .catch((error) => {
    logJson("error", "startup", { err: error });
    process.exit(1);
  });
