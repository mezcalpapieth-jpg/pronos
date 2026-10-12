import {
  TOURNAMENT_STARTING_BALANCE,
  roundTournamentAmount,
} from './points-tournament-config.js';

async function queryRows(db, text, params = []) {
  const result = await db.query(text, params);
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.rows) ? result.rows : [];
}

export function rankWalletLeaderboardRows(rows = [], { startingBalance = TOURNAMENT_STARTING_BALANCE } = {}) {
  const ranked = (Array.isArray(rows) ? rows : [])
    .filter(row => String(row?.username || '').trim())
    .map(row => {
      const balance = roundTournamentAmount(row.balance);
      const stockPositionValue = roundTournamentAmount(row.stock_position_value ?? row.stockPositionValue ?? 0);
      const walletEquity = roundTournamentAmount(balance + stockPositionValue);
      return {
        username: String(row.username).trim(),
        createdAt: row.created_at || row.createdAt || null,
        balance,
        stockPositionValue,
        walletEquity,
        score: walletEquity,
        cycleDelta: roundTournamentAmount(walletEquity - startingBalance),
      };
    });

  ranked.sort((a, b) => {
    const balanceDiff = b.walletEquity - a.walletEquity;
    if (balanceDiff !== 0) return balanceDiff;
    return String(a.username).localeCompare(String(b.username));
  });

  ranked.forEach((row, index) => {
    row.rank = index + 1;
  });

  return ranked;
}

export async function buildWalletLeaderboardRows(db, { limit = 5000, stockCycleId = null } = {}) {
  // Read cash and holdings in the same SQL snapshot. A concurrent stock fill
  // cannot temporarily make the wallet rank lose both its cash and its shares.
  const rows = await queryRows(db, `
    SELECT b.username, COALESCE(b.balance, 0) AS balance, u.created_at
      ${stockCycleId ? ',COALESCE(s.value,0) AS stock_position_value' : ''}
    FROM points_balances b
    LEFT JOIN points_users u ON LOWER(u.username) = LOWER(b.username)
    ${stockCycleId ? `LEFT JOIN (
      SELECT p.username,SUM(CASE WHEN p.quantity=0 THEN 0
        WHEN m.price_usd IS NOT NULL THEN TRUNC(p.quantity*m.price_usd*m.fx_rate,6)
        ELSE p.current_value END) AS value
      FROM points_stock_positions p LEFT JOIN points_stock_cycle_marks m
        ON m.cycle_id=p.cycle_id AND m.ticker=p.ticker
      WHERE p.cycle_id=$2 GROUP BY p.username
    ) s ON s.username=b.username` : ''}
    WHERE b.username IS NOT NULL
    ORDER BY ${stockCycleId ? 'COALESCE(b.balance,0)+COALESCE(s.value,0)' : 'b.balance'} DESC, LOWER(b.username) ASC
    LIMIT $1
  `, [Math.max(1, Number(limit) || 5000), ...(stockCycleId ? [stockCycleId] : [])]);

  return rankWalletLeaderboardRows(rows);
}
