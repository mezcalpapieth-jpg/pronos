const memoryCache = new Map();
const pendingCache = new Map();

function sanitizeMetricName(name) {
  return String(name || 'step').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48);
}

export function setCacheHeaders(res, {
  scope = 'public',
  maxAge = 30,
  sMaxage = maxAge,
  staleWhileRevalidate = 120,
} = {}) {
  const age = Math.max(0, Number(maxAge) || 0);
  const swr = Math.max(0, Number(staleWhileRevalidate) || 0);
  if (scope === 'private') {
    res.setHeader('Cache-Control', `private, max-age=${age}, stale-while-revalidate=${swr}`);
    return;
  }
  const sharedAge = Math.max(0, Number(sMaxage) || age);
  res.setHeader('Cache-Control', `public, max-age=${age}, s-maxage=${sharedAge}, stale-while-revalidate=${swr}`);
}

export async function cachedJson(key, ttlMs, producer) {
  const ttl = Math.max(0, Number(ttlMs) || 0);
  if (ttl === 0 || process.env.DISABLE_API_MEMORY_CACHE === '1') {
    return { value: await producer(), hit: false };
  }
  const hit = memoryCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return { value: hit.value, hit: true };
  const pending = pendingCache.get(key);
  if (pending) return { value: await pending, hit: true };

  const production = Promise.resolve().then(producer);
  pendingCache.set(key, production);
  try {
    const value = await production;
    // Slow reads must not consume their own cache lifetime before returning.
    memoryCache.set(key, { value, expiresAt: Date.now() + ttl });
    return { value, hit: false };
  } finally {
    pendingCache.delete(key);
  }
}

export function createApiTimer(res, label, { logThresholdMs = 350 } = {}) {
  const startedAt = Date.now();
  const steps = [];

  function record(name, durationMs) {
    steps.push({ name: sanitizeMetricName(name), durationMs });
  }

  return {
    async time(name, fn) {
      const stepStartedAt = Date.now();
      try {
        return await fn();
      } finally {
        record(name, Date.now() - stepStartedAt);
      }
    },
    mark(name, durationMs) {
      record(name, Math.max(0, Math.round(Number(durationMs) || 0)));
    },
    end(extra = {}) {
      const totalMs = Date.now() - startedAt;
      const metrics = [...steps, { name: 'total', durationMs: totalMs }]
        .map(step => `${step.name};dur=${Math.max(0, Math.round(step.durationMs))}`)
        .join(', ');
      if (metrics) res.setHeader('Server-Timing', metrics);
      if (totalMs >= logThresholdMs || process.env.API_TIMING_LOGS === '1') {
        console.info('[api-timing]', {
          route: label,
          totalMs,
          steps: Object.fromEntries(steps.map(step => [step.name, Math.round(step.durationMs)])),
          ...extra,
        });
      }
      return totalMs;
    },
  };
}
