const DEFAULT_ORIGINS = [
  'https://pronos.io',
  'https://www.pronos.io',
  'http://localhost:3333',
  'http://127.0.0.1:3333',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function allowedOrigins() {
  const fromEnv = (process.env.API_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_ORIGINS;
}

/**
 * Same-origin check: the browser's Origin header equals the schema +
 * host the request was actually served from. Used to allow Vercel
 * preview deploys (every PR/branch gets its own *.vercel.app
 * hostname) and any future custom domain without forcing operators
 * to maintain an env-var allowlist that drifts each redeploy.
 *
 * x-forwarded-proto is always set to 'https' on Vercel for HTTPS
 * traffic; the http/connection.encrypted fallback covers local dev.
 */
function isSameOriginAsRequest(req, origin) {
  if (!origin) return false;
  const host = req.headers.host;
  if (!host) return false;
  const proto = req.headers['x-forwarded-proto']
    || (req.connection?.encrypted ? 'https' : 'http');
  return origin === `${proto}://${host}`;
}

/**
 * applyCors — sets CORS headers, handles preflight, and (by default)
 * enforces an Origin allowlist on state-changing requests.
 *
 * The state-changing-origin check closes the M7 "no CSRF protection"
 * audit item. Without it, an attacker page could trigger a "simple"
 * POST (Content-Type: application/x-www-form-urlencoded, no preflight
 * required) at our API and rely on the browser sending session
 * cookies. With this, any POST/PUT/PATCH/DELETE from a non-allowed
 * Origin is rejected before the handler runs.
 *
 * Trade-off: requests without an Origin header (curl, server-to-
 * server, some old in-app webviews) pass through. That's acceptable
 * because:
 *   - Browser-driven CSRF requires the browser to attach the auth
 *     cookie, and modern browsers always emit Origin on POSTs.
 *   - Tools like curl don't carry the user's session cookie, so they
 *     can't forge an authenticated request to begin with.
 *
 * Pass `enforceSameOriginForStateChanging: false` to opt out (e.g.
 * for endpoints that intentionally accept server-to-server traffic).
 */
export function applyCors(req, res, {
  methods = 'GET, POST, OPTIONS',
  headers = 'Content-Type, Authorization',
  credentials = false,
  enforceSameOriginForStateChanging = true,
} = {}) {
  const origin = req.headers.origin;
  // Same-origin requests are always allowed — they're the page
  // calling its own API. This covers Vercel preview deploys
  // (*.vercel.app hostnames that aren't in the static allowlist)
  // and any custom domain we add later. Cross-origin requests still
  // need to be in allowedOrigins() to pass.
  const sameOrigin = isSameOriginAsRequest(req, origin);
  const allowed = origin && (allowedOrigins().includes(origin) || sameOrigin);

  res.setHeader('Vary', 'Origin');
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);

  if (req.method === 'OPTIONS') {
    if (origin && !allowed) return res.status(403).end();
    return res.status(200).end();
  }

  // CSRF guard: state-changing methods from a CROSS-origin source
  // must be in the allowlist. Same-origin (the page hitting its own
  // API) always passes — that's the normal app flow. The check still
  // blocks evil.com from triggering authenticated POSTs at our API
  // because evil.com → pronos.io is cross-origin and not allowlisted.
  if (
    enforceSameOriginForStateChanging
    && req.method !== 'GET'
    && req.method !== 'HEAD'
    && origin
    && !allowed
  ) {
    res.status(403).json({ error: 'cross_origin_state_change' });
    return res;
  }

  return null;
}
