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

export function applyCors(req, res, {
  methods = 'GET, POST, OPTIONS',
  headers = 'Content-Type, Authorization',
  credentials = false,
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

  return null;
}
