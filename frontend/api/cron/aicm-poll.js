/**
 * GET/POST /api/cron/aicm-poll
 *
 * Polls AICM's official flight-status board for departures and arrivals.
 * This is an oracle rehearsal endpoint only: it records source health and
 * deduped flight-status evidence, but it does not create, resolve, or mutate
 * prediction markets.
 *
 * Manual probes:
 *   /api/cron/aicm-poll?dry=1
 *   /api/cron/aicm-poll?direction=departure
 */
import { neon } from '@neondatabase/serverless';

import { runAicmOraclePoll } from '../_lib/aicm-board.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';

const sql = neon(process.env.DATABASE_URL);

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);
  if (!secret) return !isVercelDeploy;
  const auth = req.headers.authorization || '';
  const provided = req.query?.key || auth.replace(/^Bearer\s+/i, '');
  return provided === secret;
}

function boolQuery(value) {
  return value === '1' || value === 'true' || value === true;
}

export default async function handler(req, res) {
  if (!authorized(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const started = Date.now();
  const dryRun = boolQuery(req.query?.dry);
  const direction = req.query?.direction || 'both';

  try {
    if (!dryRun) await ensurePointsSchema(sql);
    const result = await runAicmOraclePoll({
      sql: dryRun ? null : sql,
      direction,
      dryRun,
    });

    return res.status(200).json({
      ok: true,
      ...result,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    console.error('[cron/aicm-poll] failed', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'aicm_poll_failed',
      detail: e?.message?.slice(0, 240) || null,
      elapsedMs: Date.now() - started,
    });
  }
}
