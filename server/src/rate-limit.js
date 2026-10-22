const memory = new Map();

function clientKey(req) {
  const raw = req.ip || req.socket?.remoteAddress || "unknown";
  return String(raw).replace(/^::ffff:/, "");
}

function pruneMemory(now) {
  if (memory.size < 4000) return;
  for (const [key, item] of memory) {
    if (item.reset <= now) memory.delete(key);
  }
}

function hitMemory(key, now, windowSize) {
  pruneMemory(now);
  let item = memory.get(key);
  if (!item || item.reset <= now) {
    item = { count: 0, reset: now + windowSize };
    memory.set(key, item);
  }
  item.count += 1;
  return item;
}

export function rateLimit({ windowMs, max, name }) {
  const windowSize = Math.max(1000, Number(windowMs) || 60000);
  const limit = Math.max(1, Number(max) || 60);
  const prefix = String(name || "api");
  return (req, res, next) => {
    const now = Date.now();
    const key = `${prefix}:${clientKey(req)}`;
    const item = hitMemory(key, now, windowSize);
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
