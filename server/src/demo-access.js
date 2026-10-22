import { timingSafeEqual } from "node:crypto";

export function demoAccessCode() {
  return String(process.env.DEMO_ACCESS_CODE || "").trim();
}

export function demoAccessConfigured() {
  return Boolean(demoAccessCode());
}

export function demoAccessCodeMatches(provided) {
  const expected = demoAccessCode();
  const got = String(provided || "").trim();
  if (!expected || !got) return false;
  const left = Buffer.from(got, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
