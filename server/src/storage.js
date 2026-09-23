import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.env.STORAGE_ROOT || "/data/storage";
const BUCKETS = new Set(["hr-documents", "event-posters"]);

function safePath(bucket, filePath) {
  if (!BUCKETS.has(bucket)) throw new Error("Bucket inconnu.");
  const cleaned = String(filePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..")) throw new Error("Chemin de fichier invalide.");
  return path.join(ROOT, bucket, cleaned);
}

export async function saveFile(bucket, filePath, buffer) {
  const full = safePath(bucket, filePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
  return filePath;
}

export async function removeFile(bucket, filePath) {
  const full = safePath(bucket, filePath);
  await fs.unlink(full).catch(() => {});
}

export async function readFile(bucket, filePath) {
  const full = safePath(bucket, filePath);
  return fs.readFile(full);
}

export function publicUrl(req, bucket, filePath) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/storage/${bucket}?path=${encodeURIComponent(filePath)}`;
}
