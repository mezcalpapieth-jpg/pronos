/**
 * POST /api/points/admin/run-auto-resolve          — run resolver
 * POST /api/points/admin/run-auto-resolve?dry=1    — preview
 *
 * Admin-auth wrapper around the auto-resolve cron's core loop.
 *
 * Why this exists: Vercel runs cron jobs ONLY on production deploys.
 * The every-15-min schedule configured in vercel.json never fires on
 * preview URLs (branch deploys, PR previews). Admins working from a
 * preview deploy need a way to kick the resolver manually — otherwise
 * every market that goes past end_time sits forever.
 *
 * Production admins can also use this to force a run without waiting
 * for the next 15-min tick (e.g., after flipping resolver_type via
 * the Retrofit button).
 */

import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { runAutoResolve } from '../../cron/points-auto-resolve.js';

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const dry = req.query.dry === '1' || req.query.dry === 'true';
    const result = await runAutoResolve({ dry });
    return res.status(200).json({ ...result, triggeredBy: admin.username });
  } catch (e) {
    console.error('[admin/run-auto-resolve] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'resolve_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
