export function jwtTtl() {
  const raw = String(process.env.JWT_EXPIRES_IN || "22h").trim();
  return /^\d+[smhd]$/.test(raw) ? raw : "22h";
}

export function jwtMaxAgeMs() {
  const ttl = jwtTtl();
  const amount = Number(ttl.slice(0, -1));
  const unit = ttl.slice(-1);
  const factors = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * (factors[unit] || 3_600_000);
}

export function sessionAuthTimeSec(payload) {
  const n = Number(payload?.auth_time || payload?.iat || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function sessionDeadlineMs(payload) {
  const start = sessionAuthTimeSec(payload);
  if (!start) return 0;
  return start * 1000 + jwtMaxAgeMs();
}

export function sessionRemainingMs(payload, now = Date.now()) {
  const deadline = sessionDeadlineMs(payload);
  if (!deadline) return 0;
  return deadline - now;
}
