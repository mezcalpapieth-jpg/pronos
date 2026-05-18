function roundMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function cleanUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUser(row = {}) {
  const walletBalance = roundMoney(row.walletBalance ?? row.wallet_balance);
  const openPositionValue = roundMoney(row.openPositionValue ?? row.open_position_value);
  const totalWon = roundMoney(row.totalWon ?? row.total_won);
  const biggestWin = roundMoney(row.biggestWin ?? row.biggest_win);
  return {
    username: cleanUsername(row.username),
    walletAddress: row.walletAddress || row.wallet_address || null,
    joinedAt: row.joinedAt || row.created_at || row.joined_at || null,
    walletBalance,
    openPositionValue,
    portfolioValue: roundMoney(walletBalance + openPositionValue),
    totalWon,
    biggestWin,
    biggestWinMarketId: row.biggestWinMarketId ?? row.biggest_win_market_id ?? null,
    biggestWinQuestion: row.biggestWinQuestion || row.biggest_win_question || null,
  };
}

function byMetric(metric) {
  return (a, b) => {
    const diff = Number(b[metric] || 0) - Number(a[metric] || 0);
    if (Math.abs(diff) > 1e-9) return diff;
    return String(a.username).localeCompare(String(b.username));
  };
}

function ranked(rows, metric, limit) {
  return rows
    .slice()
    .sort(byMetric(metric))
    .slice(0, limit)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      rankBy: metric,
    }));
}

export function buildProtocolLeaderboardPayload({
  users = [],
  query = '',
  limit = 10,
} = {}) {
  const q = cleanUsername(query);
  const normalized = (Array.isArray(users) ? users : [])
    .map(normalizeUser)
    .filter(user => user.username);
  const filtered = q
    ? normalized.filter(user => user.username.includes(q))
    : normalized;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));

  return {
    query: q,
    limit: safeLimit,
    totalParticipants: filtered.length,
    portfolio: ranked(filtered, 'portfolioValue', safeLimit),
    totalWon: ranked(filtered, 'totalWon', safeLimit),
    biggestWin: ranked(filtered, 'biggestWin', safeLimit),
  };
}

export function buildProtocolUserProfilePayload({
  user = {},
  metrics = {},
  active = [],
  history = [],
} = {}) {
  const normalized = normalizeUser({
    username: user.username,
    walletAddress: user.walletAddress || user.wallet_address,
    joinedAt: user.joinedAt || user.created_at,
    ...metrics,
  });
  return {
    user: {
      username: normalized.username,
      joinedAt: normalized.joinedAt,
    },
    stats: {
      walletBalance: normalized.walletBalance,
      openPositionValue: normalized.openPositionValue,
      portfolioValue: normalized.portfolioValue,
      totalWon: normalized.totalWon,
      biggestWin: normalized.biggestWin,
      biggestWinMarketId: normalized.biggestWinMarketId,
      biggestWinQuestion: normalized.biggestWinQuestion,
      activePositions: Array.isArray(active) ? active.length : 0,
      historyItems: Array.isArray(history) ? history.length : 0,
    },
    active: Array.isArray(active) ? active : [],
    history: Array.isArray(history) ? history : [],
  };
}
