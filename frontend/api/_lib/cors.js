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
  const allowed = origin && allowedOrigins().includes(origin);

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

  // CSRF guard: state-changing methods with an Origin header MUST have
  // it on the allowlist. Reject cross-origin form-style POSTs that
  // would otherwise sneak past the preflight.
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
