import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { createRequire } from "node:module";
import multer from "multer";
import {
  clearSessionCookie,
  finishMicrosoftLogin,
  loadProfile,
  readToken,
  requireAuth,
  sessionPayload,
  startMicrosoftLogin
} from "./auth.js";
import { runQuery } from "./query.js";
import { runRpc } from "./rpc.js";
import { publicUrl, readFile, removeFile, saveFile, assertCanReadStorage } from "./storage.js";
import { runMigrations } from "./migrate.js";
import { logSensitiveAccess, query } from "./db.js";

const csrf = createRequire(import.meta.url)("csurf");
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
  return items;
}

const origins = allowedOrigins();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
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

app.use("/api", sameOrigin);

const csrfProtection = csrf({
  cookie: {
    key: "_csrf",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false",
    path: "/"
  }
});

app.get("/api/auth/csrf", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

function clientIp(req) {
  const raw = req.ip || req.socket?.remoteAddress || "";
  return String(raw).replace(/^::ffff:/, "").replace(/[^0-9a-fA-F:.]/g, "");
}

app.get("/api/client-ip", requireAuth, (req, res) => {
  res.json({ ip: clientIp(req) });
});

app.get("/api/auth/microsoft", startMicrosoftLogin);
app.get("/api/auth/microsoft/callback", finishMicrosoftLogin);

app.get("/api/auth/session", async (req, res) => {
  const user = readToken(req);
  if (!user) return res.json({ data: { session: null }, error: null });
  const profile = await loadProfile(user.sub);
  res.json({ data: { session: sessionPayload(user, profile) }, error: null });
});

app.post("/api/auth/logout", csrfProtection, (req, res) => {
  clearSessionCookie(res);
  res.json({ error: null });
});

app.post("/api/auth/refresh", csrfProtection, async (req, res) => {
  const user = readToken(req);
  if (!user) return res.status(401).json({ data: { session: null }, error: { message: "Session expirée." } });
  const profile = await loadProfile(user.sub);
  res.json({ data: { session: sessionPayload(user, profile) }, error: null });
});

app.post("/api/db", csrfProtection, requireAuth, async (req, res) => {
  try {
    const result = await runQuery(req.user, req.body || {});
    const status = result.error ? (result.error.code === "PGRST116" ? 406 : 400) : 200;
    res.status(status).json(result);
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ data: null, error: { message: error.message || "Erreur serveur" } });
  }
});

app.post("/api/rpc/:name", csrfProtection, requireAuth, async (req, res) => {
  try {
    const result = await runRpc(req.user, String(req.params.name || ""), req.body || {});
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ data: null, error: { message: error.message || "Erreur serveur" } });
  }
});

app.post("/api/storage/:bucket", csrfProtection, requireAuth, upload.single("file"), async (req, res) => {
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

app.post("/api/storage/:bucket/signed-url", csrfProtection, requireAuth, async (req, res) => {
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

app.post("/api/storage/:bucket/remove", csrfProtection, requireAuth, async (req, res) => {
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
runMigrations()
  .then(() => query("select 1"))
  .then(() => {
    app.listen(port, () => {
      console.log(`Humana API écoute sur ${port}`);
    });
  })
  .catch((error) => {
    console.error("Migrations:", error);
    process.exit(1);
  });
