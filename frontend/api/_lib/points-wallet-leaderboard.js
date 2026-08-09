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
      return {
        username: String(row.username).trim(),
        createdAt: row.created_at || row.createdAt || null,
        balance,
        score: balance,
        cycleDelta: roundTournamentAmount(balance - startingBalance),
      };
    });

  ranked.sort((a, b) => {
    const balanceDiff = b.balance - a.balance;
    if (balanceDiff !== 0) return balanceDiff;
    return String(a.username).localeCompare(String(b.username));
  });

  ranked.forEach((row, index) => {
    row.rank = index + 1;
  });

  return ranked;
}

export async function buildWalletLeaderboardRows(db, { limit = 5000 } = {}) {
  const rows = await queryRows(db, `
    SELECT b.username, COALESCE(b.balance, 0) AS balance, u.created_at
    FROM points_balances b
    LEFT JOIN points_users u ON LOWER(u.username) = LOWER(b.username)
    WHERE b.username IS NOT NULL
    ORDER BY b.balance DESC, LOWER(b.username) ASC
    LIMIT $1
  `, [Math.max(1, Number(limit) || 5000)]);

  return rankWalletLeaderboardRows(rows);
}
