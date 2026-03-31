// ─── POLYMARKET CLOB PROXY ────────────────────────────────────────────────────
// Proxies CLOB requests server-side to avoid CORS restrictions in the browser.

const CLOB_BASE = 'https://clob.polymarket.com';

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const allowed = origin === 'https://pronos.io' || origin === 'http://localhost:3333';
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://pronos.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, POLY_ADDRESS, POLY_SIGNATURE, POLY_TIMESTAMP, POLY_NONCE, POLY_API_KEY, POLY_PASSPHRASE');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ── POST /api/clob?action=derive-key ─────────────────────────────────────────
  // Derives CLOB API credentials from a signed L1 message.
  // Body: { address, signature, timestamp, nonce }
  if (action === 'derive-key' && req.method === 'POST') {
    const { address, signature, timestamp, nonce = 0 } = req.body;
    if (!address || !signature || !timestamp) {
      return res.status(400).json({ error: 'address, signature, timestamp required' });
    }
    try {
      const r = await fetch(`${CLOB_BASE}/auth/derive-api-key`, {
        method: 'GET',
        headers: {
          'POLY_ADDRESS':   address,
          'POLY_SIGNATURE': signature,
          'POLY_TIMESTAMP': timestamp,
          'POLY_NONCE':     String(nonce),
        },
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST /api/clob?action=place-order ─────────────────────────────────────────
  // Places a signed order on the CLOB.
  // Body: { order, owner, orderType, apiKey, secret, passphrase }
  if (action === 'place-order' && req.method === 'POST') {
    const { order, owner, orderType = 'GTC', apiKey, secret, passphrase } = req.body;
    if (!order || !owner || !apiKey) {
      return res.status(400).json({ error: 'order, owner, apiKey required' });
    }

    const body = JSON.stringify({ order, owner, orderType });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Build L2 HMAC signature
    const crypto = await import('crypto');
    const message = timestamp + 'POST' + '/order' + body;
    const hmacSig = crypto
      .createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(message)
      .digest('base64');

    try {
      const r = await fetch(`${CLOB_BASE}/order`, {
        method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          'POLY_ADDRESS':   owner,
          'POLY_API_KEY':   apiKey,
          'POLY_PASSPHRASE': passphrase,
          'POLY_SIGNATURE': hmacSig,
          'POLY_TIMESTAMP': timestamp,
        },
        body,
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── GET /api/clob?action=positions&address=0x... ──────────────────────────────
  if (action === 'positions' && req.method === 'GET') {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'address required' });
    try {
      const r = await fetch(`https://data-api.polymarket.com/positions?user=${address}&sizeThreshold=0.01&limit=50`);
      const data = await r.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(404).json({ error: 'Unknown action' });
}
