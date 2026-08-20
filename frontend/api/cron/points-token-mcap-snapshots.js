/**
 * GET/POST /api/cron/points-token-mcap-snapshots
 *
 * Polls CoinGecko market-cap snapshots for active token-market-cap oracle
 * markets. These rows are the primary close-time evidence used by the
 * coingecko-token-mcap resolver; GeckoTerminal is checked only at resolve
 * time as a sanity source.
 */
import { neon } from '@neondatabase/serverless';

import { ensurePointsSchema } from '../_lib/points-schema.js';
import {
  COINGECKO_TOKEN_MCAP_SOURCE,
  readCoinGeckoTokenMarketCap,
  writeSolanaTokenMcapSnapshot,
} from '../_lib/solana-token-mcap.js';

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

function parseJsonb(value, fallback = null) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const started = Date.now();
  const dryRun = boolQuery(req.query?.dry);
  const capturedAt = new Date().toISOString();

  try {
    await ensurePointsSchema(sql);
    const candidates = await sql.query(`
      SELECT id, resolver_config
        FROM points_markets
       WHERE status = 'active'
         AND resolver_type = 'api_price'
         AND resolver_config->>'source' = $1
         AND end_time > NOW() - INTERVAL '10 minutes'
       ORDER BY end_time ASC, id ASC
       LIMIT 25
    `, [COINGECKO_TOKEN_MCAP_SOURCE]);
    const rows = candidates?.rows || [];
    const markets = rows.map(row => ({
      id: Number(row.id),
      cfg: parseJsonb(row.resolver_config, {}),
    })).filter(row => row.id && row.cfg?.coinId && row.cfg?.tokenAddress);

    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        count: markets.length,
        sample: markets.slice(0, 5).map(row => ({
          id: row.id,
          coinId: row.cfg.coinId,
          tokenAddress: row.cfg.tokenAddress,
        })),
        elapsedMs: Date.now() - started,
      });
    }

    const cache = new Map();
    const written = [];
    const errors = [];

    for (const market of markets) {
      const key = `${String(market.cfg.coinId).toLowerCase()}|${String(market.cfg.tokenAddress)}`;
      let snapshot = cache.get(key);
      try {
        if (!snapshot) {
          snapshot = await readCoinGeckoTokenMarketCap({
            coinId: market.cfg.coinId,
            capturedAt,
          });
          cache.set(key, snapshot);
        }
        await writeSolanaTokenMcapSnapshot(sql, {
          marketId: market.id,
          coinId: market.cfg.coinId,
          network: market.cfg.network || 'solana',
          tokenAddress: market.cfg.tokenAddress,
          snapshot,
        });
        written.push({
          id: market.id,
          coinId: market.cfg.coinId,
          capturedAt: snapshot.capturedAt,
          marketCap: snapshot.marketCap,
        });
      } catch (e) {
        errors.push({
          id: market.id,
          coinId: market.cfg.coinId,
          error: e?.message?.slice(0, 200) || 'snapshot_failed',
        });
      }
    }

    const purged = await sql.query(`
      DELETE FROM points_token_mcap_snapshots
       WHERE captured_at < NOW() - INTERVAL '60 days'
       RETURNING id
    `);

    return res.status(errors.length ? 207 : 200).json({
      ok: errors.length === 0,
      capturedAt,
      candidates: markets.length,
      fetchedCoins: cache.size,
      written: written.length,
      sample: written.slice(0, 5),
      errors,
      purged: (purged?.rows || []).length,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    console.error('[cron/points-token-mcap-snapshots] failed', {
      message: e?.message,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'token_mcap_snapshot_failed',
      detail: e?.message?.slice(0, 240) || null,
      elapsedMs: Date.now() - started,
    });
  }
}
