/**
 * POST /api/points/buy
 * Body: { marketId, outcomeIndex, collateral }
 *
 * Off-chain MXNP buy. Points-app only — every market in `points_markets`
 * lives entirely in Postgres; no chain calls happen here. The MVP build's
 * on-chain trading flow is at /api/protocol/buy, backed by Turnkey
 * delegated signing in _lib/onchain-trader.js.
 *
 * Atomic: reads state with row locks, validates, computes AMM math,
 * writes derived state — all inside a single Postgres transaction.
 * Uses the Pool-backed withTransaction helper because Neon's HTTP
 * client cannot carry session state across separate queries.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryBuyQuote, multiBuyQuote } from '../_lib/amm-math.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { withTransaction } from '../_lib/db-tx.js';
import { seriesTradeLockFromRows } from '../_lib/series-markets.js';
import { bestEffortInsertPointsPriceSnapshot } from '../_lib/points-price-snapshots.js';
import {
  combineBuyOrderbookMatches,
  executeTriggeredLimitOrders,
  matchPronosMakerAsksForBuy,
  matchRestingAsksForBuy,
} from '../_lib/points-limit-orders.js';
import { assertCryptoTradeAllowed } from '../_lib/points-crypto-trade-guard.js';
import {
  TOURNAMENT_MAX_SHARES_PER_MARKET,
  tournamentRulesActive,
} from '../_lib/points-tournament-config.js';
import { assertTournamentMinimumEntry } from '../_lib/points-tournament-entry.js';

// Lightweight HTTP client used only to run the idempotent schema bootstrap.
// Transactional work goes through withTransaction() which uses a WS Pool.
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function readSeriesTradeLock(client, market) {
  const cfg = parseJsonb(market.resolver_config, null);
  if (cfg?.source !== 'espn' || !cfg?.leaguePath) return null;
  const anchor = market.start_time || market.end_time || market.created_at;
  if (!anchor) return null;
  const siblingResult = await client.query(
    `SELECT id, question, outcomes, start_time, end_time,
            status, outcome, resolved_at, final_score,
            resolver_config, sport, league
       FROM points_markets
      WHERE parent_id IS NULL
        AND resolver_type = 'sports_api'
        AND resolver_config->>'source' = 'espn'
        AND resolver_config->>'leaguePath' = $1
        AND start_time >= $2::timestamptz - INTERVAL '45 days'
        AND start_time <= $2::timestamptz + INTERVAL '45 days'
      ORDER BY start_time ASC NULLS LAST, id ASC
      LIMIT 80`,
    [cfg.leaguePath, anchor],
  );
  return seriesTradeLockFromRows(market, siblingResult.rows);
}

async function assertTournamentShareCap(client, { marketId, username, additionalShares }) {
  if (!tournamentRulesActive()) return;
  const rows = await client.query(
    `SELECT outcome_index, shares
       FROM points_positions
      WHERE market_id = $1
        AND username = $2
      FOR UPDATE`,
    [marketId, username],
  );
  const currentShares = rows.rows.reduce((sum, row) => sum + Number(row.shares || 0), 0);
  if (currentShares + Number(additionalShares || 0) > TOURNAMENT_MAX_SHARES_PER_MARKET + 0.000001) {
    const err = new Error('tournament_share_cap');
    err.status = 400;
    err.detail = `Máximo ${TOURNAMENT_MAX_SHARES_PER_MARKET.toLocaleString('es-MX')} acciones por mercado en el torneo.`;
    throw err;
  }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `buy:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const { marketId, outcomeIndex, collateral, minSharesOut, maxAvgPrice } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi  = parseInt(outcomeIndex, 10);
  const amt = Number(collateral);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  // outcome_index upper bound is validated once we have the market's
  // reserves count (binary=2 or trinary=3). Just guard the lower bound here.
  if (!Number.isInteger(oi) || oi < 0)    return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(amt) || amt <= 0)   return res.status(400).json({ error: 'invalid_amount' });

  // Slippage guards (optional). Client sends what it quoted; server
  // rejects with `price_moved` if the locked quote exceeds the
  // tolerance. Either bound works — both kick in if both are set.
  //   minSharesOut: lowest share count the user will accept
  //   maxAvgPrice:  highest avg price/share the user will accept
  const minShares = Number.isFinite(Number(minSharesOut)) ? Number(minSharesOut) : null;
  const maxPrice  = Number.isFinite(Number(maxAvgPrice))  ? Number(maxAvgPrice)  : null;

  const username = session.username;

  try {
    // Schema bootstrapping is idempotent and safe outside the transaction —
    // it just makes sure the tables exist on first invocation.
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      // Lock the market row first, then the position row — consistent lock
      // order across buy/sell prevents deadlocks.
      const marketResult = await client.query(
        `SELECT m.id, m.question, m.status, m.reserves, m.outcomes, m.start_time, m.end_time,
                m.created_at, m.resolver_type, m.resolver_config, m.sport, m.league,
                m.seed_liquidity, m.seed_liquidities, m.amm_mode, m.parent_id,
                COALESCE(m.tournament_featured, p.tournament_featured, false) AS tournament_featured
         FROM points_markets m
         LEFT JOIN points_markets p ON p.id = m.parent_id
         WHERE m.id = $1
         FOR UPDATE OF m`,
        [mid],
      );
      if (marketResult.rows.length === 0) {
        const err = new Error('market_not_found'); err.status = 404; throw err;
      }
      const m = marketResult.rows[0];
      if (m.status !== 'active') {
        const err = new Error('market_closed'); err.status = 400; throw err;
      }
      if (m.end_time && new Date(m.end_time) <= new Date()) {
        const err = new Error('market_expired'); err.status = 400; throw err;
      }
      await assertTournamentMinimumEntry(client, {
        market: m,
        username,
        amount: amt,
      });
      assertCryptoTradeAllowed(m);
      const seriesLock = await readSeriesTradeLock(client, m);
      if (seriesLock?.locked) {
        const err = new Error(seriesLock.status === 'not_needed' ? 'series_game_not_needed' : 'series_game_pending');
        err.status = 400;
        err.detail = seriesLock.summary || seriesLock.reason;
        throw err;
      }
      const reserves = parseJsonb(m.reserves, []).map(Number);
      // Dispatch AMM by outcome count:
      //   N=2 → audited binary CPMM (mirrors PronosAMM.sol).
      //   N≥3 → unified multi CPMM (prices sum to 1 via the factor-trick
      //         invariant in amm-math.js). Parallel binary event groups
      //         are a separate amm_mode to be added later.
      if (reserves.length < 2) {
        const err = new Error('degenerate_reserves'); err.status = 400; throw err;
      }
      if (oi >= reserves.length) {
        const err = new Error('invalid_outcome_index'); err.status = 400; throw err;
      }

      const balanceResult = await client.query(
        `SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE`,
        [username],
      );
      const currentBalance = balanceResult.rows.length > 0
        ? Number(balanceResult.rows[0].balance)
        : 0;
      if (currentBalance < amt) {
        const err = new Error('insufficient_balance'); err.status = 400; throw err;
      }

      const realOrderbookMatch = await matchRestingAsksForBuy(client, {
        market: m,
        marketId: mid,
        username,
        outcomeIndex: oi,
        collateralBudget: amt,
      });
      const makerOrderbookMatch = realOrderbookMatch.remainingCollateral > 0.000001
        ? await matchPronosMakerAsksForBuy(client, {
          market: m,
          marketId: mid,
          username,
          outcomeIndex: oi,
          collateralBudget: realOrderbookMatch.remainingCollateral,
        })
        : null;
      const orderbookMatch = combineBuyOrderbookMatches(realOrderbookMatch, makerOrderbookMatch);
      const ammCollateral = orderbookMatch.remainingCollateral > 0.000001
        ? orderbookMatch.remainingCollateral
        : 0;

      let quote = null;
      if (ammCollateral > 0) {
        try {
          quote = reserves.length === 2
            ? binaryBuyQuote(reserves, oi, ammCollateral)
            : multiBuyQuote(reserves, oi, ammCollateral);
        } catch (e) {
          const err = new Error('invalid_quote'); err.status = 400; err.detail = e.message; throw err;
        }
      }

      const totalSharesOut = orderbookMatch.sharesOut + Number(quote?.sharesOut || 0);
      const totalSpent = orderbookMatch.collateralSpent + ammCollateral;
      const totalFee = Number(quote?.fee || 0);
      const combinedAvgPrice = totalSharesOut > 0.000001
        ? (totalSpent - totalFee) / totalSharesOut
        : 0;

      // Slippage enforcement — we already hold FOR UPDATE on the
      // market row, so the quote above is authoritative. If it drifted
      // past the client's tolerance between their preview and now,
      // bail with a specific error so the UI can re-quote cleanly.
      if (minShares !== null && totalSharesOut < minShares) {
        const err = new Error('price_moved'); err.status = 409;
        err.detail = `shares_out=${totalSharesOut.toFixed(6)} below min=${minShares}`;
        throw err;
      }
      if (maxPrice !== null && combinedAvgPrice > maxPrice) {
        const err = new Error('price_moved'); err.status = 409;
        err.detail = `avg_price=${combinedAvgPrice.toFixed(6)} above max=${maxPrice}`;
        throw err;
      }
      if (totalSharesOut <= 0.000001 || totalSpent <= 0.000001) {
        const err = new Error('invalid_quote'); err.status = 400; throw err;
      }

      if (quote) {
        await assertTournamentShareCap(client, {
          marketId: mid,
          username,
          additionalShares: quote.sharesOut,
        });
      }

      // Persist reserves + balance + trade + position + audit log.
      if (quote) {
        await client.query(
          `UPDATE points_markets SET reserves = $1::jsonb WHERE id = $2`,
          [JSON.stringify(quote.reservesAfter), mid],
        );
      }

      const newBalance = currentBalance - totalSpent;
      await client.query(
        `UPDATE points_balances SET balance = $1, updated_at = NOW() WHERE username = $2`,
        [newBalance, username],
      );

      if (quote) {
        await client.query(
          `INSERT INTO points_trades (
             market_id, username, side, outcome_index,
             shares, collateral, fee, price_at_trade,
             reserves_before, reserves_after
           ) VALUES ($1, $2, 'buy', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
          [
            mid, username, oi,
            quote.sharesOut, ammCollateral, quote.fee, quote.avgPrice,
            JSON.stringify(reserves),
            JSON.stringify(quote.reservesAfter),
          ],
        );

        await client.query(
          `INSERT INTO points_positions (market_id, username, outcome_index, shares, cost_basis)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (market_id, username, outcome_index) DO UPDATE
           SET shares     = points_positions.shares + EXCLUDED.shares,
               cost_basis = points_positions.cost_basis + EXCLUDED.cost_basis,
               dismissed_at = NULL,
               updated_at = NOW()`,
          [mid, username, oi, quote.sharesOut, ammCollateral],
        );
      }

      await client.query(
        `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
         VALUES ($1, $2, 'trade_buy', $3, $4)`,
        [
          username,
          -totalSpent,
          mid,
          `Compra de ${totalSharesOut.toFixed(2)} acciones`,
        ],
      );

      if (quote) {
        await bestEffortInsertPointsPriceSnapshot(client, {
          marketId: mid,
          reserves: quote.reservesAfter,
          logLabel: 'points-buy-price-snapshot',
        });
      }

      const triggeredLimitOrders = await executeTriggeredLimitOrders(client, {
        marketId: mid,
      });

      return {
        balance: newBalance,
        sharesOut: totalSharesOut,
        fee: totalFee,
        priceBefore: quote?.priceBefore ?? orderbookMatch.avgPrice,
        priceAfter: quote?.priceAfter ?? orderbookMatch.avgPrice,
        orderbookFills: orderbookMatch.fills,
        triggeredLimitOrders,
      };
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    // Structured errors from inside the transaction carry `.status` so we
    // echo them back with a matching HTTP code.
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[points/buy] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'buy_failed' });
  }
}
