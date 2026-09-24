import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = path.join(root, "style.css");
const outDir = path.join(root, "assets");

const FILES = {
  "--bg-image-login": "bg-login.webp",
  "--bg-image-main": "bg-main.webp",
  "--bg-image-card": "bg-card.webp",
  "--bg-image-alt-1": "bg-alt-1.webp",
  "--bg-image-alt-2": "bg-alt-2.webp",
  "--bg-image-alt-3": "bg-login.webp",
  "--logo-image": "logo.webp"
};

function extractDataUrl(css, varName) {
  const token = `${varName}:`;
  const start = css.indexOf(token);
  if (start < 0) throw new Error(`variable introuvable: ${varName}`);
  const urlStart = css.indexOf("url(", start);
  const quote = css[urlStart + 4];
  if (quote !== "'" && quote !== '"') throw new Error(`url mal formée: ${varName}`);
  const urlEnd = css.indexOf(quote, urlStart + 5);
  const url = css.slice(urlStart + 5, urlEnd);
  const match = url.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) throw new Error(`data-url inattendue: ${varName}`);
  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64"),
    full: css.slice(start, css[urlEnd + 1] === ")" ? urlEnd + 2 : urlEnd + 1)
  };
}

fs.mkdirSync(outDir, { recursive: true });
let css = fs.readFileSync(cssPath, "utf8");
const written = new Map();

for (const [varName, fileName] of Object.entries(FILES)) {
  const extracted = extractDataUrl(css, varName);
  const dest = path.join(outDir, fileName);
  if (!written.has(fileName)) {
    const quality = fileName === "logo.webp" ? 82 : 76;
    await sharp(extracted.buffer).webp({ quality, effort: 4 }).toFile(dest);
    written.set(fileName, fs.statSync(dest).size);
    console.log(fileName, extracted.buffer.length, "->", written.get(fileName));
  }
  css = css.replace(
    extracted.full,
    `${varName}: url("/assets/${fileName}")`
  );
}

fs.writeFileSync(cssPath, css);
const cssSize = fs.statSync(cssPath).size;
console.log("style.css", cssSize);
if (cssSize >= 200 * 1024) {
  throw new Error(`style.css trop gros: ${cssSize} octets`);
}
