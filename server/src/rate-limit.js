import { adminQuery } from "./db.js";

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

async function hitStore(key, now, windowSize) {
  const resetAt = new Date(now + windowSize).toISOString();
  const { rows } = await adminQuery(
    `insert into auth.rate_limit_buckets (key, count, reset_at)
     values ($1, 1, $2::timestamptz)
     on conflict (key) do update set
       count = case
         when auth.rate_limit_buckets.reset_at <= now() then 1
         else auth.rate_limit_buckets.count + 1
       end,
       reset_at = case
         when auth.rate_limit_buckets.reset_at <= now() then excluded.reset_at
         else auth.rate_limit_buckets.reset_at
       end
     returning count, reset_at`,
    [key, resetAt]
  );
  const row = rows[0];
  return {
    count: Number(row?.count) || 1,
    reset: new Date(row?.reset_at || resetAt).getTime()
  };
}

let pruneTick = 0;

async function maybePruneStore() {
  pruneTick += 1;
  if (pruneTick % 250 !== 0) return;
  await adminQuery("delete from auth.rate_limit_buckets where reset_at < now() - interval '2 hours'").catch(() => {});
}

export function rateLimit({ windowMs, max, name }) {
  const windowSize = Math.max(1000, Number(windowMs) || 60000);
  const limit = Math.max(1, Number(max) || 60);
  const prefix = String(name || "api");
  return (req, res, next) => {
    const now = Date.now();
    const key = `${prefix}:${clientKey(req)}`;
    const apply = (item) => {
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
    hitStore(key, now, windowSize)
      .then((item) => {
        maybePruneStore();
        apply(item);
      })
      .catch(() => apply(hitMemory(key, now, windowSize)));
  };
}
