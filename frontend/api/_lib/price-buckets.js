function firstFinite(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function priceBucketIndexFor(price, buckets) {
  const value = Number(price);
  if (!Number.isFinite(value) || !Array.isArray(buckets)) return -1;

  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i] || {};
    const min = firstFinite(
      bucket.min,
      bucket.minPrice,
      bucket.lower,
      bucket.from,
      bucket.gte,
    );
    const max = firstFinite(
      bucket.max,
      bucket.maxPrice,
      bucket.upper,
      bucket.to,
      bucket.lt,
    );
    if ((min == null || value >= min) && (max == null || value < max)) {
      return i;
    }
  }
  return -1;
}

export function deferUntilResolveAt(resolveAt, now = Date.now()) {
  if (!resolveAt) return;
  const target = new Date(resolveAt).getTime();
  if (!Number.isFinite(target) || now >= target) return;
  const err = new Error('price_resolution_not_ready');
  err.benign = true;
  err.info = { resolveAt };
  throw err;
}
