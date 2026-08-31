import { binaryPrices, multiPrices } from './amm-math.js';
import {
  TOURNAMENT_PARLAY_EDGE_FACTOR,
  TOURNAMENT_PARLAY_MAX_LEGS,
  TOURNAMENT_PARLAY_MAX_MULTIPLIER,
  TOURNAMENT_PARLAY_MAX_PAYOUT_MXNP,
  TOURNAMENT_PARLAY_MIN_LEGS,
  TOURNAMENT_PARLAY_MIN_STAKE_MXNP,
  TOURNAMENT_PARLAY_PRICE_CEILING,
  TOURNAMENT_PARLAY_PRICE_FLOOR,
  roundTournamentAmount,
  tournamentRulesPayload,
} from './points-tournament-config.js';
import { resolveTournamentScoringWindow } from './points-tournament-leaderboard.js';

const PARLAY_MIN_MULTIPLIER = 1.01;

async function queryRows(db, text, params = []) {
  const result = await db.query(text, params);
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.rows) ? result.rows : [];
}

function apiError(message, status = 400, detail = undefined) {
  const error = new Error(message);
  error.status = status;
  if (detail !== undefined) error.detail = detail;
  return error;
}

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function round6(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1_000_000) / 1_000_000 : 0;
}

function roundMultiplier(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : PARLAY_MIN_MULTIPLIER;
}

function clampPrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return TOURNAMENT_PARLAY_PRICE_FLOOR;
  return Math.min(TOURNAMENT_PARLAY_PRICE_CEILING, Math.max(TOURNAMENT_PARLAY_PRICE_FLOOR, n));
}

function marketPriceVector(market) {
  const reserves = parseJson(market.reserves, []);
  if (!Array.isArray(reserves) || reserves.length < 2) return [];
  return reserves.length === 2 ? binaryPrices(reserves) : multiPrices(reserves);
}

function normalizeStake(stake) {
  const amount = Number(stake);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw apiError('invalid_stake', 400);
  }
  if (amount < TOURNAMENT_PARLAY_MIN_STAKE_MXNP) {
    throw apiError('stake_too_low', 400, { minStakeMxnp: TOURNAMENT_PARLAY_MIN_STAKE_MXNP });
  }
  return round6(amount);
}

export function normalizeParlayLegs(input) {
  if (!Array.isArray(input)) {
    throw apiError('invalid_legs', 400);
  }
  if (input.length < TOURNAMENT_PARLAY_MIN_LEGS) {
    throw apiError('not_enough_legs', 400, { minLegs: TOURNAMENT_PARLAY_MIN_LEGS });
  }
  if (input.length > TOURNAMENT_PARLAY_MAX_LEGS) {
    throw apiError('too_many_legs', 400, { maxLegs: TOURNAMENT_PARLAY_MAX_LEGS });
  }

  const seenMarkets = new Set();
  return input.map((leg) => {
    const marketId = Number.parseInt(leg?.marketId ?? leg?.market_id, 10);
    const outcomeIndex = Number.parseInt(leg?.outcomeIndex ?? leg?.outcome_index, 10);
    if (!Number.isInteger(marketId) || marketId <= 0) {
      throw apiError('invalid_market_id', 400);
    }
    if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0) {
      throw apiError('invalid_outcome_index', 400);
    }
    if (seenMarkets.has(marketId)) {
      throw apiError('duplicate_market', 400, { marketId });
    }
    seenMarkets.add(marketId);
    return { marketId, outcomeIndex };
  });
}

export function calculateParlayMultiplier(prices) {
  if (!Array.isArray(prices) || prices.length < TOURNAMENT_PARLAY_MIN_LEGS) {
    throw apiError('invalid_prices', 400);
  }
  const probability = prices.reduce((product, price) => product * clampPrice(price), 1);
  if (!Number.isFinite(probability) || probability <= 0) {
    throw apiError('invalid_prices', 400);
  }
  const fairMultiplier = 1 / probability;
  const discounted = fairMultiplier * TOURNAMENT_PARLAY_EDGE_FACTOR;
  const multiplier = Math.min(
    TOURNAMENT_PARLAY_MAX_MULTIPLIER,
    Math.max(PARLAY_MIN_MULTIPLIER, discounted),
  );
  return {
    probability,
    fairMultiplier: roundMultiplier(fairMultiplier),
    multiplier: roundMultiplier(multiplier),
  };
}

async function readParlayMarkets(db, marketIds, { lock = false } = {}) {
  const lockClause = lock ? 'FOR SHARE OF m' : '';
  return queryRows(db, `
    SELECT m.id, m.question, m.status, m.outcome, m.outcomes, m.reserves,
           m.end_time, m.parent_id,
           COALESCE(m.parent_id, m.id) AS exposure_group_id,
           COALESCE(m.tournament_featured, p.tournament_featured, false) AS tournament_featured
    FROM points_markets m
    LEFT JOIN points_markets p ON p.id = m.parent_id
    WHERE m.id = ANY($1::int[])
    ORDER BY m.id ASC
    ${lockClause}
  `, [marketIds]);
}

function activeScoringWindow(scoringWindow, now) {
  if (!scoringWindow?.id) return null;
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const startsAtMs = new Date(scoringWindow.startsAt).getTime();
  const cutoffMs = new Date(scoringWindow.rankingCutoffAt).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(startsAtMs) || !Number.isFinite(cutoffMs)) return null;
  return nowMs >= startsAtMs && nowMs < cutoffMs ? scoringWindow : null;
}

export async function readParlayQuote(db, { legs, stake, now = new Date(), lockMarkets = false } = {}) {
  const normalizedLegs = normalizeParlayLegs(legs);
  const stakeAmount = normalizeStake(stake);
  const scoringWindow = activeScoringWindow(
    await resolveTournamentScoringWindow(db, { now }),
    now,
  );

  const marketIds = [...new Set(normalizedLegs.map(leg => leg.marketId))].sort((a, b) => a - b);
  const markets = await readParlayMarkets(db, marketIds, { lock: lockMarkets });
  const marketById = new Map(markets.map(market => [Number(market.id), market]));
  const seenGroups = new Set();
  const cutoffMs = scoringWindow ? new Date(scoringWindow.rankingCutoffAt).getTime() : NaN;
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();

  const pricedLegs = normalizedLegs.map((leg) => {
    const market = marketById.get(leg.marketId);
    if (!market) throw apiError('market_not_found', 404, { marketId: leg.marketId });
    if (market.status !== 'active') throw apiError('market_not_active', 400, { marketId: leg.marketId });

    const groupId = Number(market.exposure_group_id || market.id);
    if (seenGroups.has(groupId)) {
      throw apiError('correlated_legs_not_allowed', 400, { marketId: leg.marketId });
    }
    seenGroups.add(groupId);

    const endMs = new Date(market.end_time).getTime();
    if (Number.isFinite(endMs) && endMs <= nowMs) {
      throw apiError('market_expired', 400, { marketId: leg.marketId });
    }
    if (scoringWindow && Number.isFinite(endMs) && Number.isFinite(cutoffMs) && endMs > cutoffMs) {
      throw apiError('market_after_tournament_cutoff', 400, { marketId: leg.marketId });
    }

    const outcomes = parseJson(market.outcomes, []);
    if (!Array.isArray(outcomes) || leg.outcomeIndex >= outcomes.length) {
      throw apiError('invalid_outcome_index', 400, { marketId: leg.marketId });
    }
    const prices = marketPriceVector(market);
    const price = Number(prices[leg.outcomeIndex]);
    if (!Number.isFinite(price) || price <= 0) {
      throw apiError('invalid_leg_price', 400, { marketId: leg.marketId });
    }

    return {
      marketId: leg.marketId,
      outcomeIndex: leg.outcomeIndex,
      question: market.question,
      outcomeLabel: String(outcomes[leg.outcomeIndex] ?? `Outcome ${leg.outcomeIndex + 1}`),
      price: round6(price),
      parlayPrice: round6(clampPrice(price)),
      marketEndTime: market.end_time,
    };
  });

  const math = calculateParlayMultiplier(pricedLegs.map(leg => leg.price));
  const potentialPayout = round6(stakeAmount * math.multiplier);
  if (potentialPayout > TOURNAMENT_PARLAY_MAX_PAYOUT_MXNP) {
    throw apiError('payout_too_high', 400, {
      maxPayoutMxnp: TOURNAMENT_PARLAY_MAX_PAYOUT_MXNP,
      maxStakeMxnp: round6(TOURNAMENT_PARLAY_MAX_PAYOUT_MXNP / math.multiplier),
      multiplier: math.multiplier,
    });
  }
  return {
    ok: true,
    cycleId: scoringWindow?.id || null,
    stake: stakeAmount,
    multiplier: math.multiplier,
    fairMultiplier: math.fairMultiplier,
    edgeFactor: TOURNAMENT_PARLAY_EDGE_FACTOR,
    impliedProbability: round6(math.probability),
    potentialPayout,
    potentialProfit: round6(potentialPayout - stakeAmount),
    legs: pricedLegs,
    rules: tournamentRulesPayload().parlay,
  };
}

export function serializeParlayTicket(row) {
  const legs = parseJson(row.legs, []);
  const legStatuses = legs.map(leg => String(leg.status || 'open').toLowerCase());
  const legCount = legs.length;
  const wonLegs = legStatuses.filter(status => status === 'won').length;
  const lostLegs = legStatuses.filter(status => status === 'lost').length;
  const voidLegs = legStatuses.filter(status => status === 'void').length;
  return {
    id: Number(row.id),
    username: row.username,
    cycleId: row.cycle_id == null ? null : Number(row.cycle_id),
    stake: roundTournamentAmount(row.stake),
    multiplier: roundMultiplier(row.multiplier),
    potentialPayout: roundTournamentAmount(row.potential_payout),
    potentialProfit: roundTournamentAmount(Number(row.potential_payout || 0) - Number(row.stake || 0)),
    payout: roundTournamentAmount(row.payout || 0),
    status: row.status,
    submittedAt: row.submitted_at || null,
    settledAt: row.settled_at || null,
    reason: row.reason || null,
    legCount,
    wonLegs,
    lostLegs,
    voidLegs,
    legs: legs.map(leg => ({
      id: leg.id == null ? null : Number(leg.id),
      marketId: Number(leg.marketId ?? leg.market_id),
      outcomeIndex: Number(leg.outcomeIndex ?? leg.outcome_index),
      price: round6(leg.price ?? leg.price_snapshot),
      question: leg.question ?? leg.question_snapshot ?? null,
      outcomeLabel: leg.outcomeLabel ?? leg.outcome_label_snapshot ?? null,
      marketEndTime: leg.marketEndTime ?? leg.market_end_time ?? null,
      resolvedOutcome: leg.resolvedOutcome ?? leg.resolved_outcome ?? null,
      resolvedOutcomeLabel: leg.resolvedOutcomeLabel ?? leg.resolved_outcome_label ?? null,
      status: leg.status || 'open',
      settledAt: leg.settledAt ?? leg.settled_at ?? null,
    })),
  };
}

export async function createParlayTicket(client, { username, legs, stake, now = new Date() } = {}) {
  if (!username) throw apiError('username_required', 400);
  const quote = await readParlayQuote(client, { legs, stake, now, lockMarkets: true });

  const balanceRows = await queryRows(client, `
    SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE
  `, [username]);
  const currentBalance = Number(balanceRows[0]?.balance || 0);
  if (currentBalance < quote.stake) {
    throw apiError('insufficient_balance', 400, { balance: roundTournamentAmount(currentBalance) });
  }

  const ticketRows = await queryRows(client, `
    INSERT INTO points_parlay_tickets (
      username, cycle_id, stake, multiplier, potential_payout, status, submitted_at
    )
    VALUES ($1, $2, $3, $4, $5, 'open', NOW())
    RETURNING id, username, cycle_id, stake, multiplier, potential_payout,
              payout, status, submitted_at, settled_at, reason
  `, [username, quote.cycleId, quote.stake, quote.multiplier, quote.potentialPayout]);
  const ticket = ticketRows[0];

  for (const leg of quote.legs) {
    await client.query(
      `INSERT INTO points_parlay_legs (
         ticket_id, market_id, outcome_index, price_snapshot,
         question_snapshot, outcome_label_snapshot, market_end_time
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        ticket.id,
        leg.marketId,
        leg.outcomeIndex,
        leg.price,
        leg.question,
        leg.outcomeLabel,
        leg.marketEndTime,
      ],
    );
  }

  const newBalance = currentBalance - quote.stake;
  await client.query(
    `UPDATE points_balances SET balance = $1, updated_at = NOW() WHERE username = $2`,
    [newBalance, username],
  );
  await client.query(
    `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
     VALUES ($1, $2, 'parlay_entry', $3, $4)`,
    [
      username,
      -quote.stake,
      ticket.id,
      `Combinada de ${quote.legs.length} mercados @ ${quote.multiplier.toFixed(2)}x`,
    ],
  );

  return {
    ok: true,
    balance: roundTournamentAmount(newBalance),
    quote,
    ticket: serializeParlayTicket({
      ...ticket,
      legs: quote.legs.map((leg, index) => ({
        id: index + 1,
        marketId: leg.marketId,
        outcomeIndex: leg.outcomeIndex,
        price: leg.price,
        question: leg.question,
        outcomeLabel: leg.outcomeLabel,
        marketEndTime: leg.marketEndTime,
        status: 'open',
      })),
    }),
  };
}

export async function listParlayTicketsForUser(db, { username, limit = 20 } = {}) {
  if (!username) throw apiError('username_required', 400);
  const max = Math.min(100, Math.max(1, Number(limit) || 20));
  const rows = await queryRows(db, `
    SELECT t.id, t.username, t.cycle_id, t.stake, t.multiplier,
           t.potential_payout, t.payout, t.status, t.submitted_at,
           t.settled_at, t.reason,
           COALESCE(
             JSON_AGG(
               JSON_BUILD_OBJECT(
                 'id', l.id,
                 'marketId', l.market_id,
                 'outcomeIndex', l.outcome_index,
                 'price', l.price_snapshot,
                 'question', l.question_snapshot,
                 'outcomeLabel', l.outcome_label_snapshot,
                 'marketEndTime', l.market_end_time,
                 'resolvedOutcome', l.resolved_outcome,
                 'resolvedOutcomeLabel',
                   CASE
                     WHEN l.resolved_outcome IS NULL THEN NULL
                     ELSE m.outcomes ->> (l.resolved_outcome::int)
                   END,
                 'status', l.status,
                 'settledAt', l.settled_at
               )
               ORDER BY l.id ASC
             ) FILTER (WHERE l.id IS NOT NULL),
             '[]'::json
           ) AS legs
    FROM points_parlay_tickets t
    LEFT JOIN points_parlay_legs l ON l.ticket_id = t.id
    LEFT JOIN points_markets m ON m.id = l.market_id
    WHERE t.username = $1
    GROUP BY t.id
    ORDER BY t.submitted_at DESC
    LIMIT $2
  `, [username, max]);
  return rows.map(serializeParlayTicket);
}

function normalizeLegOutcomeStatus(leg) {
  const marketStatus = String(leg.market_status || '').toLowerCase();
  const resolvedOutcome = leg.market_outcome == null ? null : Number(leg.market_outcome);
  if (marketStatus === 'canceled' || marketStatus === 'cancelled') {
    return { status: 'void', resolvedOutcome: null };
  }
  if (marketStatus !== 'resolved') {
    return { status: 'open', resolvedOutcome: null };
  }
  if (!Number.isInteger(resolvedOutcome) || resolvedOutcome < 0) {
    return { status: 'void', resolvedOutcome: null };
  }
  return {
    status: resolvedOutcome === Number(leg.outcome_index) ? 'won' : 'lost',
    resolvedOutcome,
  };
}

async function settleTicket(client, ticket) {
  const legs = await queryRows(client, `
    SELECT l.id, l.ticket_id, l.outcome_index, l.status AS leg_status,
           l.resolved_outcome,
           m.status AS market_status, m.outcome AS market_outcome
    FROM points_parlay_legs l
    JOIN points_markets m ON m.id = l.market_id
    WHERE l.ticket_id = $1
    ORDER BY l.id ASC
  `, [ticket.id]);

  const statuses = legs.map(normalizeLegOutcomeStatus);
  const hasLost = statuses.some(status => status.status === 'lost');
  const hasVoid = statuses.some(status => status.status === 'void');
  const allWon = statuses.length > 0 && statuses.every(status => status.status === 'won');

  let finalStatus = null;
  let payout = 0;
  let reason = null;
  if (hasLost) {
    finalStatus = 'lost';
    reason = 'one_or_more_legs_lost';
  } else if (hasVoid) {
    finalStatus = 'void';
    payout = Number(ticket.stake || 0);
    reason = 'one_or_more_legs_void';
  } else if (allWon) {
    finalStatus = 'won';
    payout = Number(ticket.potential_payout || 0);
    reason = 'all_legs_won';
  }

  let progressed = 0;
  for (let index = 0; index < legs.length; index += 1) {
    const status = statuses[index];
    if (status.status === 'open') continue;
    const updateResult = await client.query(
      `UPDATE points_parlay_legs
       SET status = $1,
           resolved_outcome = $2,
           settled_at = COALESCE(settled_at, NOW())
       WHERE id = $3
         AND (
           status IS DISTINCT FROM $1
           OR resolved_outcome IS DISTINCT FROM $2
           OR settled_at IS NULL
         )`,
      [status.status, status.resolvedOutcome, legs[index].id],
    );
    progressed += Number(updateResult?.rowCount || 0);
  }

  if (!finalStatus) return { settled: false, progressed };

  const ticketUpdate = await client.query(
    `UPDATE points_parlay_tickets
     SET status = $1, payout = $2, settled_at = NOW(), reason = $3
     WHERE id = $4 AND status = 'open'`,
    [finalStatus, payout, reason, ticket.id],
  );
  const ticketSettled = Number(ticketUpdate?.rowCount || 0) > 0;

  if (ticketSettled && payout > 0) {
    await client.query(
      `INSERT INTO points_balances (username, balance, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (username) DO UPDATE
       SET balance = points_balances.balance + EXCLUDED.balance,
           updated_at = NOW()`,
      [ticket.username, payout],
    );
    await client.query(
      `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        ticket.username,
        payout,
        finalStatus === 'won' ? 'parlay_payout' : 'parlay_refund',
        ticket.id,
        finalStatus === 'won'
          ? `Combinada ganada @ ${Number(ticket.multiplier || 0).toFixed(2)}x`
          : 'Combinada reembolsada por mercado anulado',
      ],
    );
  }

  return { settled: ticketSettled, status: finalStatus, payout, progressed };
}

export async function settleOpenParlayTickets(client, { limit = 200, username = null } = {}) {
  const max = Math.min(500, Math.max(1, Number(limit) || 200));
  const params = [max];
  let userFilter = '';
  if (username) {
    params.push(username);
    userFilter = `AND username = $${params.length}`;
  }
  const tickets = await queryRows(client, `
    SELECT id, username, stake, multiplier, potential_payout
    FROM points_parlay_tickets
    WHERE status = 'open'
      ${userFilter}
    ORDER BY submitted_at ASC
    LIMIT $1
    FOR UPDATE SKIP LOCKED
  `, params);

  const counts = { checked: tickets.length, progressed: 0, settled: 0, won: 0, lost: 0, void: 0, payout: 0 };
  for (const ticket of tickets) {
    const result = await settleTicket(client, ticket);
    counts.progressed += Number(result.progressed || 0);
    if (!result.settled) continue;
    counts.settled += 1;
    counts[result.status] += 1;
    counts.payout = round6(counts.payout + Number(result.payout || 0));
  }
  return counts;
}
