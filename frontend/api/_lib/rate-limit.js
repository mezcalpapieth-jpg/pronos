/**
 * In-memory fixed-window rate limiter for serverless functions.
 *
 * Usage:
 *   import { rateLimit } from './_lib/rate-limit.js';
 *
 *   const limited = rateLimit(req, res, {
 *     key: `translate:${clientIp(req)}:${privyId}`,
 *     limit: 10,
 *     windowMs: 60_000,
 *   });
 *   if (limited) return; // 429 already sent
 *
 * Scope: Vercel spins serverless functions up and down, so this counter is
 * scoped to a single warm instance. For stricter enforcement (across all
 * instances) you'd need a Redis / KV-backed store — but for our immediate
 * goal of blocking simple brute-force / scraper loops, the per-instance
 * ceiling is enough and adds zero external dependencies.
 */

const buckets = new Map();

export function rateLimit(req, res, { key, limit, windowMs }) {
  if (!key || !limit || !windowMs) return false;

  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // Opportunistic GC: if the map grows too large, drop the oldest buckets.
    // A single serverless instance won't legitimately hold more than a few
    // hundred unique keys at once.
    if (buckets.size > 5_000) sweep(now);
    return false;
  }

  if (bucket.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    res.status(429).json({ error: 'Too many requests', retryAfter: retryAfterSec });
    return true;
  }

  bucket.count += 1;
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(limit - bucket.count));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  return false;
}

function sweep(now) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Extract a best-effort client IP from the request. Vercel sets
 * `x-forwarded-for` to a comma-separated list with the client as the first
 * entry. We fall back to `x-real-ip` then to the remote address.
 */
export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}
