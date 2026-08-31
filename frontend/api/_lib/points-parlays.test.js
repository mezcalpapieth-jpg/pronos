import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  calculateParlayMultiplier,
  normalizeParlayLegs,
  readParlayQuote,
  settleOpenParlayTickets,
} from './points-parlays.js';

const parlayRouteSource = await readFile(new URL('../points/parlays/index.js', import.meta.url), 'utf8');

function makeMarket(id, overrides = {}) {
  return {
    id,
    question: `Market ${id}`,
    status: 'active',
    outcome: null,
    outcomes: JSON.stringify(['Sí', 'No']),
    reserves: JSON.stringify([100, 100]),
    end_time: '2026-09-10T00:00:00.000Z',
    parent_id: null,
    exposure_group_id: id,
    tournament_featured: false,
    ...overrides,
  };
}

function fakeDb({ cycleRows = [], markets = [] } = {}) {
  return {
    async query(text, params = []) {
      const sql = String(text);
      if (sql.includes('FROM points_cycles')) {
        return { rows: cycleRows };
      }
      if (sql.includes('FROM points_markets m')) {
        const ids = new Set((params[0] || []).map(Number));
        return { rows: markets.filter(market => ids.has(Number(market.id))) };
      }
      throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
    },
  };
}

function fakeSettlementDb({ tickets = [], legs = [], markets = [] } = {}) {
  const ticketRows = tickets.map(ticket => ({ ...ticket }));
  const legRows = legs.map(leg => ({ ...leg }));
  const marketById = new Map(markets.map(market => [Number(market.id), { ...market }]));
  const balanceCredits = [];
  const distributions = [];

  const db = {
    tickets: ticketRows,
    legs: legRows,
    balanceCredits,
    distributions,
    async query(text, params = []) {
      const sql = String(text);
      if (sql.includes('FROM points_parlay_tickets')) {
        const max = Number(params[0]) || 200;
        const username = params[1] || null;
        const rows = ticketRows
          .filter(ticket => ticket.status === 'open')
          .filter(ticket => !username || ticket.username === username)
          .slice(0, max)
          .map(ticket => ({
            id: ticket.id,
            username: ticket.username,
            stake: ticket.stake,
            multiplier: ticket.multiplier,
            potential_payout: ticket.potential_payout,
          }));
        return { rows, rowCount: rows.length };
      }
      if (sql.includes('FROM points_parlay_legs l')) {
        const ticketId = Number(params[0]);
        return {
          rows: legRows
            .filter(leg => Number(leg.ticket_id) === ticketId)
            .sort((a, b) => Number(a.id) - Number(b.id))
            .map((leg) => {
              const market = marketById.get(Number(leg.market_id)) || {};
              return {
                id: leg.id,
                ticket_id: leg.ticket_id,
                outcome_index: leg.outcome_index,
                leg_status: leg.status,
                resolved_outcome: leg.resolved_outcome ?? null,
                market_status: market.status || 'active',
                market_outcome: market.outcome ?? null,
              };
            }),
        };
      }
      if (sql.includes('UPDATE points_parlay_legs')) {
        const [status, resolvedOutcome, id] = params;
        const leg = legRows.find(item => Number(item.id) === Number(id));
        if (!leg) return { rows: [], rowCount: 0 };
        const changed = leg.status !== status
          || Number(leg.resolved_outcome ?? -1) !== Number(resolvedOutcome ?? -1)
          || !leg.settled_at;
        if (!changed) return { rows: [], rowCount: 0 };
        leg.status = status;
        leg.resolved_outcome = resolvedOutcome;
        leg.settled_at = leg.settled_at || '2026-08-31T00:00:00.000Z';
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE points_parlay_tickets')) {
        const [status, payout, reason, id] = params;
        const ticket = ticketRows.find(item => Number(item.id) === Number(id));
        if (!ticket || ticket.status !== 'open') return { rows: [], rowCount: 0 };
        ticket.status = status;
        ticket.payout = payout;
        ticket.reason = reason;
        ticket.settled_at = '2026-08-31T00:00:00.000Z';
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO points_balances')) {
        balanceCredits.push({ username: params[0], payout: params[1] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO points_distributions')) {
        distributions.push({
          username: params[0],
          amount: params[1],
          kind: params[2],
          referenceId: params[3],
          reason: params[4],
        });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
    },
  };

  return db;
}

test('parlay multiplier discounts fair odds with configured factor', () => {
  const quote = calculateParlayMultiplier([0.5, 0.5, 0.5]);
  assert.equal(quote.fairMultiplier, 8);
  assert.equal(quote.multiplier, 6);
});

test('parlay multiplier caps tiny-price combinations', () => {
  const quote = calculateParlayMultiplier([0.01, 0.01, 0.01, 0.01, 0.01, 0.01]);
  assert.equal(quote.multiplier, 25);
});

test('parlay legs must be 3 to 6 distinct markets', () => {
  assert.throws(() => normalizeParlayLegs([{ marketId: 1, outcomeIndex: 0 }]), /not_enough_legs/);
  assert.throws(
    () => normalizeParlayLegs([
      { marketId: 1, outcomeIndex: 0 },
      { marketId: 1, outcomeIndex: 1 },
      { marketId: 2, outcomeIndex: 0 },
    ]),
    /duplicate_market/,
  );
});

test('parlay settlement marks resolved winning legs before the full ticket closes', async () => {
  const db = fakeSettlementDb({
    tickets: [{ id: 1, username: 'ana', stake: 25, multiplier: 4, potential_payout: 100, status: 'open' }],
    legs: [
      { id: 11, ticket_id: 1, market_id: 101, outcome_index: 0, status: 'open' },
      { id: 12, ticket_id: 1, market_id: 102, outcome_index: 0, status: 'open' },
      { id: 13, ticket_id: 1, market_id: 103, outcome_index: 1, status: 'open' },
    ],
    markets: [
      { id: 101, status: 'resolved', outcome: 0 },
      { id: 102, status: 'active', outcome: null },
      { id: 103, status: 'resolved', outcome: 1 },
    ],
  });

  const result = await settleOpenParlayTickets(db, { username: 'ana' });

  assert.equal(result.checked, 1);
  assert.equal(result.progressed, 2);
  assert.equal(result.settled, 0);
  assert.equal(db.tickets[0].status, 'open');
  assert.equal(db.legs.find(leg => leg.id === 11).status, 'won');
  assert.equal(db.legs.find(leg => leg.id === 12).status, 'open');
  assert.equal(db.legs.find(leg => leg.id === 13).status, 'won');
});

test('parlay settlement liquidates the ticket immediately after one wrong leg closes', async () => {
  const db = fakeSettlementDb({
    tickets: [{ id: 2, username: 'ana', stake: 50, multiplier: 5, potential_payout: 250, status: 'open' }],
    legs: [
      { id: 21, ticket_id: 2, market_id: 201, outcome_index: 0, status: 'open' },
      { id: 22, ticket_id: 2, market_id: 202, outcome_index: 1, status: 'open' },
      { id: 23, ticket_id: 2, market_id: 203, outcome_index: 0, status: 'open' },
    ],
    markets: [
      { id: 201, status: 'resolved', outcome: 0 },
      { id: 202, status: 'resolved', outcome: 0 },
      { id: 203, status: 'active', outcome: null },
    ],
  });

  const result = await settleOpenParlayTickets(db, { username: 'ana' });

  assert.equal(result.checked, 1);
  assert.equal(result.progressed, 2);
  assert.equal(result.settled, 1);
  assert.equal(result.lost, 1);
  assert.equal(result.payout, 0);
  assert.equal(db.tickets[0].status, 'lost');
  assert.equal(db.tickets[0].reason, 'one_or_more_legs_lost');
  assert.equal(db.legs.find(leg => leg.id === 21).status, 'won');
  assert.equal(db.legs.find(leg => leg.id === 22).status, 'lost');
  assert.equal(db.legs.find(leg => leg.id === 23).status, 'open');
  assert.equal(db.balanceCredits.length, 0);
  assert.equal(db.distributions.length, 0);
});

test('parlay portfolio endpoint refreshes open tickets before listing them', () => {
  assert.match(parlayRouteSource, /settleOpenParlayTickets/);
  assert.match(parlayRouteSource, /withTransaction\(async \(client\) => \{/);
  assert.match(parlayRouteSource, /return listParlayTicketsForUser\(client/);
});

test('parlay quote accepts active markets when no tournament cycle is active', async () => {
  const quote = await readParlayQuote(fakeDb({
    markets: [makeMarket(1), makeMarket(2), makeMarket(3)],
  }), {
    legs: [
      { marketId: 1, outcomeIndex: 0 },
      { marketId: 2, outcomeIndex: 0 },
      { marketId: 3, outcomeIndex: 0 },
    ],
    stake: 25,
    now: new Date('2026-08-28T12:00:00.000Z'),
  });

  assert.equal(quote.ok, true);
  assert.equal(quote.cycleId, null);
  assert.equal(quote.legs.length, 3);
});

test('parlay quote treats a finished scoring window as general combo mode', async () => {
  const quote = await readParlayQuote(fakeDb({
    cycleRows: [{
      id: 14,
      label: 'Ciclo cerrado',
      started_at: '2026-07-14T00:00:00.000Z',
      ends_at: '2026-07-28T00:00:00.000Z',
    }],
    markets: [makeMarket(11), makeMarket(12), makeMarket(13)],
  }), {
    legs: [
      { marketId: 11, outcomeIndex: 0 },
      { marketId: 12, outcomeIndex: 0 },
      { marketId: 13, outcomeIndex: 0 },
    ],
    stake: 25,
    now: new Date('2026-08-28T12:00:00.000Z'),
  });

  assert.equal(quote.ok, true);
  assert.equal(quote.cycleId, null);
  assert.equal(quote.legs.length, 3);
});

test('parlay stake is capped by potential payout instead of a fixed 100 MXNP stake', async () => {
  const db = fakeDb({
    markets: [makeMarket(1), makeMarket(2), makeMarket(3)],
  });
  const allowed = await readParlayQuote(db, {
    legs: [
      { marketId: 1, outcomeIndex: 0 },
      { marketId: 2, outcomeIndex: 0 },
      { marketId: 3, outcomeIndex: 0 },
    ],
    stake: 800,
    now: new Date('2026-08-28T12:00:00.000Z'),
  });

  assert.equal(allowed.multiplier, 6);
  assert.equal(allowed.potentialPayout, 4800);

  await assert.rejects(
    () => readParlayQuote(db, {
      legs: [
        { marketId: 1, outcomeIndex: 0 },
        { marketId: 2, outcomeIndex: 0 },
        { marketId: 3, outcomeIndex: 0 },
      ],
      stake: 1000,
      now: new Date('2026-08-28T12:00:00.000Z'),
    }),
    /payout_too_high/,
  );
});
