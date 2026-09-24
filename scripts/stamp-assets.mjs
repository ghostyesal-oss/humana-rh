#!/usr/bin/env node
/**
 * Remplace les ?v= manuels par un hash de contenu (?h=).
 * À lancer sur la copie déployée (Docker /srv), pas forcément le working tree.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const root = path.resolve(rootIdx >= 0 ? args[rootIdx + 1] : ".");

const HASH_LEN = 10;
const HASH_MARKER_START = "/* HUMANA_ASSET_HASHES_START */";
const HASH_MARKER_END = "/* HUMANA_ASSET_HASHES_END */";

function sha(filePath) {
  const buf = fs.readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex").slice(0, HASH_LEN);
}

function relPosix(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function listFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

const skipNames = new Set(["config.js", "asset-hashes.js", "stamp-assets.mjs"]);
const STAMP_EXT = new Set([".js", ".css", ".webmanifest"]);
const hashable = listFiles(root)
  .filter((file) => STAMP_EXT.has(path.extname(file).toLowerCase()))
  .filter((file) => !skipNames.has(path.basename(file)))
  .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`))
  .filter((file) => !file.includes(`${path.sep}server${path.sep}`))
  .filter((file) => !file.includes(`${path.sep}scripts${path.sep}`));

const hashes = {};
for (const file of hashable) {
  if (relPosix(file) === "app.js") continue;
  hashes[relPosix(file)] = sha(file);
}

const appPath = path.join(root, "app.js");
if (fs.existsSync(appPath)) {
  let appSrc = fs.readFileSync(appPath, "utf8");
  const start = appSrc.indexOf(HASH_MARKER_START);
  const end = appSrc.indexOf(HASH_MARKER_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error("Marqueurs HUMANA_ASSET_HASHES introuvables dans app.js");
  }
  const block = `${HASH_MARKER_START}\nconst HUMANA_ASSET_HASHES = ${JSON.stringify(hashes, null, 2)};\n${HASH_MARKER_END}`;
  appSrc = appSrc.slice(0, start) + block + appSrc.slice(end + HASH_MARKER_END.length);
  fs.writeFileSync(appPath, appSrc);
  hashes["app.js"] = sha(appPath);
}

function rewriteAttr(html, attr, name, hashedUrl) {
  const needles = [`${attr}="${name}"`, `${attr}="/${name}"`];
  for (const needle of needles) {
    html = html.split(needle).join(`${attr}="${hashedUrl}"`);
  }
  const prefix = `${attr}="/${name}?h=`;
  let index = 0;
  while ((index = html.indexOf(prefix, index)) !== -1) {
    const valueStart = index + `${attr}="`.length;
    const valueEnd = html.indexOf('"', valueStart);
    if (valueEnd < 0) break;
    html = html.slice(0, valueStart) + hashedUrl + html.slice(valueEnd);
    index = valueStart + hashedUrl.length;
  }
  return html;
}

const htmlFiles = listFiles(root).filter((file) => file.endsWith(".html"));
const names = Object.keys(hashes).sort((a, b) => b.length - a.length);
for (const htmlPath of htmlFiles) {
  let html = fs.readFileSync(htmlPath, "utf8");
  for (const name of names) {
    const hashedUrl = `/${name}?h=${hashes[name]}`;
    html = rewriteAttr(html, "src", name, hashedUrl);
    html = rewriteAttr(html, "href", name, hashedUrl);
  }
  fs.writeFileSync(htmlPath, html);
}

console.log(`Assets stampés (${Object.keys(hashes).length}) dans ${root}`);
