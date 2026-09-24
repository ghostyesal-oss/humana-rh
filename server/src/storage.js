import fs from "node:fs/promises";
import path from "node:path";
import { withUser } from "./db.js";

const ROOT = process.env.STORAGE_ROOT || "/data/storage";
const BUCKETS = new Set(["hr-documents", "event-posters"]);

function notFound() {
  const error = new Error("Fichier introuvable.");
  error.status = 404;
  return error;
}

export function safePath(bucket, filePath) {
  if (!BUCKETS.has(bucket)) throw notFound();
  const cleaned = String(filePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = cleaned.split("/");
  if (!cleaned || cleaned.includes("\0") || parts.some((part) => !part || part === "." || part === "..")) {
    throw notFound();
  }
  const root = path.resolve(ROOT, bucket);
  const full = path.resolve(root, cleaned);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.startsWith(prefix)) throw notFound();
  return { full, cleaned };
}

export async function saveFile(bucket, filePath, buffer) {
  const { full, cleaned } = safePath(bucket, filePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
  return cleaned;
}

export async function removeFile(bucket, filePath) {
  const { full } = safePath(bucket, filePath);
  await fs.unlink(full).catch(() => {});
}

export async function readFile(bucket, filePath) {
  const { full } = safePath(bucket, filePath);
  return fs.readFile(full);
}

export function publicUrl(req, bucket, filePath) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/storage/${bucket}?path=${encodeURIComponent(filePath)}`;
}

function isPrivileged(user) {
  return user?.role === "admin" || user?.role === "creator";
}

export async function assertCanReadStorage(user, bucket, filePath) {
  const { cleaned } = safePath(bucket, filePath);
  if (bucket === "hr-documents" && user?.sub && cleaned.startsWith(`payslips/${user.sub}/`)) {
    return cleaned;
  }
  const allowed = await withUser(user, async (client) => {
    if (bucket === "event-posters") {
      const { rows } = await client.query(
        "select 1 from public.company_events where poster_path = $1 limit 1",
        [cleaned]
      );
      return rows.length > 0;
    }
    const pay = await client.query(
      "select 1 from public.payslips where storage_path = $1 limit 1",
      [cleaned]
    );
    if (pay.rows.length) return true;
    const docs = await client.query(
      "select 1 from public.hr_documents where storage_path = $1 limit 1",
      [cleaned]
    );
    return docs.rows.length > 0;
  });
  if (allowed || isPrivileged(user)) return cleaned;
  throw notFound();
}
