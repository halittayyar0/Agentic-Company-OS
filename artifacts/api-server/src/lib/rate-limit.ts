import type { RequestHandler } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  namespace: string;
  maxEntries?: number;
  now?: () => number;
}

/**
 * A bounded, dependency-free per-process limiter. Remote multi-replica
 * deployments should additionally enforce a distributed limit at the edge.
 */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const entries = new Map<string, RateLimitEntry>();
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;

  return (req, res, next) => {
    const timestamp = now();
    if (entries.size >= maxEntries) {
      for (const [key, entry] of entries) {
        if (entry.resetAt <= timestamp) entries.delete(key);
      }
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    }

    const address = req.socket.remoteAddress ?? "unknown";
    const key = `${options.namespace}:${address}`;
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= timestamp) {
      entry = { count: 0, resetAt: timestamp + options.windowMs };
      entries.set(key, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, options.max - entry.count);
    const resetSeconds = Math.max(
      1,
      Math.ceil((entry.resetAt - timestamp) / 1000),
    );
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));
    if (entry.count > options.max) {
      res.setHeader("Retry-After", String(resetSeconds));
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  };
}
