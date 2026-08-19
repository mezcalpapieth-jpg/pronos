/**
 * Crypto minute markets — rolling auto-generated BTC/ETH direction markets.
 *
 * Polymarket-style "will BTC be higher or lower than $T at the next interval
 * boundary?" markets. The active interval is an admin setting; each market
 * lasts exactly one selected window and resolves automatically at the next
 * boundary using the Coinbase candle close for that boundary. Chainlink stays
 * recorded on the row for audit/compatibility, but it is too sparse for
 * minute-level settlement.
 *
 * Lifecycle, run by cron every minute:
 *
 *   Between boundaries:
 *     - Record sparse server-side chart ticks so fresh visitors see
 *       movement even if nobody had a browser open.
 *     - Pre-create upcoming pending windows so the UI can already show
 *       the next market before it needs to activate.
 *
 *   At T = 12:00:00 (hh:mm where mm % interval === 0):
 *     1. Read Coinbase BTC/USD and ETH/USD minute candles at the boundary
 *     2. For each asset:
 *        a. RESOLVE  the [11:55, 12:00] market that just closed
 *           - Compare price vs that market's stored threshold
 *           - HIGHER wins if price > threshold, LOWER if price < threshold
 *        b. ACTIVATE the [12:00, 12:05] market that just opened
 *           - Was sitting as status='pending', threshold=null (created at T=11:55)
 *           - Set resolver_config.threshold = round(price)
 *           - Set status = 'active'
 *        c. CREATE   the [12:05, 12:10] market for the next window
 *           - status='pending', threshold=null
 *           - Will get its threshold at T=12:05 (next tick)
 *     3. ARCHIVE 5-min crypto markets resolved >24h ago
 *
 * Idempotency:
 *   - All three SQL operations use precise (source, source_event_id) keys
 *     so re-running the same tick is a no-op (UPDATE WHERE status='pending'
 *     etc; INSERT ON CONFLICT DO NOTHING).
 *   - The cron can fire late or twice and still be safe.
 *
 * Production-only: this generator is GATED on VERCEL_ENV === 'production'.
 * Preview deploys don't run any boundaries — see docstring at top of
 * runCrypto5MinTick(). The preview UI will see no 5-min markets at all,
 * which is what we want until points-app merges to main.
 *
 * Threshold rounding: nearest $1. Eliminates statistical ties (price
 * landing exactly on threshold to the cent at T+5 ≈ 1 in 1000+ — and we
 * void as a paper rule for that edge case).
 */

import { FEEDS_ARBITRUM_ONE } from './chainlink.js';
import { initialReserves } from './amm-math.js';
import { withTransaction } from './db-tx.js';
import { bestEffortPersistResolvedCryptoMarketSnapshot } from './crypto-chart-snapshot.js';
import { bestEffortPersistTopHolderSnapshot } from './points-top-holders.js';
import { readCoinbaseBoundaryPrice, readCoinbaseTickerPrice } from './crypto-price-source.js';
import {
  CRYPTO_TICK_RETENTION_HOURS,
  insertCryptoTick,
  maybePruneCryptoTicks,
} from './crypto-ticks.js';

// ─── Configuration ──────────────────────────────────────────────────────────

const ASSETS = [
  {
    key: 'btc',
    label: 'Bitcoin',
    symbol: 'BTC/USD',
    icon: '₿',
    feed: FEEDS_ARBITRUM_ONE.BTC_USD,
    coinbaseProductId: 'BTC-USD', // for the live ticker WebSocket
  },
  {
    key: 'eth',
    label: 'Ethereum',
    symbol: 'ETH/USD',
    icon: 'Ξ',
    feed: FEEDS_ARBITRUM_ONE.ETH_USD,
    coinbaseProductId: 'ETH-USD',
  },
];

const ARCHIVE_AFTER_MS = 24 * 60 * 60_000; // 24 h
const DEFAULT_LOOKAHEAD_WINDOWS = 2;
const DEFAULT_MISSED_PENDING_CATCHUP_LIMIT = 12;
const DEFAULT_ACTIVE_CATCHUP_LIMIT = 12;
export const CRYPTO_MINUTE_MARKET_INTERVALS = Object.freeze([5, 10, 15, 30, 60, 12 * 60, 24 * 60]);
export const DEFAULT_CRYPTO_MINUTE_MARKET_INTERVAL = 5;
export const CRYPTO_MINUTE_MARKET_INTERVAL_KEY = 'points_crypto_minute_market_interval';
export const CRYPTO_MINUTE_MARKET_ENABLED_ASSETS_KEY = 'points_crypto_minute_market_enabled_assets';
export const DEFAULT_CRYPTO_MINUTE_MARKET_ENABLED_ASSETS = Object.freeze(['btc', 'eth']);
const CRYPTO_MIDNIGHT_CDMX_ANCHOR_MS = 6 * 60 * 60_000; // 00:00 CDMX == 06:00 UTC.
const CRYPTO_9AM_CDMX_ANCHOR_MS = 15 * 60 * 60_000; // 09:00 CDMX == 15:00 UTC.

// Outcome labels and indices. Index 0 = SUBE (HIGHER), 1 = BAJA (LOWER).
// Match the "parallel-shape" semantics already used elsewhere: outcome
// at index i wins when winningIdx === i.
const OUTCOMES = ['SUBE', 'BAJA'];

// ─── Helpers ────────────────────────────────────────────────────────────────

// Round to nearest $1. With 8-decimal Chainlink feeds the probability
// of a final price landing exactly on a whole dollar is statistically
// negligible — this eliminates the tie case in practice.
function roundThreshold(price) {
  return Math.round(price);
}

export function normalizeCryptoMinuteMarketInterval(value) {
  const raw = value && typeof value === 'object'
    ? value.minutes ?? value.intervalMinutes ?? value.value
    : value;
  const minutes = Number(raw);
  if (CRYPTO_MINUTE_MARKET_INTERVALS.includes(minutes)) return minutes;
  return DEFAULT_CRYPTO_MINUTE_MARKET_INTERVAL;
}

function normalizeAssetKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return ASSETS.some((asset) => asset.key === key) ? key : null;
}

export function normalizeCryptoMinuteMarketAssets(value) {
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const key = normalizeAssetKey(item);
      if (key && !out.includes(key)) out.push(key);
    }
    return out;
  }

  if (value && typeof value === 'object') {
    if (Array.isArray(value.enabledAssets)) {
      return normalizeCryptoMinuteMarketAssets(value.enabledAssets);
    }
    if (Array.isArray(value.assets)) {
      return normalizeCryptoMinuteMarketAssets(value.assets);
    }
    if (value.assets && typeof value.assets === 'object') {
      return normalizeCryptoMinuteMarketAssets(value.assets);
    }

    let sawToggle = false;
    const out = [];
    for (const asset of ASSETS) {
      if (!Object.prototype.hasOwnProperty.call(value, asset.key)) continue;
      sawToggle = true;
      if (value[asset.key] === true) out.push(asset.key);
    }
    if (sawToggle) return out;
  }

  return [...DEFAULT_CRYPTO_MINUTE_MARKET_ENABLED_ASSETS];
}

export async function readCryptoMinuteMarketInterval(sql) {
  try {
    const rows = await sql`
      SELECT value
      FROM points_app_settings
      WHERE key = ${CRYPTO_MINUTE_MARKET_INTERVAL_KEY}
      LIMIT 1
    `;
    return normalizeCryptoMinuteMarketInterval(rowsFromQuery(rows)[0]?.value);
  } catch (e) {
    // Brand-new local DBs can call this before points_app_settings exists.
    // Keep the generator operational on its long-standing 5-minute default.
    if (e?.code === '42P01' || /points_app_settings/i.test(e?.message || '')) {
      return DEFAULT_CRYPTO_MINUTE_MARKET_INTERVAL;
    }
    throw e;
  }
}

export async function readCryptoMinuteMarketAssets(sql) {
  try {
    const rows = await sql`
      SELECT value
      FROM points_app_settings
      WHERE key = ${CRYPTO_MINUTE_MARKET_ENABLED_ASSETS_KEY}
      LIMIT 1
    `;
    if (rowsFromQuery(rows).length === 0) {
      return [...DEFAULT_CRYPTO_MINUTE_MARKET_ENABLED_ASSETS];
    }
    return normalizeCryptoMinuteMarketAssets(rowsFromQuery(rows)[0]?.value);
  } catch (e) {
    if (e?.code === '42P01' || /points_app_settings/i.test(e?.message || '')) {
      return [...DEFAULT_CRYPTO_MINUTE_MARKET_ENABLED_ASSETS];
    }
    throw e;
  }
}

function cryptoAssetsFromSetting(value) {
  const enabled = normalizeCryptoMinuteMarketAssets(value);
  return ASSETS.filter((asset) => enabled.includes(asset.key));
}

function windowMsForInterval(intervalMinutes) {
  return normalizeCryptoMinuteMarketInterval(intervalMinutes) * 60_000;
}

export function resolveDirectionOutcome(closePrice, threshold) {
  const price = Number(closePrice);
  const line = Number(threshold);
  if (!Number.isFinite(price) || !Number.isFinite(line)) {
    throw new Error('crypto-5min: invalid close price or threshold');
  }
  if (price > line) return 0;
  if (price < line) return 1;
  return null;
}

export function formatDirectionFinalScore(threshold, closePrice) {
  return `$${Number(threshold)} -> $${Number(closePrice).toFixed(2)}`;
}

function cryptoBoundaryAnchorMs(intervalMinutes) {
  return intervalMinutes === 12 * 60
    ? CRYPTO_9AM_CDMX_ANCHOR_MS
    : CRYPTO_MIDNIGHT_CDMX_ANCHOR_MS;
}

// Floor a Date to the most recent interval boundary. Minute/hour
// windows align the same as UTC; 12h windows anchor to 09:00/21:00
// CDMX, while 24h windows keep the existing 00:00 CDMX open/close.
export function floorToCryptoBoundary(d, intervalMinutes = DEFAULT_CRYPTO_MINUTE_MARKET_INTERVAL) {
  const interval = normalizeCryptoMinuteMarketInterval(intervalMinutes);
  const date = d instanceof Date ? d : new Date(d);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return new Date(NaN);
  const windowMs = interval * 60_000;
  const anchorMs = cryptoBoundaryAnchorMs(interval);
  return new Date(Math.floor((ms - anchorMs) / windowMs) * windowMs + anchorMs);
}

// Backward-compatible helper used by older tests/imports.
export function floorTo5MinBoundary(d) {
  return floorToCryptoBoundary(d, 5);
}

export function crypto5MinWindowsForTick(nowInput = new Date(), intervalMinutes = DEFAULT_CRYPTO_MINUTE_MARKET_INTERVAL) {
  const interval = normalizeCryptoMinuteMarketInterval(intervalMinutes);
  const windowMs = windowMsForInterval(interval);
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const boundary = floorToCryptoBoundary(now, interval);
  const sinceBoundaryMs = now.getTime() - boundary.getTime();
  const nextBoundary = new Date(boundary.getTime() + windowMs);
  return {
    now,
    boundary,
    intervalMinutes: interval,
    sinceBoundaryMs,
    nextBoundary,
    msUntilNextBoundary: nextBoundary.getTime() - now.getTime(),
  };
}

// Build the stable (source, source_event_id) pair for a window. The
// window-start ISO suffix makes the row unique per asset per window,
// idempotent across re-runs. Preserve legacy 5-minute keys; append the
// interval for longer cadences so they never collide with old 5-minute rows.
function eventKey(assetKey, windowStartIso, intervalMinutes = DEFAULT_CRYPTO_MINUTE_MARKET_INTERVAL) {
  const interval = normalizeCryptoMinuteMarketInterval(intervalMinutes);
  const intervalSuffix = interval === DEFAULT_CRYPTO_MINUTE_MARKET_INTERVAL ? '' : `:${interval}m`;
  return {
    source: 'chainlink-5min',
    source_event_id: `${assetKey}:${windowStartIso}${intervalSuffix}`,
  };
}

function rowsFromQuery(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

export async function readGeneratedCryptoHiddenFromHome(sql) {
  try {
    const rows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE hidden_from_home IS TRUE)::int AS hidden_count,
        COUNT(*) FILTER (WHERE hidden_from_home IS NOT TRUE)::int AS visible_count
      FROM points_markets
      WHERE status IN ('active', 'pending')
        AND parent_id IS NULL
        AND archived_at IS NULL
        AND COALESCE(mode, 'points') = 'points'
    `;
    const row = rowsFromQuery(rows)[0] || {};
    return Number(row.hidden_count || 0) > 0 && Number(row.visible_count || 0) === 0;
  } catch (e) {
    if (e?.code === '42P01' || /points_markets/i.test(e?.message || '')) return false;
    throw e;
  }
}

export async function persistCryptoHistoryHeartbeat(sql, {
  assets = ASSETS,
  dry = false,
  now = new Date(),
  readTickerPrice = readCoinbaseTickerPrice,
} = {}) {
  if (!sql) throw new Error('crypto-5min: sql client required');

  const report = {
    checked: 0,
    stored: 0,
    skipped: 0,
    pruned: 0,
    errors: [],
    ticks: [],
    retentionHours: CRYPTO_TICK_RETENTION_HOURS,
    dry,
  };

  for (const asset of assets || []) {
    if (!asset?.key || !asset?.coinbaseProductId) continue;
    report.checked += 1;
    const entry = { asset: asset.key };
    if (dry) {
      report.ticks.push({ ...entry, dry: true });
      continue;
    }

    try {
      const price = await readTickerPrice({
        productId: asset.coinbaseProductId,
        capturedAt: now,
      });
      const tick = await insertCryptoTick(sql, {
        asset: asset.key,
        price: price.price,
        capturedAt: price.capturedAt || now,
      });
      const cleanup = await maybePruneCryptoTicks(sql, {
        asset: asset.key,
        stored: tick.stored,
        bucketIso: tick.bucket,
      });

      if (tick.stored) report.stored += 1;
      else report.skipped += 1;
      if (cleanup.pruned) report.pruned += cleanup.deleted;

      report.ticks.push({
        ...entry,
        price: price.price,
        priceSource: price.source,
        priceAt: price.capturedAt,
        bucket: tick.bucket,
        stored: tick.stored,
        cleanup: cleanup.pruned,
        pruned: cleanup.deleted,
      });
    } catch (e) {
      const error = e?.message || 'ticker_failed';
      report.errors.push({ asset: asset.key, error });
      report.ticks.push({ ...entry, error });
    }
  }

  return report;
}

function parseJsonb(value, fallback) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function toIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`crypto-5min: invalid ${label}`);
  }
  return date.toISOString();
}

function assetForSourceEventId(sourceEventId) {
  const assetKey = String(sourceEventId || '').split(':')[0]?.toLowerCase();
  return ASSETS.find((asset) => asset.key === assetKey) || null;
}

// ─── Per-tick lifecycle ─────────────────────────────────────────────────────

/**
 * Process all asset lifecycles for the current 5-min boundary.
 *
 * Caller (indexer cron, or the dedicated /api/cron/crypto-5min endpoint)
 * should invoke this on every tick. The function self-checks whether
 * there's an active boundary to process, so calling it off-boundary is
 * a cheap no-op.
 *
 * @param {object} opts
 * @param {import('@neondatabase/serverless').NeonQueryFunction} opts.sql
 * @param {boolean} opts.dry - If true, don't write to DB / don't gate on VERCEL_ENV.
 *   Useful for admin manual testing on preview.
 * @param {boolean} opts.force - Skip the production-env gate. Required to actually
 *   write rows on a non-production environment.
 * @returns {Promise<{processed: boolean, atBoundary: boolean, ...}>}
 */
export async function runCrypto5MinTick({ sql, dry = false, force = false } = {}) {
  if (!sql) throw new Error('crypto-5min: sql client required');

  const isProd = process.env.VERCEL_ENV === 'production';
  if (!isProd && !force && !dry) {
    return { processed: false, reason: 'not_production' };
  }

  const now = new Date();
  const intervalMinutes = await readCryptoMinuteMarketInterval(sql);
  const enabledAssets = await readCryptoMinuteMarketAssets(sql);
  const enabledAssetConfigs = cryptoAssetsFromSetting(enabledAssets);
  const historyTicks = await persistCryptoHistoryHeartbeat(sql, {
    assets: enabledAssetConfigs,
    dry,
    now,
  });
  const generatedHiddenFromHome = dry ? false : await readGeneratedCryptoHiddenFromHome(sql);
  const windowMs = windowMsForInterval(intervalMinutes);
  const { boundary, sinceBoundaryMs } = crypto5MinWindowsForTick(now, intervalMinutes);
  const precreateReport = await ensureUpcomingCryptoMarkets(sql, {
    now,
    dry,
    lookaheadWindows: DEFAULT_LOOKAHEAD_WINDOWS,
    intervalMinutes,
    enabledAssets,
    hiddenFromHome: generatedHiddenFromHome,
  });
  let activeCatchup = { checked: 0, resolved: [], errors: [], dry };
  try {
    activeCatchup = await catchUpExpiredActiveCryptoMarkets(sql, { now, dry });
  } catch (e) {
    activeCatchup.errors.push({ error: e?.message || 'active_catchup_failed' });
  }
  let pendingCatchup = { checked: 0, resolved: [], errors: [], dry };
  try {
    pendingCatchup = await catchUpMissedPendingCryptoMarkets(sql, { now, dry });
  } catch (e) {
    pendingCatchup.errors.push({ error: e?.message || 'catchup_failed' });
  }
  let activationCatchup = { checked: 0, activated: [], errors: [], dry };

  // We only do settlement work in the first ~60s after the selected interval boundary.
  // Outside that window the tick still pre-creates future pending
  // windows and records sparse chart history, but skips boundary
  // settlement price reads and settlement writes.
  if (sinceBoundaryMs > 60_000) {
    try {
      activationCatchup = await catchUpCurrentPendingCryptoMarkets(sql, {
        now,
        dry,
        intervalMinutes,
        enabledAssets,
        hiddenFromHome: generatedHiddenFromHome,
      });
    } catch (e) {
      activationCatchup.errors.push({ error: e?.message || 'activation_catchup_failed' });
    }
    return {
      processed: false,
      reason: 'between_boundaries',
      boundaryAt: boundary.toISOString(),
      intervalMinutes,
      enabledAssets,
      historyTicks,
      precreated: precreateReport.precreated,
      precreateExisting: precreateReport.existing,
      precreate: precreateReport.windows,
      activeCatchup,
      pendingCatchup,
      activationCatchup,
      dry,
    };
  }

  // Read both boundary prices in parallel. If a feed errors, skip
  // that asset for this tick — its window will be retried next minute
  // (the per-tick gate above) so transient failures self-heal.
  const priceResults = await Promise.all(ASSETS.map(a =>
    readCoinbaseBoundaryPrice({
      productId: a.coinbaseProductId,
      timestamp: boundary,
    })
      .then(p => ({ ok: true, ...p }))
      .catch(e => ({ ok: false, error: e?.message || 'boundary_price_failed' })),
  ));

  const closingStart = new Date(boundary.getTime() - windowMs);
  const closingEnd = boundary;
  const openingStart = boundary;
  const openingEnd = new Date(boundary.getTime() + windowMs);
  const upcomingStart = openingEnd;
  const upcomingEnd = new Date(upcomingStart.getTime() + windowMs);

  const report = {
    processed: true,
    boundaryAt: boundary.toISOString(),
    intervalMinutes,
    enabledAssets,
    historyTicks,
    precreated: precreateReport.precreated,
    precreateExisting: precreateReport.existing,
    precreate: precreateReport.windows,
    activeCatchup,
    pendingCatchup,
    activationCatchup,
    perAsset: [],
    archived: 0,
    dry,
  };

  for (let i = 0; i < ASSETS.length; i++) {
    const asset = ASSETS[i];
    const pr = priceResults[i];
    const entry = {
      asset: asset.key,
      price: pr.ok ? pr.price : null,
      priceSource: pr.ok ? pr.source : null,
      priceAt: pr.ok ? pr.capturedAt : null,
    };

    if (!pr.ok) {
      entry.error = pr.error;
      report.perAsset.push(entry);
      continue;
    }

    const price = pr.price;
    const threshold = roundThreshold(price);
    entry.threshold = threshold;
    const assetEnabled = enabledAssetConfigs.some((enabled) => enabled.key === asset.key);
    entry.enabled = assetEnabled;

    // ── 1. RESOLVE the market that just closed (if any). ─────────────
    // Outcome is decided in SQL — we compare the row's stored
    // resolver_config.threshold against the boundary price in a single
    // CASE expression, so we don't need to read-then-write here.
    const closing = eventKey(asset.key, closingStart.toISOString(), intervalMinutes);

    if (!dry) {
      try {
        // Resolve + freeze the final chart in one transactional pass.
        // Snapshot persistence is best-effort inside the tx via a
        // savepoint, so a snapshot failure never blocks settlement.
        const resolved = await withTransaction(async (client) => {
          const targetRows = await client.query(
            `SELECT id, resolver_config
               FROM points_markets
              WHERE source = $1
                AND source_event_id = $2
                AND status = 'active'
                AND outcome IS NULL
              LIMIT 1
              FOR UPDATE`,
            [closing.source, closing.source_event_id],
          );
          if (targetRows.rows.length === 0) return null;

          const target = targetRows.rows[0];
          const targetCfg = parseJsonb(target.resolver_config, {});
          const closingOutcome = resolveDirectionOutcome(price, Number(targetCfg.threshold));
          await bestEffortPersistTopHolderSnapshot(
            client,
            target.id,
            'crypto-5min',
            { resolution: { winningOutcomeIndex: closingOutcome } },
          );

          const resolveRows = await client.query(
            `UPDATE points_markets
                SET status = 'resolved',
                    outcome = CASE
                      WHEN $1::numeric > (resolver_config->>'threshold')::numeric THEN 0
                      WHEN $1::numeric < (resolver_config->>'threshold')::numeric THEN 1
                      ELSE NULL
                    END,
                    final_score = '$' || (resolver_config->>'threshold') || ' -> $' ||
                                  to_char($1::numeric, 'FM999999990.00'),
                    resolved_at = NOW(),
                    resolved_by = 'system',
                    resolver_config = COALESCE(resolver_config, '{}'::jsonb)
                      || jsonb_build_object(
                        'closePrice', $1::numeric,
                        'closePriceSource', $4::text,
                        'closePriceAt', $5::text
                      )
              WHERE source = $2
                AND source_event_id = $3
                AND id = $6
                AND status = 'active'
                AND outcome IS NULL
            RETURNING id, outcome`,
            [price, closing.source, closing.source_event_id, pr.source, pr.capturedAt, target.id],
          );
          if (resolveRows.rows.length === 0) return null;

          const row = resolveRows.rows[0];
          await bestEffortPersistResolvedCryptoMarketSnapshot(
            client,
            row.id,
            'crypto-5min',
          );
          return row;
        });

        if (resolved?.id) {
          entry.resolvedId = resolved.id;
          entry.resolvedOutcomeIdx = resolved.outcome;
        }
      } catch (e) {
        entry.resolveError = e?.message || 'resolve_failed';
      }
    }

    // ── 2. ACTIVATE the market that just opened. ────────────────────
    // The pending row was created last tick (or via this same loop's
    // step 3 below if this is the very first activation ever); we
    // promote it to 'active' and stamp its threshold.
    const opening = eventKey(asset.key, openingStart.toISOString(), intervalMinutes);

    if (!dry && assetEnabled) {
      try {
        const activateRows = await sql`
          UPDATE points_markets
          SET status = 'active',
              resolver_config = resolver_config
                || jsonb_build_object(
                  'threshold',  ${threshold}::numeric,
                  'openPrice',  ${price}::numeric,
                  'openedAt',   ${openingStart.toISOString()}::text,
                  'openPriceSource', ${pr.source}::text,
                  'openPriceAt', ${pr.capturedAt}::text
                )
          WHERE source = ${opening.source}
            AND source_event_id = ${opening.source_event_id}
            AND status = 'pending'
          RETURNING id
        `;
        if (activateRows.length > 0) {
          entry.activatedId = activateRows[0].id;
        } else {
          // No pending row to activate — first-run case (no prior
          // tick created it). We INSERT it directly as 'active'.
          const created = await insertCryptoMarket(sql, {
            asset,
            windowStart: openingStart,
            windowEnd: openingEnd,
            intervalMinutes,
            status: 'active',
            threshold,
            openPrice: price,
            openPriceSource: pr.source,
            openPriceAt: pr.capturedAt,
            hiddenFromHome: generatedHiddenFromHome,
          });
          if (created?.id) entry.activatedId = created.id;
        }
      } catch (e) {
        entry.activateError = e?.message || 'activate_failed';
      }
    }

    // ── 3. CREATE the upcoming pending market. ──────────────────────
    if (!dry && assetEnabled) {
      try {
        const created = await insertCryptoMarket(sql, {
          asset,
          windowStart: upcomingStart,
          windowEnd: upcomingEnd,
          intervalMinutes,
          status: 'pending',
          threshold: null,
          openPrice: null,
          hiddenFromHome: generatedHiddenFromHome,
        });
        if (created?.id) entry.createdId = created.id;
        else if (created?.alreadyExists) entry.upcomingExisted = true;
      } catch (e) {
        entry.createError = e?.message || 'create_failed';
      }
    }

    report.perAsset.push(entry);
  }

  // ── 4. Archive resolved 5-min markets older than 24h. ─────────────
  if (!dry) {
    try {
      const archived = await sql`
        UPDATE points_markets
        SET archived_at = NOW()
        WHERE source = 'chainlink-5min'
          AND status = 'resolved'
          AND archived_at IS NULL
          AND resolved_at IS NOT NULL
          AND resolved_at < NOW() - INTERVAL '24 hours'
        RETURNING id
      `;
      report.archived = archived.length;
    } catch (e) {
      report.archiveError = e?.message;
    }
  }

  return report;
}

// ─── Insertion ──────────────────────────────────────────────────────────────

export async function ensureUpcomingCryptoMarkets(sql, {
  now = new Date(),
  dry = false,
  lookaheadWindows = DEFAULT_LOOKAHEAD_WINDOWS,
  intervalMinutes = DEFAULT_CRYPTO_MINUTE_MARKET_INTERVAL,
  enabledAssets = DEFAULT_CRYPTO_MINUTE_MARKET_ENABLED_ASSETS,
  hiddenFromHome = false,
} = {}) {
  if (!sql) throw new Error('crypto-5min: sql client required');

  const count = Math.max(0, Math.floor(Number(lookaheadWindows) || 0));
  const interval = normalizeCryptoMinuteMarketInterval(intervalMinutes);
  const assets = cryptoAssetsFromSetting(enabledAssets);
  const windowMs = windowMsForInterval(interval);
  const { nextBoundary } = crypto5MinWindowsForTick(now, interval);
  const windows = [];
  let precreated = 0;
  let existing = 0;

  for (let offset = 0; offset < count; offset++) {
    const windowStart = new Date(nextBoundary.getTime() + offset * windowMs);
    const windowEnd = new Date(windowStart.getTime() + windowMs);

    for (const asset of assets) {
      const key = eventKey(asset.key, windowStart.toISOString(), interval);
      const entry = {
        asset: asset.key,
        source: key.source,
        sourceEventId: key.source_event_id,
        intervalMinutes: interval,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
      };

      if (dry) {
        windows.push({ ...entry, dry: true });
        continue;
      }

      const created = await insertCryptoMarket(sql, {
        asset,
        windowStart,
        windowEnd,
        intervalMinutes: interval,
        status: 'pending',
        threshold: null,
        openPrice: null,
        hiddenFromHome,
      });
      if (created?.id) {
        precreated += 1;
        windows.push({ ...entry, createdId: created.id });
      } else {
        existing += 1;
        windows.push({ ...entry, alreadyExists: true });
      }
    }
  }

  return { precreated, existing, windows, dry };
}

export async function catchUpCurrentPendingCryptoMarkets(sql, {
  now = new Date(),
  dry = false,
  intervalMinutes = null,
  enabledAssets = null,
  hiddenFromHome = false,
  readBoundaryPrice = readCoinbaseBoundaryPrice,
} = {}) {
  if (!sql) throw new Error('crypto-5min: sql client required');

  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = toIso(nowDate, 'activation catchup now');
  const interval = intervalMinutes == null
    ? await readCryptoMinuteMarketInterval(sql)
    : normalizeCryptoMinuteMarketInterval(intervalMinutes);
  const assets = cryptoAssetsFromSetting(
    enabledAssets == null ? await readCryptoMinuteMarketAssets(sql) : enabledAssets,
  );
  const windowMs = windowMsForInterval(interval);
  const { boundary } = crypto5MinWindowsForTick(nowDate, interval);
  const windowEnd = new Date(boundary.getTime() + windowMs);
  const report = { checked: 0, activated: [], errors: [], dry };

  if (nowDate.getTime() >= windowEnd.getTime()) return report;

  for (const asset of assets) {
    const key = eventKey(asset.key, boundary.toISOString(), interval);
    try {
      const selected = await sql`
        SELECT id, source_event_id, start_time, end_time, resolver_config
          FROM points_markets
         WHERE source = ${key.source}
           AND source_event_id = ${key.source_event_id}
           AND status = 'pending'
           AND outcome IS NULL
           AND parent_id IS NULL
           AND start_time <= ${nowIso}::timestamptz
           AND end_time > ${nowIso}::timestamptz
           AND COALESCE(resolver_config->>'threshold', '') = ''
         LIMIT 1
      `;
      const rows = rowsFromQuery(selected);
      report.checked += rows.length;
      if (rows.length === 0) {
        const existing = await sql`
          SELECT id, status
            FROM points_markets
           WHERE source = ${key.source}
             AND source_event_id = ${key.source_event_id}
             AND outcome IS NULL
             AND parent_id IS NULL
             AND archived_at IS NULL
           LIMIT 1
        `;
        if (rowsFromQuery(existing).length > 0) continue;
      }

      const openBoundary = await readBoundaryPrice({
        productId: asset.coinbaseProductId,
        timestamp: boundary,
      });
      const openPrice = Number(openBoundary.price);
      const threshold = roundThreshold(openPrice);
      const windowStart = rows.length > 0
        ? toIso(rows[0].start_time, 'current window start')
        : boundary.toISOString();
      const windowEndIso = rows.length > 0
        ? toIso(rows[0].end_time, 'current window end')
        : windowEnd.toISOString();
      const entry = {
        id: rows.length > 0 ? Number(rows[0].id) : null,
        asset: asset.key,
        sourceEventId: rows[0]?.source_event_id || key.source_event_id,
        windowStart,
        windowEnd: windowEndIso,
        threshold,
        openPrice,
        openPriceAt: openBoundary.capturedAt,
      };

      if (dry) {
        report.activated.push({ ...entry, dry: true });
        continue;
      }

      if (rows.length === 0) {
        const created = await insertCryptoMarket(sql, {
          asset,
          windowStart: boundary,
          windowEnd,
          intervalMinutes: interval,
          status: 'active',
          threshold,
          openPrice,
          openPriceSource: openBoundary.source,
          openPriceAt: openBoundary.capturedAt,
          hiddenFromHome,
        });
        if (created?.id) {
          report.activated.push({ ...entry, id: Number(created.id), created: true });
        } else if (created?.alreadyExists) {
          report.activated.push({ ...entry, alreadyExists: true });
        }
        continue;
      }

      const updated = await sql`
        UPDATE points_markets
           SET status = 'active',
               resolver_config = COALESCE(resolver_config, '{}'::jsonb)
                 || ${JSON.stringify({
                   threshold,
                   openPrice,
                   openedAt: windowStart,
                   openPriceSource: openBoundary.source,
                   openPriceAt: openBoundary.capturedAt,
                   activationCatchup: true,
                   activationCaughtUpAt: nowIso,
                 })}::jsonb
         WHERE id = ${Number(rows[0].id)}
           AND source = 'chainlink-5min'
           AND status = 'pending'
           AND outcome IS NULL
           AND COALESCE(resolver_config->>'threshold', '') = ''
         RETURNING id
      `;

      if (rowsFromQuery(updated).length > 0) {
        report.activated.push(entry);
      }
    } catch (e) {
      report.errors.push({
        asset: asset.key,
        sourceEventId: key.source_event_id,
        error: e?.message || 'activation_catchup_failed',
      });
    }
  }

  return report;
}

export async function catchUpExpiredActiveCryptoMarkets(sql, {
  now = new Date(),
  dry = false,
  limit = DEFAULT_ACTIVE_CATCHUP_LIMIT,
  readBoundaryPrice = readCoinbaseBoundaryPrice,
  transaction = withTransaction,
  persistSnapshot = bestEffortPersistResolvedCryptoMarketSnapshot,
  persistHolderSnapshot = bestEffortPersistTopHolderSnapshot,
} = {}) {
  if (!sql) throw new Error('crypto-5min: sql client required');

  const max = Math.max(0, Math.min(100, Math.floor(Number(limit) || 0)));
  const nowIso = toIso(now, 'active catchup now');
  const report = { checked: 0, resolved: [], errors: [], dry };
  if (max === 0) return report;

  const selected = await sql`
    SELECT id, source_event_id, end_time, resolver_config
      FROM points_markets
     WHERE source = 'chainlink-5min'
       AND source_event_id ~ '^(btc|eth):'
       AND status = 'active'
       AND outcome IS NULL
       AND parent_id IS NULL
       AND end_time <= ${nowIso}::timestamptz - INTERVAL '60 seconds'
       AND COALESCE(resolver_config->>'threshold', '') <> ''
     ORDER BY end_time DESC
     LIMIT ${max}
  `;
  const rows = rowsFromQuery(selected);
  report.checked = rows.length;

  for (const row of rows) {
    const asset = assetForSourceEventId(row.source_event_id);
    if (!asset) {
      report.errors.push({
        id: row.id,
        sourceEventId: row.source_event_id,
        error: 'unknown_asset',
      });
      continue;
    }

    const cfg = parseJsonb(row.resolver_config, {});
    const threshold = Number(cfg?.threshold);
    if (!Number.isFinite(threshold)) {
      report.errors.push({
        id: row.id,
        sourceEventId: row.source_event_id,
        error: 'missing_threshold',
      });
      continue;
    }

    try {
      const windowEnd = toIso(row.end_time, 'active window end');
      const closeBoundary = await readBoundaryPrice({
        productId: asset.coinbaseProductId,
        timestamp: windowEnd,
      });
      const closePrice = Number(closeBoundary.price);
      const outcome = resolveDirectionOutcome(closePrice, threshold);
      const finalScore = formatDirectionFinalScore(threshold, closePrice);
      const resolverConfigPatch = {
        closePrice,
        closePriceSource: closeBoundary.source,
        closePriceAt: closeBoundary.capturedAt,
        missedCloseCatchup: true,
        missedCloseCaughtUpAt: nowIso,
      };
      const entry = {
        id: Number(row.id),
        asset: asset.key,
        sourceEventId: row.source_event_id,
        windowEnd,
        threshold,
        closePrice,
        outcome,
        finalScore,
        closePriceAt: closeBoundary.capturedAt,
      };

      if (dry) {
        report.resolved.push({ ...entry, dry: true });
        continue;
      }

      const updated = await transaction(async (client) => {
        await persistHolderSnapshot(
          client,
          row.id,
          'crypto-5min-missed-active',
          { resolution: { winningOutcomeIndex: outcome } },
        );
        const updateRows = await client.query(
          `UPDATE points_markets
              SET status = 'resolved',
                  outcome = $2::int,
                  final_score = $3::text,
                  resolved_at = NOW(),
                  resolved_by = 'system',
                  resolver_config = COALESCE(resolver_config, '{}'::jsonb) || $4::jsonb
            WHERE id = $1
              AND source = 'chainlink-5min'
              AND status = 'active'
              AND outcome IS NULL
            RETURNING id`,
          [
            Number(row.id),
            outcome,
            finalScore,
            JSON.stringify(resolverConfigPatch),
          ],
        );
        const updatedRows = rowsFromQuery(updateRows);
        if (updatedRows.length === 0) return null;
        await persistSnapshot(client, row.id, 'crypto-5min-missed-active');
        return updatedRows[0];
      });

      if (updated?.id) {
        report.resolved.push(entry);
      }
    } catch (e) {
      report.errors.push({
        id: row.id,
        sourceEventId: row.source_event_id,
        error: e?.message || 'active_catchup_failed',
      });
    }
  }

  return report;
}

export async function catchUpMissedPendingCryptoMarkets(sql, {
  now = new Date(),
  dry = false,
  limit = DEFAULT_MISSED_PENDING_CATCHUP_LIMIT,
  readBoundaryPrice = readCoinbaseBoundaryPrice,
  transaction = withTransaction,
  persistSnapshot = bestEffortPersistResolvedCryptoMarketSnapshot,
  persistHolderSnapshot = bestEffortPersistTopHolderSnapshot,
} = {}) {
  if (!sql) throw new Error('crypto-5min: sql client required');

  const max = Math.max(0, Math.min(100, Math.floor(Number(limit) || 0)));
  const nowIso = toIso(now, 'catchup now');
  const report = { checked: 0, resolved: [], errors: [], dry };
  if (max === 0) return report;

  const selected = await sql`
    SELECT id, source_event_id, start_time, end_time, resolver_config
      FROM points_markets
     WHERE source = 'chainlink-5min'
       AND source_event_id ~ '^(btc|eth):'
       AND status = 'pending'
       AND outcome IS NULL
       AND parent_id IS NULL
       AND end_time <= ${nowIso}::timestamptz - INTERVAL '60 seconds'
       AND COALESCE(resolver_config->>'threshold', '') = ''
     ORDER BY end_time DESC
     LIMIT ${max}
  `;
  const rows = rowsFromQuery(selected);
  report.checked = rows.length;

  for (const row of rows) {
    const asset = assetForSourceEventId(row.source_event_id);
    if (!asset) {
      report.errors.push({
        id: row.id,
        sourceEventId: row.source_event_id,
        error: 'unknown_asset',
      });
      continue;
    }

    try {
      const windowStart = toIso(row.start_time, 'window start');
      const windowEnd = toIso(row.end_time, 'window end');
      const [openBoundary, closeBoundary] = await Promise.all([
        readBoundaryPrice({
          productId: asset.coinbaseProductId,
          timestamp: windowStart,
        }),
        readBoundaryPrice({
          productId: asset.coinbaseProductId,
          timestamp: windowEnd,
        }),
      ]);
      const openPrice = Number(openBoundary.price);
      const closePrice = Number(closeBoundary.price);
      const threshold = roundThreshold(openPrice);
      const outcome = resolveDirectionOutcome(closePrice, threshold);
      const finalScore = formatDirectionFinalScore(threshold, closePrice);
      const resolverConfigPatch = {
        threshold,
        openPrice,
        openedAt: windowStart,
        openPriceSource: openBoundary.source,
        openPriceAt: openBoundary.capturedAt,
        closePrice,
        closePriceSource: closeBoundary.source,
        closePriceAt: closeBoundary.capturedAt,
        missedActivationCatchup: true,
        missedActivationCaughtUpAt: nowIso,
      };
      const entry = {
        id: Number(row.id),
        asset: asset.key,
        sourceEventId: row.source_event_id,
        windowStart,
        windowEnd,
        threshold,
        openPrice,
        closePrice,
        outcome,
        finalScore,
        openPriceAt: openBoundary.capturedAt,
        closePriceAt: closeBoundary.capturedAt,
      };

      if (dry) {
        report.resolved.push({ ...entry, dry: true });
        continue;
      }

      const updated = await transaction(async (client) => {
        await persistHolderSnapshot(
          client,
          row.id,
          'crypto-5min-missed-pending',
          { resolution: { winningOutcomeIndex: outcome } },
        );
        const updateRows = await client.query(
          `UPDATE points_markets
              SET status = 'resolved',
                  outcome = $2::int,
                  final_score = $3::text,
                  resolved_at = NOW(),
                  resolved_by = 'system',
                  resolver_config = COALESCE(resolver_config, '{}'::jsonb) || $4::jsonb
            WHERE id = $1
              AND source = 'chainlink-5min'
              AND status = 'pending'
              AND outcome IS NULL
              AND COALESCE(resolver_config->>'threshold', '') = ''
            RETURNING id`,
          [
            Number(row.id),
            outcome,
            finalScore,
            JSON.stringify(resolverConfigPatch),
          ],
        );
        const updatedRows = rowsFromQuery(updateRows);
        if (updatedRows.length === 0) return null;
        await persistSnapshot(client, row.id, 'crypto-5min-missed-pending');
        return updatedRows[0];
      });

      if (updated?.id) {
        report.resolved.push(entry);
      }
    } catch (e) {
      report.errors.push({
        id: row.id,
        sourceEventId: row.source_event_id,
        error: e?.message || 'catchup_failed',
      });
    }
  }

  return report;
}

// Insert a 5-min crypto market. ON CONFLICT DO NOTHING on the
// (source, source_event_id) pair — re-running the cron can't dupe rows.
// We use the "raw" points_markets row shape so this bypasses the admin
// pending queue entirely (no human review on auto-generated 5-min markets).
async function insertCryptoMarket(sql, {
  asset,
  windowStart,
  windowEnd,
  intervalMinutes = DEFAULT_CRYPTO_MINUTE_MARKET_INTERVAL,
  status,
  threshold,
  openPrice,
  openPriceSource = null,
  openPriceAt = null,
  hiddenFromHome = false,
}) {
  const interval = normalizeCryptoMinuteMarketInterval(intervalMinutes);
  const key = eventKey(asset.key, windowStart.toISOString(), interval);
  const question = thresholdQuestion(asset, threshold, windowEnd);
  const resolverConfig = {
    source: 'chainlink',
    feedAddress: asset.feed.feedAddress,
    chainId: asset.feed.chainId,
    symbol: asset.symbol,
    shape: 'binary-direction', // distinct from the existing 'binary' shape
    asset: asset.key,
    coinbaseProductId: asset.coinbaseProductId,
    intervalMinutes: interval,
    windowMinutes: interval,
    threshold: threshold == null ? null : Number(threshold),
    openPrice: openPrice == null ? null : Number(openPrice),
    openPriceSource: openPriceSource || null,
    openPriceAt: openPriceAt || null,
    openedAt: status === 'active' ? windowStart.toISOString() : null,
    closesAt: windowEnd.toISOString(),
    rounding: 1, // dollars
  };

  // Seed reserves: [1000, 1000] for binary direction markets (50/50
  // initial pricing). The buy/sell endpoints rebalance these via the
  // audited binary CPMM the same way every other binary market works.
  const reserves = initialReserves(1000, 2);

  const rows = await sql`
    INSERT INTO points_markets (
      source, source_event_id,
      sport, league, category, icon,
      question, outcomes, outcome_images,
      reserves, seed_liquidity, start_time, end_time,
      amm_mode, status,
      resolver_type, resolver_config,
      featured, auto_featured, hidden_from_home,
      mode
    )
    VALUES (
      ${key.source}, ${key.source_event_id},
      'crypto', NULL, 'crypto', ${asset.icon},
      ${question}, ${JSON.stringify(OUTCOMES)}::jsonb, NULL,
      ${JSON.stringify(reserves)}::jsonb, 1000, ${windowStart.toISOString()}, ${windowEnd.toISOString()},
      'unified', ${status},
      'chainlink_price', ${JSON.stringify(resolverConfig)}::jsonb,
      ${hiddenFromHome ? false : true}, false, ${hiddenFromHome ? true : false},
      'points'
    )
    ON CONFLICT (source, source_event_id) WHERE source IS NOT NULL AND source_event_id IS NOT NULL DO NOTHING
    RETURNING id
  `;

  if (rows.length === 0) {
    return { alreadyExists: true };
  }
  return { id: rows[0].id };
}

// Title shown on the market card. Intentionally generic — the
// threshold value lives on resolver_config.threshold and is rendered
// by the frontend's live-chart component, NOT baked into this string.
// That way the activation step doesn't need to UPDATE the question
// column; it just stamps a threshold and the UI picks it up.
//
// The close time is rendered in CDMX time (UTC-6, year-round since
// Mexico abolished DST in 2022) so users see a local clock value
// rather than a UTC stamp they have to mentally convert. Node 18+
// ships full-ICU by default so timeZone formatting works on Vercel.
const CDMX_TIME_FMT = new Intl.DateTimeFormat('es-MX', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Mexico_City',
});
function thresholdQuestion(asset, _threshold, windowEnd) {
  const t = `${CDMX_TIME_FMT.format(windowEnd)} CDMX`;
  return `${asset.label}: ¿sube o baja a las ${t}?`;
}

// Public utility for the frontend client / detail page.
export const CRYPTO_5MIN_ASSETS = ASSETS;
