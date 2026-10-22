#!/usr/bin/env node
/**
 * Ferme app.js dans une IIFE et fait dépendre pages/*.js de window.Humana
 * au lieu du scope global. Idempotent.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_JS = path.join(root, "app.js");
const PAGES_DIR = path.join(root, "pages");
const API_START = "/* HUMANA_PAGE_API_START */";
const API_END = "/* HUMANA_PAGE_API_END */";
const IIFE_OPEN = `(function () {
  if (window.__humanaAppLoaded) return;
  window.__humanaAppLoaded = true;
  window.Humana = window.Humana || {};
  window.Humana.pages = window.Humana.pages || {};

`;
const IIFE_CLOSE = "\n})();\n";
const LIVE = new Set([
  "session",
  "demoMode",
  "appData",
  "planningState",
  "journalFilters",
  "teamPunchFilters",
  "hierarchySearch",
  "journalFullscreen",
  "journalSort",
  "journalColumnFilters",
  "journalOpenColumn"
]);

const KEYWORDS = new Set("break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null return super switch this true try typeof var void while with yield async await of static get set constructor".split(" "));
const BUILTINS = new Set("window document Date Math JSON Object Array String Number Boolean Promise Map Set console Error parseInt parseFloat isNaN isFinite undefined NaN Infinity encodeURI encodeURIComponent decodeURI decodeURIComponent Intl URL URLSearchParams FormData Blob File FileReader localStorage sessionStorage history location navigator crypto fetch setTimeout setInterval clearTimeout clearInterval requestAnimationFrame btoa atob CSS DOMParser Event MutationObserver WeakMap WeakSet Symbol BigInt Reflect Proxy ArrayBuffer Uint8Array TextEncoder TextDecoder performance".split(" "));

function stripTemplates(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "`") {
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "`") {
          i += 1;
          break;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          i += 2;
          let depth = 1;
          let expr = "";
          while (i < src.length && depth) {
            if (src[i] === "{") depth += 1;
            else if (src[i] === "}") {
              depth -= 1;
              if (depth) expr += src[i];
            } else expr += src[i];
            i += 1;
          }
          out += ` (${stripTemplates(expr)}) `;
        } else i += 1;
      }
    } else {
      out += src[i];
      i += 1;
    }
  }
  return out;
}

function addParams(list, locals) {
  for (const raw of list.split(",")) {
    const name = raw.trim().replace(/^\.\.\./, "").split("=")[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) locals.add(name);
  }
}

function topLevelNames(src) {
  const names = new Set();
  for (const line of src.split(/\r?\n/)) {
    const match = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^const\s+([A-Za-z_$][\w$]*)|^let\s+([A-Za-z_$][\w$]*)|^var\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (match) names.add(match[1] || match[2] || match[3] || match[4]);
  }
  return names;
}

function extract(src, catalog) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
  src = stripTemplates(src);
  src = src.replace(/'(?:\\.|[^'\\])*'/g, "\"\"");
  src = src.replace(/"(?:\\.|[^"\\])*"/g, "\"\"");
  const locals = new Set();
  for (const match of src.matchAll(/\b(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) locals.add(match[1]);
  for (const match of src.matchAll(/function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) addParams(match[1], locals);
  for (const match of src.matchAll(/\(([^)]*)\)\s*=>/g)) addParams(match[1], locals);
  const used = new Set();
  const re = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)/g;
  let match;
  while ((match = re.exec(src))) {
    const id = match[1];
    if (KEYWORDS.has(id) || BUILTINS.has(id) || locals.has(id)) continue;
    if (id === "H" || id === "Humana") continue;
    if (catalog && !catalog.has(id)) continue;
    used.add(id);
  }
  return [...used].sort();
}

function unwrapAppSrc(appSrc) {
  return appSrc
    .replace(/^\(function \(\) \{\r?\n  if \(window\.__humanaAppLoaded\) return;\r?\n  window\.__humanaAppLoaded = true;\r?\n\r?\n/, "")
    .replace(/\r?\n\}\)\(\);\s*$/, "\n");
}

function collectPageApi(appSrc) {
  const catalog = topLevelNames(unwrapAppSrc(appSrc));
  const skip = new Set(["H", "Humana", "pages", "window", "document"]);
  const all = new Set();
  for (const file of fs.readdirSync(PAGES_DIR).filter((name) => name.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(PAGES_DIR, file), "utf8");
    const locals = new Set();
    forEachCodeIdent(src, (id, start, end, before) => {
      if (before === ".") return;
      const prev = src.slice(Math.max(0, start - 10), start);
      if (/\b(?:function|const|let|var)\s*$/.test(prev)) locals.add(id);
    });
    forEachCodeIdent(src, (id, start, end, before) => {
      if (before === ".") {
        let dot = start - 1;
        while (dot >= 0 && /\s/.test(src[dot])) dot -= 1;
        let objEnd = dot;
        let objStart = dot - 1;
        while (objStart >= 0 && /[\w$]/.test(src[objStart])) objStart -= 1;
        const obj = src.slice(objStart + 1, objEnd);
        if (obj === "H" && catalog.has(id) && !skip.has(id)) all.add(id);
        return;
      }
      if (skip.has(id) || locals.has(id) || KEYWORDS.has(id) || BUILTINS.has(id)) return;
      if (catalog.has(id)) all.add(id);
    });
  }
  return [...all].sort();
}

function forEachCodeIdent(src, callback) {
  const n = src.length;
  let i = 0;
  const tmpl = [];

  function ident(start) {
    let j = start + 1;
    while (j < n && /[\w$]/.test(src[j])) j += 1;
    let k = start - 1;
    while (k >= 0 && /\s/.test(src[k])) k -= 1;
    callback(src.slice(start, j), start, j, k >= 0 ? src[k] : "");
    i = j;
  }

  function skipLineComment() {
    while (i < n && src[i] !== "\n") i += 1;
  }

  function skipBlockComment() {
    i += 2;
    while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
    i += 2;
  }

  function skipQuote(quote) {
    i += 1;
    while (i < n) {
      if (src[i] === "\\") {
        i += 2;
        continue;
      }
      if (src[i] === quote) {
        i += 1;
        break;
      }
      i += 1;
    }
  }

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    const top = tmpl[tmpl.length - 1];

    if (!top || top.interp) {
      if (ch === "/" && next === "/") {
        skipLineComment();
        continue;
      }
      if (ch === "/" && next === "*") {
        skipBlockComment();
        continue;
      }
      if (ch === "'" || ch === "\"") {
        skipQuote(ch);
        continue;
      }
      if (ch === "`") {
        tmpl.push({ interp: false, brace: 0 });
        i += 1;
        continue;
      }
      if (top && top.interp) {
        if (ch === "{") top.brace += 1;
        else if (ch === "}") {
          top.brace -= 1;
          if (top.brace <= 0) {
            top.interp = false;
            i += 1;
            continue;
          }
        }
      }
      if (/[A-Za-z_$]/.test(ch)) {
        ident(i);
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      tmpl.pop();
      i += 1;
      continue;
    }
    if (ch === "$" && next === "{") {
      top.interp = true;
      top.brace = 1;
      i += 2;
      continue;
    }
    i += 1;
  }
}

function prefixApiIdents(src, names) {
  const set = new Set(names);
  const chunks = [];
  let last = 0;
  forEachCodeIdent(src, (id, start, end, before) => {
    if (set.has(id) && before !== ".") {
      chunks.push(src.slice(last, start), `H.${id}`);
      last = end;
    }
  });
  chunks.push(src.slice(last));
  return chunks.join("");
}

function pageHeader(key) {
  return [
    `/* Page "${key}" : frontière window.Humana (app.js).`,
    " * Plus de dépendance au scope global. Source maintenue dans pages/.",
    " */"
  ].join("\n");
}

function rewritePage(file, names) {
  let src = fs.readFileSync(path.join(PAGES_DIR, file), "utf8");
  const key = file.replace(/\.js$/, "");
  if (file === "journal.js") {
    src = src
      .replace(/\(session\) => session\.status === "Connecté"/g, "(entry) => entry.status === \"Connecté\"")
      .replace(/\(session\) => session\.method === "—" && session\.os === "—" && session\.browser === "—" && session\.ip === "—"/g, "(entry) => entry.method === \"—\" && entry.os === \"—\" && entry.browser === \"—\" && entry.ip === \"—\"")
      .replace(/sessions\.map\(\(session\) => `/g, "sessions.map((entry) => `")
      .replace(/\$\{escapeHtml\(session\./g, "${escapeHtml(entry.")
      .replace(/renderJournalStatus\(session\.status\)/g, "renderJournalStatus(entry.status)");
  }
  if (file === "journal.js" || file === "global.js") {
    src = src.replace(
      /(\w+Filters) = \{ \.\.\.\1, \.\.\.getDefaultTeamPunchRange\(\) \}/g,
      "Object.assign($1, getDefaultTeamPunchRange())"
    );
  }

  src = src.replace(/^\/\*[\s\S]*?\*\/\s*/, "");
  src = src.replace(/^\(function\s*\(\s*H?\s*\)\s*\{/, "(function (H) {");
  src = src.replace(
    /\(window\.Humana = window\.Humana \|\| \{\}\);\s*\(window\.Humana\.pages = window\.Humana\.pages \|\| \{\}\);\s*window\.Humana\.pages(?:\[["']([^"']+)["']\]|\.(\w+))\s*=\s*(\w+);/,
    (_, a, b, fn) => `(H.pages = H.pages || {})[${JSON.stringify(a || b)}] = ${fn};`
  );
  src = src.replace(/\}\)\(\);\s*$/, "})(window.Humana);\n");
  src = `${pageHeader(key)}\n${src}`;
  const prefixed = prefixApiIdents(src, names);
  fs.writeFileSync(path.join(PAGES_DIR, file), prefixed);
}

function publishBlock(names) {
  const live = names.filter((name) => LIVE.has(name));
  const refs = names.filter((name) => !LIVE.has(name));
  const liveFields = live.map((name) => `    ${name}: {
      enumerable: true,
      configurable: true,
      get() { return ${name}; },
      set(v) { ${name} = v; }
    }`);
  return `${API_START}
(function publishHumanaPageApi() {
  const api = window.Humana || (window.Humana = {});
  api.pages = api.pages || {};
  Object.assign(api, {
${refs.map((name) => `    ${name}`).join(",\n")}
  });
  Object.defineProperties(api, {
${liveFields.join(",\n")}
  });
})();
${API_END}
`;
}

function wrapAppJs(src, names) {
  let body = src;
  if (!body.startsWith("(function () {")) {
    body = IIFE_OPEN + body.replace(/\s*$/, "") + IIFE_CLOSE;
  }
  const start = body.indexOf(API_START);
  const end = body.indexOf(API_END);
  if (start >= 0 && end > start) {
    body = body.slice(0, start) + body.slice(end + API_END.length);
  }
  const marker = "// Retarde initialize()";
  const at = body.lastIndexOf(marker);
  if (at < 0) throw new Error("Marqueur initialize() introuvable dans app.js");
  body = `${body.slice(0, at)}${publishBlock(names)}\n${body.slice(at)}`;
  return body;
}

function main() {
  const appSrc = fs.readFileSync(APP_JS, "utf8");
  const names = collectPageApi(appSrc);
  if (!names.length) throw new Error("API pages vide.");
  fs.writeFileSync(APP_JS, wrapAppJs(appSrc, names), "utf8");
  for (const file of fs.readdirSync(PAGES_DIR).filter((name) => name.endsWith(".js"))) {
    rewritePage(file, names);
    console.log("bound", file);
  }
  console.log("API Humana:", names.length, "symboles");
}

main();
