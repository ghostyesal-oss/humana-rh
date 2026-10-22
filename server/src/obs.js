/** Logs JSON stdout/stderr + métriques process (sans dépendance). */

const startedAt = Date.now();
const MAX_SAMPLES = 200;
const latencies = [];
const stats = { requests: 0, errors5xx: 0 };

const REDACT = /^(cookie|authorization|csrf|token|password|secret|set-cookie)$/i;

export function logJson(level, msg, extra = {}) {
  const line = {
    ts: new Date().toISOString(),
    level: String(level || "info"),
    msg: String(msg || "")
  };
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (REDACT.test(key)) return;
    if (value instanceof Error) {
      line[key] = value.message;
      return;
    }
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      line[key] = value;
    } else {
      line[key] = String(value);
    }
  });
  const sink = line.level === "error" ? process.stderr : process.stdout;
  sink.write(`${JSON.stringify(line)}\n`);
}

export function percentile(samples, q) {
  const list = Array.isArray(samples) ? samples.filter((n) => Number.isFinite(n)).sort((a, b) => a - b) : [];
  if (!list.length) return 0;
  const idx = Math.min(list.length - 1, Math.max(0, Math.ceil((Number(q) / 100) * list.length) - 1));
  return list[idx];
}

function pushLatency(ms) {
  latencies.push(ms);
  if (latencies.length > MAX_SAMPLES) latencies.shift();
}

export function noteRequest(status, ms) {
  stats.requests += 1;
  if (Number(status) >= 500) stats.errors5xx += 1;
  if (Number.isFinite(ms)) pushLatency(Math.max(0, Math.round(ms)));
}

export function metricsSnapshot() {
  return {
    uptimeSec: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
    requests: stats.requests,
    errors5xx: stats.errors5xx,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95)
    }
  };
}

export function requestPath(req) {
  return String(req?.originalUrl || req?.url || "").split("?")[0];
}

export function shouldSkipAccessLog(req, status) {
  return req?.method === "GET" && requestPath(req) === "/api/health" && Number(status) < 400;
}

export function requestLogger(req, res, next) {
  const t0 = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - t0;
    const status = res.statusCode;
    noteRequest(status, ms);
    if (shouldSkipAccessLog(req, status)) return;
    logJson(status >= 500 ? "error" : "info", "http", {
      method: req.method,
      path: requestPath(req),
      status,
      ms
    });
  });
  next();
}

export async function buildHealth(checkDb) {
  let db = "ok";
  try {
    await Promise.race([
      Promise.resolve().then(() => checkDb()),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), 2000);
      })
    ]);
  } catch {
    db = "error";
  }
  return {
    ok: db === "ok",
    db,
    ...metricsSnapshot()
  };
}

export function installProcessHandlers() {
  process.on("unhandledRejection", (reason) => {
    logJson("error", "unhandledRejection", {
      err: reason instanceof Error ? reason.message : String(reason || "unknown")
    });
  });
  process.on("uncaughtException", (error) => {
    logJson("error", "uncaughtException", { err: error?.message || String(error) });
    process.exit(1);
  });
}
