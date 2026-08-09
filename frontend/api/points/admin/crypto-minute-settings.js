/**
 * GET/POST /api/points/admin/crypto-minute-settings
 *
 * Admin setting for the rolling BTC/ETH minute markets. This controls
 * future generated windows only; active/pending windows already in the DB
 * keep their own start/end times and source_event_id.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import {
  CRYPTO_MINUTE_MARKET_INTERVAL_KEY,
  CRYPTO_MINUTE_MARKET_INTERVALS,
  readCryptoMinuteMarketInterval,
} from '../../_lib/crypto-5min.js';

const sql = neon(process.env.DATABASE_URL);

function intervalLabel(minutes) {
  return Number(minutes) === 60 ? '1 hora' : `${minutes} minutos`;
}

function requestedInterval(body = {}) {
  const minutes = Number(body.intervalMinutes ?? body.minutes ?? body.value);
  return CRYPTO_MINUTE_MARKET_INTERVALS.includes(minutes) ? minutes : null;
}

async function saveInterval(minutes) {
  await sql`
    INSERT INTO points_app_settings (key, value, updated_at)
    VALUES (
      ${CRYPTO_MINUTE_MARKET_INTERVAL_KEY},
      ${JSON.stringify(minutes)}::jsonb,
      NOW()
    )
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = NOW()
  `;
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (!['GET', 'POST'].includes(req.method)) {
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    await ensurePointsSchema(sql);

    if (req.method === 'GET') {
      const intervalMinutes = await readCryptoMinuteMarketInterval(sql);
      return res.status(200).json({
        ok: true,
        intervalMinutes,
        intervals: CRYPTO_MINUTE_MARKET_INTERVALS.map((minutes) => ({
          minutes,
          label: intervalLabel(minutes),
        })),
      });
    }

    const intervalMinutes = requestedInterval(req.body || {});
    if (!intervalMinutes) {
      return res.status(400).json({
        error: 'invalid_interval',
        allowed: CRYPTO_MINUTE_MARKET_INTERVALS,
      });
    }

    await saveInterval(intervalMinutes);
    return res.status(200).json({
      ok: true,
      intervalMinutes,
      updatedBy: admin.username,
    });
  } catch (e) {
    console.error('[admin/crypto-minute-settings] error', {
      message: e?.message,
      code: e?.code,
    });
    return res.status(500).json({
      error: 'settings_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
