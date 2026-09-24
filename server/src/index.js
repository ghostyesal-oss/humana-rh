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
import { publicUrl, readFile, removeFile, saveFile } from "./storage.js";
import { runMigrations } from "./migrate.js";

const csrf = createRequire(import.meta.url)("csurf");
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const allowedOrigin = (process.env.APP_ORIGIN || "").replace(/\/$/, "")
  || (process.env.HUMANA_DOMAIN
    ? `${process.env.COOKIE_SECURE === "false" ? "http" : "https"}://${process.env.HUMANA_DOMAIN.replace(/^https?:\/\//, "")}`
    : "");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(cors({
  origin: allowedOrigin || true,
  credentials: true
}));

function sameOrigin(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (!allowedOrigin) return next();
  const origin = String(req.headers.origin || "");
  if (origin && origin !== allowedOrigin) {
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
    const filePath = String(req.query.path || "");
    const data = await readFile(req.params.bucket, filePath);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(data);
  } catch (error) {
    res.status(404).json({ error: { message: error.message } });
  }
});

app.post("/api/storage/:bucket/signed-url", csrfProtection, requireAuth, (req, res) => {
  const filePath = String(req.body.path || req.query.path || "");
  res.json({
    data: { signedUrl: publicUrl(req, req.params.bucket, filePath) },
    error: null
  });
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
  .then(() => {
    app.listen(port, () => {
      console.log(`Humana API écoute sur ${port}`);
    });
  })
  .catch((error) => {
    console.error("Migrations:", error);
    process.exit(1);
  });
