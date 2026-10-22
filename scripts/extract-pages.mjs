#!/usr/bin/env node
/**
 * Extraire un renderer encore présent dans app.js vers pages/<key>.js.
 * Les pages existantes sont la source de vérité : elles passent par
 * window.Humana, pas par le scope global.
 *
 * Ne retire plus l'IIFE de app.js. Après extraction, lancer :
 *   node scripts/encapsulate-front.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_JS = path.join(root, "app.js");
const PAGES_DIR = path.join(root, "pages");

const PAGES = [
  ["home", "homePage"],
  ["pointeuse", "pointeusePage"],
  ["global", "globalPage"],
  ["journal", "journalPage"],
  ["team-punches", "teamPunchesPage"],
  ["reports", "reportsPage"],
  ["leave", "leavePage"],
  ["attestations", "attestationsPage"],
  ["planning", "planningPage"],
  ["events", "eventsPage"],
  ["hierarchy", "hierarchyPage"],
  ["admin", "adminPage"],
  ["creator", "creatorPage"],
  ["privacy", "privacyPage"]
];

function findRendererRange(lines, fnName) {
  const openRe = new RegExp(`^function\\s+${fnName}\\s*\\(`);
  const closeRe = /^\}\s*$/;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (openRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  for (let i = start + 1; i < lines.length; i++) {
    if (closeRe.test(lines[i])) return { start, end: i };
  }
  throw new Error(`Pas d'accolade fermante pour ${fnName}`);
}

function main() {
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  const src = fs.readFileSync(APP_JS, "utf8");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  const found = [];

  for (const [key, fn] of PAGES) {
    const range = findRendererRange(lines, fn);
    if (!range) {
      console.log("skip " + key + " (déjà dans pages/" + key + ".js)");
      continue;
    }
    found.push({ key, fn, ...range });
  }

  if (!found.length) {
    console.log("Aucun renderer à extraire. pages/ est la source de vérité.");
    return;
  }

  for (const r of found) {
    const body = lines.slice(r.start, r.end + 1).join(eol);
    const indented = body.split(/\r?\n/).map((line) => (line ? "  " + line : "")).join(eol);
    const out = [
      "/* Page \"" + r.key + "\" : frontière window.Humana (app.js). */",
      "(function (H) {",
      "  \"use strict\";",
      indented,
      "",
      "  (H.pages = H.pages || {})[" + JSON.stringify(r.key) + "] = " + r.fn + ";",
      "})(window.Humana);",
      ""
    ].join(eol);
    fs.writeFileSync(path.join(PAGES_DIR, r.key + ".js"), out, "utf8");
    console.log("wrote pages/" + r.key + ".js — lancer node scripts/encapsulate-front.mjs");
  }

  let outLines = lines.slice();
  for (const r of [...found].sort((a, b) => b.start - a.start)) {
    outLines.splice(r.start, r.end - r.start + 1, "/* " + r.fn + "() moved to pages/" + r.key + ".js */");
  }
  fs.writeFileSync(APP_JS, outLines.join(eol), "utf8");
}

main();
