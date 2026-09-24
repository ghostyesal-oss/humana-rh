import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = path.join(root, "style.css");
const css = fs.readFileSync(cssPath, "utf8");
const sizes = fs.statSync(cssPath).size;
const lines = css.split(/\r?\n/);
console.log("style.css bytes", sizes, "lines", lines.length);
for (const i of [63, 64, 65, 66, 67, 68, 141]) {
  const line = lines[i] || "";
  const m = line.match(/--([a-z0-9-]+):\s*url\((['"])data:image\/([^;]+);base64,/);
  console.log(i + 1, "len", line.length, m ? `${m[1]} ${m[3]}` : line.slice(0, 80));
}

const hashes = {};
for (const [idx, name] of [
  [63, "login"],
  [64, "main"],
  [65, "card"],
  [66, "alt-1"],
  [67, "alt-2"],
  [68, "alt-3"]
]) {
  const line = lines[idx];
  const m = line.match(/base64,([A-Za-z0-9+/=]+)/);
  const b64 = m[1].replace(/['"];?\s*$/, "");
  const buf = Buffer.from(b64, "base64");
  const head = buf.subarray(0, 24).toString("hex");
  hashes[name] = { bytes: buf.length, head, first80: b64.slice(0, 80) };
}
console.log(JSON.stringify(hashes, null, 2));
console.log("login===alt-3", hashes.login.first80 === hashes["alt-3"].first80, hashes.login.bytes === hashes["alt-3"].bytes);
