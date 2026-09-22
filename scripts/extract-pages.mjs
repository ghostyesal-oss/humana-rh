#!/usr/bin/env node
/**
 * Extracts each xxxPage() renderer from app.js into pages/<key>.js
 * and registers it on window.Humana.pages[<key>].
 *
 * Also:
 *  - Replaces pageContent()'s hard-coded page map with a registry lookup.
 *  - Removes the outer IIFE so top-level function/let bindings become
 *    accessible from sibling classic scripts via the shared script scope.
 *
 * Assumption verified in app.js: every renderer starts with
 *   `function xxxPage() {`  at column 0
 * and ends with a single `}` at column 0 (the very next such line).
 * This is a solid convention in this codebase; using a bracket-based parser
 * is unnecessary and error-prone because of nested template literals.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const APP_JS = path.join(root, "app.js");
const PAGES_DIR = path.join(root, "pages");

// dataset.page value -> renderer identifier in app.js
const PAGES = [
  ["home",         "homePage"],
  ["pointeuse",    "pointeusePage"],
  ["global",       "globalPage"],
  ["journal",      "journalPage"],
  ["team-punches", "teamPunchesPage"],
  ["reports",      "reportsPage"],
  ["leave",        "leavePage"],
  ["attestations", "attestationsPage"],
  ["planning",     "planningPage"],
  ["events",       "eventsPage"],
  ["hierarchy",    "hierarchyPage"],
  ["admin",        "adminPage"],
  ["creator",      "creatorPage"]
];

function findRendererRange(lines, fnName) {
  const openRe = new RegExp(`^function\\s+${fnName}\\s*\\(`);
  const closeRe = /^\}\s*$/;

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (openRe.test(lines[i])) { start = i; break; }
  }
  if (start === -1) throw new Error(`Renderer not found: ${fnName}`);

  for (let i = start + 1; i < lines.length; i++) {
    if (closeRe.test(lines[i])) return { start, end: i }; // both inclusive
  }
  throw new Error(`No closing brace found for ${fnName}`);
}

function main() {
  fs.mkdirSync(PAGES_DIR, { recursive: true });

  const src = fs.readFileSync(APP_JS, "utf8");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);

  // 1) Locate every renderer range in one pass so ranges can be spliced out
  //    in a single reverse traversal (keeps indices stable).
  const ranges = PAGES.map(([key, fn]) => {
    const { start, end } = findRendererRange(lines, fn);
    return { key, fn, start, end };
  }).sort((a, b) => a.start - b.start);

  // 2) Write each pages/<key>.js with the extracted body.
  for (const r of ranges) {
    const body = lines.slice(r.start, r.end + 1).join(eol);
    const indented = body.split(/\r?\n/).map(l => l ? "  " + l : "").join(eol);

    const out = [
      "/* Auto-generated from app.js by scripts/extract-pages.mjs.",
      " * Renderer for the \"" + r.key + "\" tab.",
      " * Shared state/helpers are read from app.js (loaded first) via the",
      " * classic script scope. Registers itself on window.Humana.pages so",
      " * pageContent() in app.js can dispatch by currentPage.",
      " */",
      "(function () {",
      "  \"use strict\";",
      indented,
      "",
      "  (window.Humana = window.Humana || {});",
      "  (window.Humana.pages = window.Humana.pages || {});",
      "  window.Humana.pages[" + JSON.stringify(r.key) + "] = " + r.fn + ";",
      "})();",
      ""
    ].join(eol);

    fs.writeFileSync(path.join(PAGES_DIR, r.key + ".js"), out, "utf8");
    console.log("wrote pages/" + r.key + ".js  (" + (r.end - r.start + 1) + " lines)");
  }

  // 3) Splice renderer bodies out of app.js (reverse order to preserve indices).
  let outLines = lines.slice();
  for (const r of [...ranges].reverse()) {
    const marker = "/* " + r.fn + "() moved to pages/" + r.key + ".js */";
    outLines.splice(r.start, r.end - r.start + 1, marker);
  }

  // 4) Replace pageContent() dispatch map with a registry lookup.
  //    The current shape is:
  //      return {
  //        home: homePage,
  //        ...
  //      }[currentPage]();
  const joined = outLines.join(eol);
  const dispatchRe = /return \{\s*home:\s*homePage,[\s\S]*?\}\[currentPage\]\(\);/;
  let refactored = joined;
  if (dispatchRe.test(joined)) {
    refactored = joined.replace(
      dispatchRe,
`const registry = (window.Humana && window.Humana.pages) || {};
  const renderer = registry[currentPage];
  if (typeof renderer !== "function") {
    return \`<article class="card error-card"><p class="error-message">Module de page introuvable : \${escapeHtml(currentPage)}. Assurez-vous que pages/\${currentPage}.js est charge.</p></article>\`;
  }
  return renderer();`
    );
  } else {
    console.warn("WARNING: pageContent() dispatch not found; may already be refactored.");
  }

  // 5) Remove the outer IIFE.
  //    Header: line 1 = "(function () {", line 2 = "  if (window.__humanaAppLoaded) return;",
  //            line 3 = "  window.__humanaAppLoaded = true;",  line 4 = "".
  //    Footer: last non-empty line = "})();".
  const headerRe = /^\(function \(\) \{\s*\r?\n\s*if \(window\.__humanaAppLoaded\) return;\s*\r?\n\s*window\.__humanaAppLoaded = true;\s*\r?\n\s*\r?\n/;
  if (headerRe.test(refactored)) {
    refactored = refactored.replace(headerRe, "");
    refactored = refactored.replace(/\}\)\(\);\s*$/, "");
    console.log("removed outer IIFE wrapping");
  } else {
    console.warn("NOTE: IIFE header not matched; skipping (already unwrapped?).");
  }

  fs.writeFileSync(APP_JS, refactored, "utf8");
  console.log("rewrote app.js (" + refactored.split(/\r?\n/).length + " lines)");
}

main();
