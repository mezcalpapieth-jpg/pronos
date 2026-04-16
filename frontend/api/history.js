import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { ensureProtocolSchema } from './_lib/protocol-schema.js';

/**
 * /api/history?address=0x... — Full transaction history for a wallet.
 *
 * Returns every trade (buy + sell) the user ever made on the own protocol,
 * grouped per market, with the market's current resolution state attached.
 * For each group we compute:
 *   - totalInvested  = Σ buy collateral
 *   - totalReceived  = Σ sell proceeds + (if won) redemption payout
 *   - netPnl         = totalReceived − totalInvested
 *   - stillHeld      = buy_shares − sell_shares (any outcome)
 *   - resolutionWon  = true only if the market resolved AND the user's
 *                      winning outcome shares exceed sold amount
 *
 * This is intentionally a flat aggregation from the `trades` table so we
 * don't need a separate "closed positions" materialized view — whatever
 * trades exist is the source of truth.
 */

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL || process.env.DATABASE_READ_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });

  const addr = address.toLowerCase();

  try {
    await ensureProtocolSchema(schemaSql);

    // Pull every trade AND every on-chain redemption for this wallet in
    // parallel. Redemptions come from the `redemptions` table populated by
    // the indexer watching WinningsRedeemed events — they're authoritative
    // on-chain payouts, used to override our share×$1 estimate when available.
    //
    // We catch redemption query errors independently so that if the table
    // doesn't exist yet (e.g. a deploy where /api/migrate hasn't run) the
    // whole endpoint doesn't 500 — we just fall back to estimating payouts
    // from the trades table like before.
    const [tradesResult, redemptionsResult] = await Promise.allSettled([
      sql`
        SELECT
          t.id              AS trade_id,
          t.market_id,
          t.side,
          t.is_yes,
          t.outcome_index,
          t.collateral_amt,
          t.shares_amt,
          t.fee_amt,
          t.price_at_trade,
          t.tx_hash,
          t.block_number,
          t.created_at,
          m.question,
          m.category,
          m.chain_id,
          m.market_id       AS protocol_market_id,
          m.protocol_version,
          m.status,
          m.outcome,
          m.outcomes,
          m.end_time,
          m.pool_address,
          m.resolved_at
        FROM trades t
        JOIN protocol_markets m ON m.id = t.market_id
        WHERE t.trader = ${addr}
        ORDER BY t.created_at ASC
      `,
      sql`
        SELECT
          r.id              AS redemption_id,
          r.market_id,
          r.outcome_index,
          r.shares,
          r.payout,
          r.tx_hash,
          r.block_number,
          r.created_at
        FROM redemptions r
        WHERE r.user_address = ${addr}
      `,
    ]);

    if (tradesResult.status === 'rejected') {
      throw tradesResult.reason;
    }
    const rows = tradesResult.value;
    const redemptionRows = redemptionsResult.status === 'fulfilled'
      ? redemptionsResult.value
      : [];
    if (redemptionsResult.status === 'rejected') {
      console.warn('[history] redemptions query failed, falling back to estimates:', redemptionsResult.reason?.message);
    }

    // Build a lookup: market_id → total on-chain payout + per-market detail.
    // A single user could redeem multiple times (partial redemption) so we sum.
    const redemptionsByMarket = new Map();
    for (const r of redemptionRows || []) {
      const mid = r.market_id;
      if (!redemptionsByMarket.has(mid)) {
        redemptionsByMarket.set(mid, { totalPayout: 0, totalShares: 0, events: [] });
      }
      const bucket = redemptionsByMarket.get(mid);
      const payout = Number(r.payout || 0);
      const shares = Number(r.shares || 0);
      bucket.totalPayout += payout;
      bucket.totalShares += shares;
      bucket.events.push({
        id: r.redemption_id,
        outcomeIndex: r.outcome_index,
        shares,
        payout,
        txHash: r.tx_hash,
        blockNumber: r.block_number,
        createdAt: r.created_at,
      });
    }

    // Group by market_id → per-market summary + transaction list
    const markets = new Map();

    for (const r of rows) {
      const marketId = r.market_id;
      if (!markets.has(marketId)) {
        const redemptionInfo = redemptionsByMarket.get(marketId);
        markets.set(marketId, {
          marketId,
          question: r.question,
          category: r.category,
          chainId: r.chain_id,
          protocolMarketId: r.protocol_market_id,
          protocolVersion: r.protocol_version || 'v1',
          status: r.status,
          outcome: r.outcome, // winning outcome index (set when resolved)
          outcomes: parseJson(r.outcomes, []),
          endTime: r.end_time,
          resolvedAt: r.resolved_at,
          poolAddress: r.pool_address,
          transactions: [],
          // Per-outcome accumulators for resolved-market PnL attribution
          byOutcome: new Map(),
          // On-chain redemption data for this market (authoritative payout)
          redemptionPayout: redemptionInfo ? redemptionInfo.totalPayout : 0,
          redemptionShares: redemptionInfo ? redemptionInfo.totalShares : 0,
          redemptionEvents: redemptionInfo ? redemptionInfo.events : [],
        });
      }

      const market = markets.get(marketId);
      const outcomeIndex = r.outcome_index != null
        ? Number(r.outcome_index)
        : (r.is_yes ? 0 : 1);

      if (!market.byOutcome.has(outcomeIndex)) {
        market.byOutcome.set(outcomeIndex, {
          buyShares: 0,
          buyCost: 0,
          sellShares: 0,
          sellProceeds: 0,
        });
      }
      const oc = market.byOutcome.get(outcomeIndex);
      const shares = Number(r.shares_amt || 0);
      const collateral = Number(r.collateral_amt || 0);
      const fee = Number(r.fee_amt || 0);

      if (r.side === 'buy') {
        oc.buyShares += shares;
        oc.buyCost += collateral;
      } else {
        oc.sellShares += shares;
        oc.sellProceeds += collateral;
      }

      market.transactions.push({
        id: r.trade_id,
        side: r.side,
        outcomeIndex,
        outcomeLabel: labelFor(parseJson(r.outcomes, []), outcomeIndex, r.protocol_version),
        shares: roundToken(shares),
        collateral: roundMoney(collateral),
        fee: roundMoney(fee),
        priceAtTrade: Number(r.price_at_trade || 0),
        txHash: r.tx_hash,
        blockNumber: r.block_number,
        createdAt: r.created_at,
      });
    }

    const history = Array.from(markets.values()).map(m => {
      let totalInvested = 0;
      let totalReceived = 0;
      let stillHeld = false;
      let winningOutcomeShares = 0;
      const winningOutcomeIndex = m.status === 'resolved' ? Number(m.outcome) : null;

      // v1's `outcome` column is 1-based (1 = YES, 2 = NO) while v2 uses
      // 0-based outcome_index. Normalize to the 0-based outcome_index scale
      // that trades.outcome_index uses so we can look up the user's winning
      // side correctly.
      const normalizedWinIdx = winningOutcomeIndex == null
        ? null
        : (m.protocolVersion === 'v2'
            ? winningOutcomeIndex
            : winningOutcomeIndex - 1);

      for (const [outcomeIndex, oc] of m.byOutcome.entries()) {
        totalInvested += oc.buyCost;
        totalReceived += oc.sellProceeds;
        const held = Math.max(0, oc.buyShares - oc.sellShares);
        if (held > 0.000001) stillHeld = true;
        if (normalizedWinIdx != null && outcomeIndex === normalizedWinIdx) {
          winningOutcomeShares = held;
        }
      }

      // Redemption payout: if the indexer already saw a WinningsRedeemed
      // event for this user in this market, use the on-chain payout
      // amount (authoritative). Otherwise estimate from held winning
      // shares × $1 — each winning share in a resolved market redeems
      // 1:1 for USDC via PronosAMM.redeem().
      let redemptionPayout = m.redemptionPayout || 0; // injected below from redemptions table
      const redemptionOnChain = redemptionPayout > 0;
      let outcomeStatus = 'open'; // open | exited | pending | won | lost

      if (m.status === 'resolved' && normalizedWinIdx != null) {
        // Market is fully resolved on-chain.
        if (!redemptionOnChain && winningOutcomeShares > 0.000001) {
          // User hasn't redeemed yet but has winning shares; estimate
          // the payout so PnL still reflects the win.
          redemptionPayout = winningOutcomeShares;
        }
        totalReceived += redemptionPayout;
        if (winningOutcomeShares > 0.000001 || redemptionOnChain) {
          outcomeStatus = 'won';
        } else {
          outcomeStatus = 'lost';
        }
      } else if (!stillHeld) {
        // User fully exited before the market resolved.
        outcomeStatus = 'exited';
      } else {
        // User still holds shares in an unresolved market.
        // If the market's end_time has passed we call it "pendiente"
        // (awaiting oracle/admin resolution). Otherwise it's "open".
        const now = Date.now();
        const endMs = m.endTime ? new Date(m.endTime).getTime() : null;
        if (endMs && endMs <= now) {
          outcomeStatus = 'pending';
        } else {
          outcomeStatus = 'open';
        }
      }

      const netPnl = totalReceived - totalInvested;

      return {
      // Merge on-chain redemption events into the transaction list so
      // the UI shows them alongside buys/sells. Each redeem event renders
      // as a "redeem" row with the authoritative on-chain payout.
      const allTransactions = [...m.transactions];
      for (const evt of (m.redemptionEvents || [])) {
        const evtOutcomeIdx = evt.outcomeIndex != null ? Number(evt.outcomeIndex) : normalizedWinIdx;
        allTransactions.push({
          id: `redeem-${evt.id}`,
          side: 'redeem',
          outcomeIndex: evtOutcomeIdx,
          outcomeLabel: labelFor(m.outcomes, evtOutcomeIdx, m.protocolVersion),
          shares: roundToken(evt.shares),
          collateral: roundMoney(evt.payout),
          fee: 0,
          priceAtTrade: 1,
          txHash: evt.txHash,
          blockNumber: evt.blockNumber,
          createdAt: evt.createdAt,
        });
      }
      // Keep transactions in chronological order
      allTransactions.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      return {
        marketId: m.marketId,
        question: m.question,
        category: m.category,
        chainId: m.chainId,
        protocolMarketId: m.protocolMarketId,
        protocolVersion: m.protocolVersion,
        status: m.status,
        outcome: m.outcome,
        outcomes: m.outcomes,
        winningOutcomeLabel: labelFor(m.outcomes, normalizedWinIdx, m.protocolVersion),
        endTime: m.endTime,
        resolvedAt: m.resolvedAt,
        outcomeStatus,
        totalInvested: roundMoney(totalInvested),
        totalReceived: roundMoney(totalReceived),
        redemptionPayout: roundMoney(redemptionPayout),
        redemptionOnChain,
        netPnl: roundMoney(netPnl),
        stillHeld,
        transactions: allTransactions,
      };
    });

    // Sort: active first (open/pending), then newest closed
    const statusPriority = { open: 0, pending: 1, won: 2, lost: 2, exited: 2 };
    history.sort((a, b) => {
      const aPri = statusPriority[a.outcomeStatus] ?? 3;
      const bPri = statusPriority[b.outcomeStatus] ?? 3;
      if (aPri !== bPri) return aPri - bPri;
      const aTime = a.resolvedAt || a.transactions[a.transactions.length - 1]?.createdAt || 0;
      const bTime = b.resolvedAt || b.transactions[b.transactions.length - 1]?.createdAt || 0;
      return new Date(bTime) - new Date(aTime);
    });

    // Cumulative totals across the whole account
    const totalPnl = history.reduce((sum, m) => sum + m.netPnl, 0);
    const totalWins = history
      .filter(m => m.outcomeStatus === 'won')
      .reduce((sum, m) => sum + m.netPnl, 0);
    const marketsWon = history.filter(m => m.outcomeStatus === 'won').length;
    const marketsLost = history.filter(m => m.outcomeStatus === 'lost').length;
    const marketsExited = history.filter(m => m.outcomeStatus === 'exited').length;
    const marketsOpen = history.filter(m => m.outcomeStatus === 'open').length;
    const marketsPending = history.filter(m => m.outcomeStatus === 'pending').length;

    return res.status(200).json({
      address: addr,
      history,
      summary: {
        totalPnl: roundMoney(totalPnl),
        totalWins: roundMoney(totalWins),
        marketsTotal: history.length,
        marketsWon,
        marketsLost,
        marketsExited,
        marketsOpen,
        marketsPending,
      },
    });
  } catch (e) {
    console.error('History API error:', {
      message: e?.message,
      code: e?.code,
      detail: e?.detail,
      hint: e?.hint,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({ error: 'Server error' });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function parseJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function labelFor(outcomes, outcomeIndex, protocolVersion) {
  if (outcomeIndex == null) return null;
  if (protocolVersion === 'v2' && Array.isArray(outcomes) && outcomes[outcomeIndex]) {
    return outcomes[outcomeIndex];
  }
  // v1 binary: 0 = Sí, 1 = No
  return outcomeIndex === 0 ? 'Sí' : 'No';
}

function roundMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function roundToken(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1_000_000) / 1_000_000 : 0;
}
