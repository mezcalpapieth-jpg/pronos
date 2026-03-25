// ─── Vercel Edge Function: Privy Auth Proxy ──────────────────────────────────
// Proxies passwordless email auth requests to Privy so the secret never
// touches the client and CORS is handled server-side.
//
// POST /api/privy?action=init     → send OTP email
// POST /api/privy?action=verify   → verify OTP, return user + token

export const config = { runtime: 'edge' };

const PRIVY_APP_ID = 'cmmy28vhi00pe0cladoexcy0o';
const PRIVY_BASE   = 'https://auth.privy.io/api/v1';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

export default async function handler(req) {
  // Handle preflight
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (!['init', 'verify'].includes(action)) {
    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: CORS });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS });
  }

  const endpoint = action === 'init'
    ? `${PRIVY_BASE}/passwordless/init`
    : `${PRIVY_BASE}/passwordless/authenticate`;

  const privyHeaders = {
    'Content-Type': 'application/json',
    'privy-app-id': PRIVY_APP_ID,
    'origin':       'https://pronos.io',
  };

  // Add Authorization header using secret (server-side only)
  const secret = process.env.PRIVY_SECRET;
  if (secret) {
    privyHeaders['Authorization'] = 'Basic ' + btoa(`${PRIVY_APP_ID}:${secret}`);
  }

  try {
    const upstream = await fetch(endpoint, {
      method:  'POST',
      headers: privyHeaders,
      body:    JSON.stringify(body),
    });

    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502, headers: CORS });
  }
}
