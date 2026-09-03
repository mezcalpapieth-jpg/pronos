import { applyCors } from './_lib/cors.js';
import {
  buildDemoAccessCookie,
  readDemoAccessCookie,
  verifyDemoAccessCookie,
  verifyDemoAccessPassword,
} from './_lib/demo-access-gate.js';

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;

  if (req.method === 'GET') {
    return res.status(200).json({ ok: verifyDemoAccessCookie(readDemoAccessCookie(req.headers)) });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const result = verifyDemoAccessPassword(req.body?.password);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  res.setHeader('Set-Cookie', buildDemoAccessCookie({ headers: req.headers }));
  return res.status(200).json({ ok: true });
}
