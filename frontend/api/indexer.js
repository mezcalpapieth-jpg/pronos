import { neon } from '@neondatabase/serverless';
import { getIndexerConfig, runProtocolIndexer } from './_lib/protocol-event-indexer.js';
import { ensurePointsSchema } from './_lib/points-schema.js';
import { runCrypto5MinTick } from './_lib/crypto-5min.js';
import { shouldRunMinuteInterval } from './_lib/cron-multiplex.js';
import { runAutoResolve } from './cron/points-auto-resolve.js';
import { runTokenMcapSnapshots } from './cron/points-token-mcap-snapshots.js';
import { runProtocolAutoResolve } from './cron/protocol-auto-resolve.js';

/**
 * /api/indexer — On-chain event indexer for Pronos protocol.
 *
 * Triggered via Vercel Cron (every minute) or manual GET /api/indexer?key=<INDEXER_KEY>.
 * Reads MarketCreated, SharesBought, SharesSold, MarketResolved events
 * from the MarketFactory and AMM contracts, writes to Neon PostgreSQL.
 *
 * Environment variables required:
 *   DATABASE_URL       — Neon PostgreSQL connection
 *   INDEXER_KEY        — Auth key for manual triggers
 *   FACTORY_ADDRESS    — Deployed MarketFactory address
 *   ARB_RPC_URL        — Arbitrum RPC endpoint
 *
 * Supported aliases for Arbitrum deployments:
 *   PROTOCOL_CHAIN_ID / CHAIN_ID
 *   PRONOS_FACTORY_ADDRESS / VITE_PRONOS_ARB_SEPOLIA_FACTORY
 *   ARB_SEPOLIA_RPC / ARBITRUM_SEPOLIA_RPC_URL
 *   INDEXER_START_BLOCK (optional; first run only)
 *   INDEXER_LOOKBACK_BLOCKS (optional; first per-factory run lookback)
 *   INDEXER_MAX_BATCHES (optional; batches processed per invocation)
 */

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  // Auth: Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
  // Manual triggers use ?key=<INDEXER_KEY>.
  //
  // IMPORTANT: we no longer allow User-Agent: vercel-cron as a fallback when
  // CRON_SECRET is unset — that header is trivially spoofable and was leaving
  // the indexer fully open on any deploy where the env var wasn't configured.
  // Local dev (no VERCEL_ENV) still accepts the UA fallback for convenience.
  const cronSecret = process.env.CRON_SECRET;
  const indexerKey = process.env.INDEXER_KEY;
  const userAgent = req.headers['user-agent'] || '';
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);

  let isVercelCron = false;
  if (cronSecret) {
    isVercelCron = req.headers.authorization === `Bearer ${cronSecret}`;
  } else if (!isVercelDeploy) {
    // Local dev only — UA-based fallback so `vercel dev` works without config.
    isVercelCron = userAgent.includes('vercel-cron');
  }
  // On a Vercel deploy with no CRON_SECRET set, isVercelCron stays false
  // and the endpoint is effectively disabled until the secret is wired up.

  const isManual = Boolean(indexerKey) && req.query.key === indexerKey;

  if (!isVercelCron && !isManual) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  // ── Crypto 5-min boundary processing ──────────────────────────────
  // Multiplexed onto this cron so we don't burn a second Vercel cron
  // slot. runCrypto5MinTick is gated on VERCEL_ENV='production' so it
  // does nothing on preview deploys (the feature stays dormant until
  // points-app merges to main). On a 5-min boundary it fires the
  // resolve+activate+create lifecycle for BTC and ETH; between
  // boundaries it still writes sparse chart ticks so fresh visitors
  // see movement even if nobody had the chart open.
  // Wrapped in try/catch so any crypto-5min failure can't break the
  // on-chain indexer below.
  let crypto5MinReport = null;
  try {
    await ensurePointsSchema(sql);
    crypto5MinReport = await runCrypto5MinTick({ sql });
  } catch (e) {
    console.error('[indexer] crypto-5min tick failed', {
      message: e?.message,
      code: e?.code,
    });
    crypto5MinReport = { error: e?.message || 'crypto_5min_failed' };
  }

  // ── Token market-cap oracle snapshot fallback ─────────────────────
  // DOGGY-style markets resolve from stored close-time CoinGecko snapshots.
  // The dedicated snapshot cron is still registered, but this keeps evidence
  // capture alive on the reliable minute cron if Vercel skips that path.
  let tokenMcapSnapshotsReport = { status: 'skipped', reason: 'not_scheduled' };
  const forceTokenMcapSnapshots = req.query.tokenMcapSnapshots === '1'
    || req.query.tokenMcap === '1';
  const dryTokenMcapSnapshots = req.query.tokenMcapDry === '1'
    || req.query.tokenMcapDry === 'true';
  const tokenMcapSnapshotsOnIndexer = process.env.POINTS_TOKEN_MCAP_SNAPSHOTS_ON_INDEXER !== '0'
    && process.env.POINTS_TOKEN_MCAP_SNAPSHOTS_ON_INDEXER !== 'false';
  const shouldRunTokenMcapSnapshots = forceTokenMcapSnapshots
    || (
      tokenMcapSnapshotsOnIndexer
      && isVercelCron
      && shouldRunMinuteInterval({ intervalMinutes: 5 })
    );
  if (shouldRunTokenMcapSnapshots) {
    try {
      const result = await runTokenMcapSnapshots({ dryRun: dryTokenMcapSnapshots, purgeOld: false });
      tokenMcapSnapshotsReport = { status: 'ok', ...result };
    } catch (e) {
      console.error('[indexer] points-token-mcap-snapshots failed', {
        message: e?.message,
        code: e?.code,
      });
      tokenMcapSnapshotsReport = {
        status: 'error',
        error: e?.message?.slice(0, 240) || 'points_token_mcap_snapshots_failed',
      };
    }
  }

  // ── Points auto-resolver manual/legacy multiplex ──────────────────
  // The repo also has a dedicated /api/cron/points-auto-resolve schedule, but
  // keep a production safety net here because /api/indexer is the cron that
  // reliably fires every minute. Auto-resolve writes are status-guarded, so a
  // duplicate dedicated cron pass should no-op after the first resolver wins.
  // Recent single-game markets get a lightweight pass every minute; the full
  // manual/price/weather scan retains its 15-minute cadence.
  // Manual probe: /api/indexer?key=...&resolve=1 (add resolveDry=1 for dry-run).
  let pointsAutoResolveReport = { status: 'skipped', reason: 'not_scheduled' };
  const forceAutoResolve = req.query.resolve === '1' || req.query.autoResolve === '1';
  const dryAutoResolve = req.query.resolveDry === '1' || req.query.resolveDry === 'true';
  const pointsAutoResolveOnIndexer = process.env.POINTS_AUTO_RESOLVE_ON_INDEXER !== '0'
    && process.env.POINTS_AUTO_RESOLVE_ON_INDEXER !== 'false';
  const shouldRunPointsAutoResolve = forceAutoResolve
    || (
      pointsAutoResolveOnIndexer
      && isVercelCron
    );
  if (shouldRunPointsAutoResolve) {
    try {
      const sportsOnly = !forceAutoResolve && !shouldRunMinuteInterval({ intervalMinutes: 15 });
      const result = await runAutoResolve({ dry: dryAutoResolve, sportsOnly });
      pointsAutoResolveReport = { status: 'ok', ...result };
    } catch (e) {
      console.error('[indexer] points-auto-resolve failed', {
        message: e?.message,
        code: e?.code,
      });
      pointsAutoResolveReport = {
        status: 'error',
        error: e?.message?.slice(0, 240) || 'points_auto_resolve_failed',
      };
    }
  }

  // ── Protocol auto-resolver multiplex ─────────────────────────────
  // Same cadence as points, but the write path is an on-chain
  // resolveMarket() transaction. Manual probe:
  // /api/indexer?key=...&protocolResolve=1 (protocolResolveDry=1 for dry-run).
  let protocolAutoResolveReport = { status: 'skipped', reason: 'not_scheduled' };
  const forceProtocolAutoResolve = forceAutoResolve
    || req.query.protocolResolve === '1'
    || req.query.protocolAutoResolve === '1';
  const dryProtocolAutoResolve = dryAutoResolve
    || req.query.protocolResolveDry === '1'
    || req.query.protocolResolveDry === 'true';
  const shouldRunProtocolAutoResolve = forceProtocolAutoResolve
    || (isVercelCron && shouldRunMinuteInterval({ intervalMinutes: 15 }));
  if (shouldRunProtocolAutoResolve) {
    try {
      const result = await runProtocolAutoResolve({ dry: dryProtocolAutoResolve });
      protocolAutoResolveReport = { status: 'ok', ...result };
    } catch (e) {
      console.error('[indexer] protocol-auto-resolve failed', {
        message: e?.message,
        code: e?.code,
      });
      protocolAutoResolveReport = {
        status: 'error',
        error: e?.message?.slice(0, 240) || 'protocol_auto_resolve_failed',
      };
    }
  }

  const { factories, rpcUrl, startBlock, lookbackBlocks, maxBatches: configuredMaxBatches } = getIndexerConfig();

  if (!factories.length || !rpcUrl) {
    return res.status(200).json({
      status: 'skipped',
      reason: 'MarketFactory address or Arbitrum RPC URL not configured',
      crypto5Min: crypto5MinReport,
      tokenMcapSnapshots: tokenMcapSnapshotsReport,
      pointsAutoResolve: pointsAutoResolveReport,
      protocolAutoResolve: protocolAutoResolveReport,
    });
  }

  try {
    const indexed = await runProtocolIndexer({ query: req.query, isManual });
    return res.status(200).json({
      ...indexed,
      crypto5Min: crypto5MinReport,
      tokenMcapSnapshots: tokenMcapSnapshotsReport,
      pointsAutoResolve: pointsAutoResolveReport,
      protocolAutoResolve: protocolAutoResolveReport,
    });
  } catch (e) {
    console.error('Indexer error:', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({ error: 'Indexer failed' });
  }
}
