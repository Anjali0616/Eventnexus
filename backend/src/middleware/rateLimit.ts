// Minimal in-memory fixed-window limiter — sufficient for a single-process
// deployment; swap for a Redis-backed limiter before running multiple instances.
import { Request, Response, NextFunction, RequestHandler } from "express";

interface Bucket {
  start: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
}

const rateLimit = ({ windowMs = 60_000, max = 20 }: RateLimitOptions = {}): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${(req as any).baseUrl}${(req as any).path}`;
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

export default rateLimit;

// CommonJS interop for require() compatibility
// @ts-ignore
module.exports = rateLimit;
// @ts-ignore
module.exports.default = rateLimit;
