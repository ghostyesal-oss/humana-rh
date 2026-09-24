const buckets = new Map();

function clientKey(req) {
  const raw = req.ip || req.socket?.remoteAddress || "unknown";
  return String(raw).replace(/^::ffff:/, "");
}

function prune(now) {
  if (buckets.size < 4000) return;
  for (const [key, item] of buckets) {
    if (item.reset <= now) buckets.delete(key);
  }
}

export function rateLimit({ windowMs, max, name }) {
  const windowSize = Math.max(1000, Number(windowMs) || 60000);
  const limit = Math.max(1, Number(max) || 60);
  const prefix = String(name || "api");
  return (req, res, next) => {
    const now = Date.now();
    prune(now);
    const key = `${prefix}:${clientKey(req)}`;
    let item = buckets.get(key);
    if (!item || item.reset <= now) {
      item = { count: 0, reset: now + windowSize };
      buckets.set(key, item);
    }
    item.count += 1;
    const remaining = Math.max(0, limit - item.count);
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(item.reset / 1000)));
    if (item.count > limit) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((item.reset - now) / 1000))));
      return res.status(429).json({
        data: null,
        error: { message: "Trop de requêtes. Réessayez dans un instant." }
      });
    }
    next();
  };
}
