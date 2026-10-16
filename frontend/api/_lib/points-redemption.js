import { assertPointsExecution } from './points-execution-mode.js';
import { readActiveCycleWindow, scoringStartIsoForWindow } from './points-cycle-window.js';

const SHARE_EPSILON = 0.000001;

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

export async function redeemWinningPosition(client, {
  username, marketId, outcomeIndex, window = null, automatic = false,
}) {
  // Share the cycle lock with rollover and the cutoff snapshot before wallet locks.
  const activeWindow = window || await readActiveCycleWindow(client, { forUpdate: true });
  const scoringStartIso = scoringStartIsoForWindow(activeWindow);
  if (!scoringStartIso) fail('no_active_cycle', 409);
  const marketResult = await client.query(
    'SELECT id, mode, status, outcome FROM points_markets WHERE id = $1 FOR UPDATE', [marketId],
  );
  const m = marketResult.rows[0];
  if (!m) fail('market_not_found', 404);
  assertPointsExecution(m);
  if (m.status !== 'resolved') fail('market_not_resolved');
  if (m.outcome == null || Number(m.outcome) !== outcomeIndex) fail('losing_outcome');
  const positionResult = await client.query(`
    SELECT shares, cost_basis, realized_pnl FROM points_positions
    WHERE market_id = $1 AND username = $2 AND outcome_index = $3 FOR UPDATE
  `, [marketId, username, outcomeIndex]);
  const p = positionResult.rows[0];
  if (!p || Number(p.shares) <= 0) fail('no_shares_to_redeem');
  const shares = Number(p.shares);
  // Always subtract prior collections, including ones just after the cutoff.
  const cycleSharesResult = await client.query(`
    SELECT COALESCE(SUM(CASE WHEN side = 'buy' THEN shares ELSE -shares END), 0) AS current_cycle_shares
    FROM points_trades
    WHERE LOWER(username) = LOWER($1) AND market_id = $2 AND outcome_index = $3
      AND created_at >= $4::timestamptz
      AND (created_at <= $5::timestamptz OR side IN ('sell', 'redeem'))
      AND side IN ('buy', 'sell', 'redeem')
  `, [username, marketId, outcomeIndex, scoringStartIso, activeWindow.rankingCutoffAt]);
  const currentCycleShares = Math.max(0, Number(cycleSharesResult.rows[0]?.current_cycle_shares || 0));
  const redeemShares = Math.min(shares, currentCycleShares);
  if (redeemShares <= SHARE_EPSILON) fail('position_outside_current_cycle', 409);
  const payout = redeemShares;
  const balanceResult = await client.query(`
    INSERT INTO points_balances (username, balance, updated_at) VALUES ($1, $2, NOW())
    ON CONFLICT (username) DO UPDATE
    SET balance = points_balances.balance + EXCLUDED.balance, updated_at = NOW()
    RETURNING balance
  `, [username, payout]);
  const currentCostBasis = Number(p.cost_basis);
  const redeemedCostBasis = currentCostBasis * Math.min(1, redeemShares / shares);
  const remainingShares = Math.max(0, shares - redeemShares);
  const remainingCostBasis = Math.max(0, currentCostBasis - redeemedCostBasis);
  const staleRemainder = remainingShares > SHARE_EPSILON && currentCycleShares + SHARE_EPSILON < shares;
  const newRealized = Number(p.realized_pnl || 0) + payout - redeemedCostBasis;
  await client.query(`
    UPDATE points_positions SET shares = $1, cost_basis = $2, realized_pnl = $3,
      dismissed_at = CASE WHEN $4::boolean THEN COALESCE(dismissed_at, NOW()) ELSE dismissed_at END,
      updated_at = NOW()
    WHERE market_id = $5 AND username = $6 AND outcome_index = $7
  `, [remainingShares, remainingCostBasis, newRealized,
    remainingShares <= SHARE_EPSILON || staleRemainder, marketId, username, outcomeIndex]);
  await client.query(`
    INSERT INTO points_trades (market_id, username, side, outcome_index,
      shares, collateral, fee, price_at_trade, source)
    VALUES ($1, $2, 'redeem', $3, $4, $5, 0, 1, $6)
  `, [marketId, username, outcomeIndex, redeemShares, payout, automatic ? 'tournament_auto_claim' : 'web']);
  await client.query(`
    INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
    VALUES ($1, $2, 'redemption', $3, $4)
  `, [username, payout, marketId,
    `Cobro de ${redeemShares.toFixed(2)} acciones ganadoras${automatic ? ' al cierre del torneo' : ''}`]);
  return { balance: Number(balanceResult.rows[0].balance), payout, shares: redeemShares };
}

export async function collectCyclePositionWinnings(client, window) {
  const rows = (await client.query(`
    SELECT p.market_id, p.username, p.outcome_index
    FROM points_positions p JOIN points_markets m ON m.id = p.market_id
    WHERE COALESCE(m.mode, 'points') = 'points' AND m.status = 'resolved' AND m.outcome = p.outcome_index AND p.shares > $3
      AND EXISTS (SELECT 1 FROM points_trades t
        WHERE LOWER(t.username) = LOWER(p.username) AND t.market_id = p.market_id
          AND t.outcome_index = p.outcome_index AND t.side = 'buy'
          AND t.created_at >= $1::timestamptz AND t.created_at <= $2::timestamptz)
    ORDER BY p.market_id, p.username, p.outcome_index
  `, [scoringStartIsoForWindow(window), window.rankingCutoffAt, SHARE_EPSILON])).rows;
  let payout = 0;
  let collected = 0;
  for (const row of rows) {
    try {
      const result = await redeemWinningPosition(client, {
        username: row.username, marketId: Number(row.market_id), outcomeIndex: Number(row.outcome_index),
        window, automatic: true,
      });
      payout += result.payout;
      collected += 1;
    } catch (error) {
      if (!['no_shares_to_redeem', 'position_outside_current_cycle', 'market_not_resolved', 'losing_outcome'].includes(error.message)) throw error;
    }
  }
  return { collected, payout };
}
