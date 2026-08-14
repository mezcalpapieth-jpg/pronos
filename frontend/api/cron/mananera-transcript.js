/**
 * GET /api/cron/mananera-transcript
 *
 * Daily Mañanera transcript ingestion. Vercel cron runs this at the UTC
 * equivalents of 12:00, 15:00, 18:00, and 21:00 Mexico City time; the
 * handler itself checks Mexico City business days so weekends and holidays
 * without a transcript are quiet no-ops.
 *
 * Manual probes:
 *   /api/cron/mananera-transcript?date=2026-08-11
 *   /api/cron/mananera-transcript?date=2026-08-11&force=1
 */
import { neon } from '@neondatabase/serverless';

import { ensurePointsSchema } from '../_lib/points-schema.js';
import {
  ingestMananeraForDate,
  isMexicoBusinessDay,
  mexicoCityDateYmd,
  missingConsecutiveMananeraDates,
  shouldRunMananeraAttempt,
} from '../_lib/mananera-ingest.js';

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
  const now = new Date();
  const dateYmd = req.query?.date || mexicoCityDateYmd(now);
  const force = boolQuery(req.query?.force);
  const manualDate = Boolean(req.query?.date);

  if (!manualDate && !force && !shouldRunMananeraAttempt(now)) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: 'outside_mananera_attempt_window',
      dateYmd,
      elapsedMs: Date.now() - started,
    });
  }

  if (!force && !manualDate && !isMexicoBusinessDay(dateYmd)) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: 'not_business_day',
      dateYmd,
      elapsedMs: Date.now() - started,
    });
  }

  try {
    await ensurePointsSchema(sql);
    const result = await ingestMananeraForDate(sql, { dateYmd, force, now });

    let alert = false;
    let missingBusinessDates = [];
    if (!result.ready && isMexicoBusinessDay(dateYmd)) {
      missingBusinessDates = await missingConsecutiveMananeraDates(sql, dateYmd, 2);
      alert = missingBusinessDates.length >= 2;
      if (alert) {
        console.warn('[cron/mananera-transcript] missing two business-day transcripts', {
          dateYmd,
          missingBusinessDates,
          reason: result.reason,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      ...result,
      alert,
      missingBusinessDates,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    console.error('[cron/mananera-transcript] failed', {
      dateYmd,
      message: e?.message,
      code: e?.code,
      status: e?.status,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'mananera_ingest_failed',
      detail: e?.message?.slice(0, 240) || null,
      dateYmd,
      elapsedMs: Date.now() - started,
    });
  }
}
