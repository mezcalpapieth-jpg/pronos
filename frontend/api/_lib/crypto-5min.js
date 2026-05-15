/**
 * Crypto 5-min markets — rolling auto-generated BTC/ETH direction markets.
 *
 * Polymarket-style "will BTC be higher or lower than $T at the next 5-min
 * boundary?" markets. New market opens every 5 minutes per asset; lasts
 * exactly one window; resolves automatically at the next boundary using
 * the same Chainlink price read that opens the next window.
 *
 * Lifecycle, run by cron every minute (only does work AT 5-min boundaries):
 *
 *   At T = 12:00:00 (hh:mm where mm % 5 === 0):
 *     1. Read Chainlink BTC/USD and ETH/USD on Arbitrum One
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

import { readChainlinkPrice, FEEDS_ARBITRUM_ONE } from './chainlink.js';
import { initialReserves } from './amm-math.js';
import { withTransaction } from './db-tx.js';
import { bestEffortPersistResolvedCryptoMarketSnapshot } from './crypto-chart-snapshot.js';

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

const WINDOW_MS = 5 * 60_000;
const ARCHIVE_AFTER_MS = 24 * 60 * 60_000; // 24 h

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

// Floor a Date to the most recent 5-min boundary (UTC). 12:03:42 → 12:00:00.
function floorTo5MinBoundary(d) {
  const out = new Date(d);
  out.setUTCSeconds(0, 0);
  out.setUTCMinutes(out.getUTCMinutes() - (out.getUTCMinutes() % 5));
  return out;
}

// Build the stable (source, source_event_id) pair for a window. The
// window-start ISO suffix (without millis) makes the row unique per
// asset per window, idempotent across re-runs.
function eventKey(assetKey, windowStartIso) {
  return {
    source: 'chainlink-5min',
    source_event_id: `${assetKey}:${windowStartIso}`,
  };
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
  const boundary = floorTo5MinBoundary(now);
  const sinceBoundaryMs = now.getTime() - boundary.getTime();

  // We only do real work in the first ~60s after a 5-min boundary.
  // Outside that window the cron tick is a no-op (returns quickly).
  // This keeps the cron lightweight on the 4 minutes per 5 where
  // there's nothing to do.
  if (sinceBoundaryMs > 60_000) {
    return { processed: false, reason: 'between_boundaries', boundaryAt: boundary.toISOString() };
  }

  // Read both Chainlink prices in parallel. If a feed errors, skip
  // that asset for this tick — its window will be retried next minute
  // (the per-tick gate above) so transient failures self-heal.
  const priceResults = await Promise.all(ASSETS.map(a =>
    readChainlinkPrice(a.feed)
      .then(p => ({ ok: true, price: p }))
      .catch(e => ({ ok: false, error: e?.message || 'chainlink_failed' })),
  ));

  const closingStart = new Date(boundary.getTime() - WINDOW_MS);
  const closingEnd = boundary;
  const openingStart = boundary;
  const openingEnd = new Date(boundary.getTime() + WINDOW_MS);
  const upcomingStart = openingEnd;
  const upcomingEnd = new Date(upcomingStart.getTime() + WINDOW_MS);

  const report = {
    processed: true,
    boundaryAt: boundary.toISOString(),
    perAsset: [],
    archived: 0,
    dry,
  };

  for (let i = 0; i < ASSETS.length; i++) {
    const asset = ASSETS[i];
    const pr = priceResults[i];
    const entry = { asset: asset.key, price: pr.ok ? pr.price : null };

    if (!pr.ok) {
      entry.error = pr.error;
      report.perAsset.push(entry);
      continue;
    }

    const price = pr.price;
    const threshold = roundThreshold(price);
    entry.threshold = threshold;

    // ── 1. RESOLVE the market that just closed (if any). ─────────────
    // Outcome is decided in SQL — we compare the row's stored
    // resolver_config.threshold against the current price in a single
    // CASE expression, so we don't need to read-then-write here.
    const closing = eventKey(asset.key, closingStart.toISOString());

    if (!dry) {
      try {
        // Resolve + freeze the final chart in one transactional pass.
        // Snapshot persistence is best-effort inside the tx via a
        // savepoint, so a snapshot failure never blocks settlement.
        const resolved = await withTransaction(async (client) => {
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
                    resolver_config = jsonb_set(resolver_config, '{closePrice}', to_jsonb($1::numeric))
              WHERE source = $2
                AND source_event_id = $3
                AND status = 'active'
                AND outcome IS NULL
            RETURNING id, outcome`,
            [price, closing.source, closing.source_event_id],
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
    const opening = eventKey(asset.key, openingStart.toISOString());

    if (!dry) {
      try {
        const activateRows = await sql`
          UPDATE points_markets
          SET status = 'active',
              resolver_config = resolver_config
                || jsonb_build_object(
                  'threshold',  ${threshold}::numeric,
                  'openPrice',  ${price}::numeric,
                  'openedAt',   ${openingStart.toISOString()}::text
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
            status: 'active',
            threshold,
            openPrice: price,
          });
          if (created?.id) entry.activatedId = created.id;
        }
      } catch (e) {
        entry.activateError = e?.message || 'activate_failed';
      }
    }

    // ── 3. CREATE the upcoming pending market. ──────────────────────
    if (!dry) {
      try {
        const created = await insertCryptoMarket(sql, {
          asset,
          windowStart: upcomingStart,
          windowEnd: upcomingEnd,
          status: 'pending',
          threshold: null,
          openPrice: null,
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

// Insert a 5-min crypto market. ON CONFLICT DO NOTHING on the
// (source, source_event_id) pair — re-running the cron can't dupe rows.
// We use the "raw" points_markets row shape so this bypasses the admin
// pending queue entirely (no human review on auto-generated 5-min markets).
async function insertCryptoMarket(sql, { asset, windowStart, windowEnd, status, threshold, openPrice }) {
  const key = eventKey(asset.key, windowStart.toISOString());
  const question = thresholdQuestion(asset, threshold, windowEnd);
  const resolverConfig = {
    source: 'chainlink',
    feedAddress: asset.feed.feedAddress,
    chainId: asset.feed.chainId,
    symbol: asset.symbol,
    shape: 'binary-direction', // distinct from the existing 'binary' shape
    asset: asset.key,
    coinbaseProductId: asset.coinbaseProductId,
    threshold: threshold == null ? null : Number(threshold),
    openPrice: openPrice == null ? null : Number(openPrice),
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
      mode
    )
    VALUES (
      ${key.source}, ${key.source_event_id},
      'crypto', NULL, 'crypto', ${asset.icon},
      ${question}, ${JSON.stringify(OUTCOMES)}::jsonb, NULL,
      ${JSON.stringify(reserves)}::jsonb, 1000, ${windowStart.toISOString()}, ${windowEnd.toISOString()},
      'unified', ${status},
      'chainlink_price', ${JSON.stringify(resolverConfig)}::jsonb,
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
