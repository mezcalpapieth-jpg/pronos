/**
 * GET/POST /api/cron/aicm-timetable-poll
 *
 * Polls Aviation Edge's live timetable for AICM departures and stores the
 * per-flight delay each poll reports. The archive endpoint publishes three
 * days late, so this is what lets a Friday-close market resolve on Saturday
 * instead of the following Monday.
 *
 * A flight's delay grows while it waits, so the store keeps the newest
 * reading per flight rather than the first.
 *
 * Manual probes:
 *   /api/cron/aicm-timetable-poll?dry=1
 */
import { neon } from '@neondatabase/serverless';

import {
  fetchAicmTimetable,
  persistAicmTimetableObservations,
  recordAicmTimetableRun,
} from '../_lib/aicm-timetable.js';
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
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!process.env.AVIATION_EDGE_KEY) {
    return res.status(503).json({ error: 'aviation_edge_key_missing' });
  }

  const started = Date.now();
  const dryRun = boolQuery(req.query?.dry);
  const observedAt = new Date().toISOString();

  try {
    if (!dryRun) await ensurePointsSchema(sql);
    const parsed = await fetchAicmTimetable({ observedAt });
    const operatorRows = parsed.observations.length;

    if (!dryRun) {
      await recordAicmTimetableRun(sql, {
        status: operatorRows ? 'ok' : 'empty',
        observedAt,
        totalRows: parsed.totalRows,
        operatorRows,
      });
      await persistAicmTimetableObservations(sql, { observations: parsed.observations });
    }

    const delayed = parsed.observations.filter(o => Number(o.delayMinutes) > 30).length;
    return res.status(200).json({
      ok: true,
      dryRun,
      observedAt,
      totalRows: parsed.totalRows,
      codeshares: parsed.codeshares,
      operatorRows,
      delayedOver30: delayed,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    console.error('[cron/aicm-timetable-poll] failed', {
      message: e?.message,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    if (!dryRun) {
      try {
        await recordAicmTimetableRun(sql, {
          status: 'fetch_error',
          observedAt,
          error: e?.message?.slice(0, 240) || 'unknown',
        });
      } catch { /* the run log is best-effort */ }
    }
    return res.status(500).json({
      error: 'aicm_timetable_poll_failed',
      detail: e?.message?.slice(0, 240) || null,
      elapsedMs: Date.now() - started,
    });
  }
}
