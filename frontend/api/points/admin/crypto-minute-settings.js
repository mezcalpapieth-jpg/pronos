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
  CRYPTO_MINUTE_MARKET_ENABLED_ASSETS_KEY,
  CRYPTO_MINUTE_MARKET_INTERVAL_KEY,
  CRYPTO_MINUTE_MARKET_INTERVALS,
  DEFAULT_CRYPTO_MINUTE_MARKET_ENABLED_ASSETS,
  normalizeCryptoMinuteMarketAssets,
  readCryptoMinuteMarketAssets,
  readCryptoMinuteMarketInterval,
} from '../../_lib/crypto-5min.js';

const sql = neon(process.env.DATABASE_URL);

function intervalLabel(minutes) {
  if (Number(minutes) === 24 * 60) return '24 horas';
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

function requestedEnabledAssets(body = {}) {
  if (
    !Object.prototype.hasOwnProperty.call(body, 'enabledAssets')
    && !Object.prototype.hasOwnProperty.call(body, 'assets')
  ) {
    return null;
  }
  return normalizeCryptoMinuteMarketAssets(body.enabledAssets ?? body.assets);
}

function assetOptions(enabledAssets) {
  const enabled = new Set(normalizeCryptoMinuteMarketAssets(enabledAssets));
  return [
    { key: 'btc', label: 'BTC', name: 'Bitcoin', enabled: enabled.has('btc') },
    { key: 'eth', label: 'ETH', name: 'Ethereum', enabled: enabled.has('eth') },
  ];
}

async function saveEnabledAssets(enabledAssets) {
  await sql`
    INSERT INTO points_app_settings (key, value, updated_at)
    VALUES (
      ${CRYPTO_MINUTE_MARKET_ENABLED_ASSETS_KEY},
      ${JSON.stringify(enabledAssets)}::jsonb,
      NOW()
    )
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = NOW()
  `;
}

async function archiveDisabledPendingAssets(enabledAssets) {
  const enabled = new Set(normalizeCryptoMinuteMarketAssets(enabledAssets));
  const disabled = DEFAULT_CRYPTO_MINUTE_MARKET_ENABLED_ASSETS.filter((asset) => !enabled.has(asset));
  if (disabled.length === 0) return 0;

  const rows = await sql`
    UPDATE points_markets
       SET archived_at = NOW()
     WHERE source = 'chainlink-5min'
       AND status = 'pending'
       AND outcome IS NULL
       AND parent_id IS NULL
       AND archived_at IS NULL
       AND LOWER(COALESCE(resolver_config->>'asset', SPLIT_PART(source_event_id, ':', 1))) = ANY(${disabled}::text[])
     RETURNING id
  `;
  return rows.length;
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
      const enabledAssets = await readCryptoMinuteMarketAssets(sql);
      return res.status(200).json({
        ok: true,
        intervalMinutes,
        enabledAssets,
        assets: assetOptions(enabledAssets),
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
    const enabledAssets = requestedEnabledAssets(req.body || {})
      ?? await readCryptoMinuteMarketAssets(sql);

    await saveInterval(intervalMinutes);
    await saveEnabledAssets(enabledAssets);
    const archivedPending = await archiveDisabledPendingAssets(enabledAssets);
    return res.status(200).json({
      ok: true,
      intervalMinutes,
      enabledAssets,
      assets: assetOptions(enabledAssets),
      archivedPending,
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
