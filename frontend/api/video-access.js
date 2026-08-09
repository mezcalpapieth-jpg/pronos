import { applyCors } from './_lib/cors.js';
import {
  buildVideoAccessCookie,
  readVideoAccessCookie,
  verifyVideoAccessCookie,
  verifyVideoAccessPassword,
} from './_lib/video-access-gate.js';

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;

  if (req.method === 'GET') {
    return res.status(200).json({ ok: verifyVideoAccessCookie(readVideoAccessCookie(req.headers)) });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const result = verifyVideoAccessPassword(req.body?.password);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  res.setHeader('Set-Cookie', buildVideoAccessCookie({ headers: req.headers }));
  return res.status(200).json({ ok: true });
}
