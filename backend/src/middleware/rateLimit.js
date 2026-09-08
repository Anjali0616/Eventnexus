// Minimal in-memory fixed-window limiter — sufficient for a single-process
// deployment; swap for a Redis-backed limiter before running multiple instances.
const buckets = new Map();

const rateLimit = ({ windowMs = 60_000, max = 20 } = {}) => {
  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    // Evict stale buckets opportunistically to avoid unbounded memory growth.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) {
        if (now - v.start > windowMs) buckets.delete(k);
        if (buckets.size <= 4000) break;
      }
    }
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.start > windowMs) {
      buckets.set(key, { start: now, count: 1 });
      return next();
    }

    if (bucket.count >= max) {
      return res.status(429).json({ message: "Too many requests, please try again later" });
    }

    bucket.count += 1;
    next();
  };
};

module.exports = rateLimit;
