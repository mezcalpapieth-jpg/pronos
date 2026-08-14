function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function displayQuestionFor(row) {
  if (row.parent_question) {
    return `${row.parent_question}${row.leg_label ? ` — ${row.leg_label}` : ''}`;
  }
  return row.question;
}

function parseOutcomes(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return ['Sí', 'No'];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : ['Sí', 'No'];
  } catch {
    return ['Sí', 'No'];
  }
}

function labelFor(outcomes, i) {
  if (!Array.isArray(outcomes)) return '—';
  const index = Number(i);
  return outcomes[index] || `Opción ${index + 1}`;
}

function hasPositiveValue(map) {
  for (const value of map.values()) {
    if (Number(value) > 0.000001) return true;
  }
  return false;
}

function currentHeldByOutcome(market) {
  const held = new Map();
  for (const [outcomeIndex, shares] of market.heldByOutcome.entries()) {
    const redeemed = market.redeemedByOutcome.get(outcomeIndex) || 0;
    held.set(outcomeIndex, Math.max(0, shares - redeemed));
  }
  return held;
}

function timeMs(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function addPickedOutcome(market, outcomeIndex, { collateral = 0, shares = 0 } = {}) {
  const label = String(labelFor(market.outcomes, outcomeIndex) || '').trim();
  if (!label || label === '—') return;
  const key = Number.isInteger(Number(outcomeIndex)) ? String(outcomeIndex) : label.toLowerCase();
  const current = market.pickedByOutcome.get(key) || { label, collateral: 0, shares: 0 };
  current.collateral += Number(collateral || 0);
  current.shares += Number(shares || 0);
  market.pickedByOutcome.set(key, current);
}

function pickedOutcomeSummary(market) {
  const labels = Array.from(market.pickedByOutcome.values())
    .sort((a, b) => (b.collateral - a.collateral) || (b.shares - a.shares))
    .map(item => item.label);

  return {
    pickedOutcomeLabels: labels,
    pickedOutcomeLabel: labels.join(', '),
  };
}

function statusAndRedeemValue(market, nowMs) {
  const currentHeld = currentHeldByOutcome(market);
  const stillHeld = hasPositiveValue(currentHeld);

  if (market.status === 'canceled' || market.status === 'cancelled') {
    return { outcomeStatus: 'canceled', redeemValue: 0 };
  }

  if (market.status === 'resolved') {
    const winningIdx = Number(market.marketOutcome);
    const winningGross = market.heldByOutcome.get(winningIdx) || 0;
    const anyGross = hasPositiveValue(market.heldByOutcome);
    const unredeemedWinning = currentHeld.get(winningIdx) || 0;
    return {
      outcomeStatus: winningGross > 0.000001 ? 'won' : anyGross ? 'lost' : 'exited',
      redeemValue: unredeemedWinning,
    };
  }

  if (!stillHeld) {
    return { outcomeStatus: 'exited', redeemValue: 0 };
  }

  const endMs = market.endTime ? new Date(market.endTime).getTime() : null;
  if (endMs && endMs <= nowMs) {
    return { outcomeStatus: 'pending', redeemValue: 0 };
  }

  return { outcomeStatus: 'open', redeemValue: 0 };
}

export function buildPublicProfileHistory(tradeRows, { nowMs = Date.now() } = {}) {
  const byMarket = new Map();
  for (const row of tradeRows || []) {
    const marketId = row.market_id;
    if (!byMarket.has(marketId)) {
      byMarket.set(marketId, {
        marketId,
        question: displayQuestionFor(row),
        category: row.category,
        status: row.status,
        marketOutcome: row.m_outcome,
        outcomes: parseOutcomes(row.outcomes),
        endTime: row.end_time,
        resolvedAt: row.resolved_at,
        lastTradeAt: null,
        finalScore: row.final_score,
        buyCollateral: 0,
        buyFees: 0,
        sellProceeds: 0,
        sellFees: 0,
        redeemProceeds: 0,
        redeemFees: 0,
        refundProceeds: 0,
        heldByOutcome: new Map(),
        redeemedByOutcome: new Map(),
        pickedByOutcome: new Map(),
      });
    }

    const market = byMarket.get(marketId);
    const outcomeIndex = Number(row.outcome_index);
    const shares = Number(row.shares || 0);
    const collateral = Number(row.collateral || 0);
    const fee = Number(row.fee || 0);
    if (timeMs(row.created_at) > timeMs(market.lastTradeAt)) {
      market.lastTradeAt = row.created_at;
    }

    if (row.side === 'buy') {
      market.buyCollateral += collateral;
      market.buyFees += fee;
      addPickedOutcome(market, outcomeIndex, { collateral, shares });
      market.heldByOutcome.set(
        outcomeIndex,
        (market.heldByOutcome.get(outcomeIndex) || 0) + shares,
      );
    } else if (row.side === 'sell') {
      market.sellProceeds += collateral;
      market.sellFees += fee;
      market.heldByOutcome.set(
        outcomeIndex,
        Math.max(0, (market.heldByOutcome.get(outcomeIndex) || 0) - shares),
      );
    } else if (row.side === 'redeem') {
      market.redeemProceeds += collateral;
      market.redeemFees += fee;
      market.redeemedByOutcome.set(
        outcomeIndex,
        (market.redeemedByOutcome.get(outcomeIndex) || 0) + shares,
      );
    } else if (row.side === 'refund') {
      market.refundProceeds += collateral;
    }
  }

  const history = Array.from(byMarket.values()).map((market) => {
    const { outcomeStatus, redeemValue } = statusAndRedeemValue(market, nowMs);
    const fees = market.buyFees + market.sellFees + market.redeemFees;
    const totalReceived = market.sellProceeds + market.redeemProceeds + market.refundProceeds + redeemValue;
    const netPnl = totalReceived - market.buyCollateral - fees;

    return {
      marketId: market.marketId,
      question: market.question,
      category: market.category,
      outcomeStatus,
      netPnl: round2(netPnl),
      buyCollateral: round2(market.buyCollateral),
      sellProceeds: round2(market.sellProceeds),
      refundProceeds: round2(market.refundProceeds),
      resolvedAt: market.resolvedAt,
      lastTradeAt: market.lastTradeAt,
      finalScore: market.finalScore,
      ...pickedOutcomeSummary(market),
    };
  });

  history.sort((a, b) => {
    const ar = timeMs(a.lastTradeAt) || timeMs(a.resolvedAt);
    const br = timeMs(b.lastTradeAt) || timeMs(b.resolvedAt);
    return br - ar;
  });

  return history;
}

export function buildPublicProfileStats(history) {
  const totalPnl = (history || []).reduce((sum, market) => sum + Number(market.netPnl || 0), 0);
  const totalVolume = (history || []).reduce((sum, market) => sum + Number(market.buyCollateral || 0), 0);
  const won = (history || []).filter((market) => market.outcomeStatus === 'won').length;
  const lost = (history || []).filter((market) => market.outcomeStatus === 'lost').length;
  const open = (history || []).filter((market) => market.outcomeStatus === 'open').length;
  const settled = won + lost;

  return {
    totalPnl: round2(totalPnl),
    totalVolume: round2(totalVolume),
    marketsTraded: (history || []).length,
    marketsWon: won,
    marketsLost: lost,
    marketsOpen: open,
    winRate: settled > 0 ? round2((won / settled) * 100) : null,
  };
}
