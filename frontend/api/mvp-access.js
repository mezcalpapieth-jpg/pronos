import { applyCors } from './_lib/cors.js';
import {
  MVP_ACCESS_COOKIE_NAME,
  buildMvpAccessCookie,
  readCookie,
  verifyMvpAccessCookie,
  verifyMvpAccessPassword,
} from './_lib/mvp-access-gate.js';

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;

  if (req.method === 'GET') {
    return res.status(200).json({ ok: verifyMvpAccessCookie(readCookie(req.headers, MVP_ACCESS_COOKIE_NAME)) });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const result = verifyMvpAccessPassword(req.body?.password);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  res.setHeader('Set-Cookie', buildMvpAccessCookie({ headers: req.headers }));
  return res.status(200).json({ ok: true });
}
