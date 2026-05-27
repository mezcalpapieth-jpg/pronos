/**
 * Unit tests for the pure public-profile history summarizer used by
 * /api/points/u. These protect the public profile from showing the
 * wrong win/loss state when a user traded more than one outcome in the
 * same market.
 *
 * Run with:
 *   node --test frontend/api/_lib/points-public-profile.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPublicProfileHistory,
  buildPublicProfileStats,
} from './points-public-profile.js';

const BASE_ROW = {
  market_id: 42,
  question: 'Who wins?',
  category: 'sports',
  status: 'resolved',
  m_outcome: 1,
  end_time: '2026-05-01T00:00:00.000Z',
  resolved_at: '2026-05-01T00:10:00.000Z',
  final_score: '2-1',
  parent_question: null,
  leg_label: null,
};

test('resolved profile history counts a win when the user held the winning outcome after also trading losers', () => {
  const history = buildPublicProfileHistory([
    {
      ...BASE_ROW,
      side: 'buy',
      outcome_index: 0,
      shares: 40,
      collateral: 40,
      fee: 1,
    },
    {
      ...BASE_ROW,
      side: 'buy',
      outcome_index: 1,
      shares: 25,
      collateral: 25,
      fee: 0.5,
    },
  ], { nowMs: Date.parse('2026-05-02T00:00:00.000Z') });

  assert.equal(history.length, 1);
  assert.equal(history[0].outcomeStatus, 'won');
  assert.equal(history[0].netPnl, -41.5);
  assert.equal(history[0].buyCollateral, 65);
  assert.equal(history[0].sellProceeds, 0);
});

test('resolved profile history does not double-count already redeemed winning shares', () => {
  const history = buildPublicProfileHistory([
    {
      ...BASE_ROW,
      side: 'buy',
      outcome_index: 1,
      shares: 30,
      collateral: 30,
      fee: 0.75,
    },
    {
      ...BASE_ROW,
      side: 'redeem',
      outcome_index: 1,
      shares: 12,
      collateral: 12,
      fee: 0,
    },
  ], { nowMs: Date.parse('2026-05-02T00:00:00.000Z') });

  assert.equal(history[0].outcomeStatus, 'won');
  assert.equal(history[0].netPnl, -0.75);
});

test('resolved profile history values a losing market as the invested loss', () => {
  const history = buildPublicProfileHistory([
    {
      ...BASE_ROW,
      side: 'buy',
      outcome_index: 0,
      shares: 82,
      collateral: 100,
      fee: 0,
    },
  ], { nowMs: Date.parse('2026-05-02T00:00:00.000Z') });

  assert.equal(history[0].outcomeStatus, 'lost');
  assert.equal(history[0].buyCollateral, 100);
  assert.equal(history[0].sellProceeds, 0);
  assert.equal(history[0].netPnl, -100);
});

test('profile stats are derived from corrected per-market statuses', () => {
  const history = buildPublicProfileHistory([
    {
      ...BASE_ROW,
      side: 'buy',
      outcome_index: 1,
      shares: 10,
      collateral: 10,
      fee: 0,
    },
  ], { nowMs: Date.parse('2026-05-02T00:00:00.000Z') });

  const stats = buildPublicProfileStats(history);
  assert.equal(stats.totalPnl, 0);
  assert.equal(stats.marketsTraded, 1);
  assert.equal(stats.marketsWon, 1);
  assert.equal(stats.marketsLost, 0);
  assert.equal(stats.winRate, 100);
});

test('profile history orders markets by latest trade first', () => {
  const history = buildPublicProfileHistory([
    {
      ...BASE_ROW,
      market_id: 7,
      question: 'Older trade but newer resolution',
      resolved_at: '2026-05-10T00:00:00.000Z',
      created_at: '2026-05-01T10:00:00.000Z',
      side: 'buy',
      outcome_index: 1,
      shares: 10,
      collateral: 10,
      fee: 0,
    },
    {
      ...BASE_ROW,
      market_id: 8,
      question: 'Latest trade',
      resolved_at: '2026-05-02T00:00:00.000Z',
      created_at: '2026-05-11T10:00:00.000Z',
      side: 'buy',
      outcome_index: 1,
      shares: 10,
      collateral: 10,
      fee: 0,
    },
  ], { nowMs: Date.parse('2026-05-12T00:00:00.000Z') });

  assert.equal(history[0].marketId, 8);
  assert.equal(history[0].lastTradeAt, '2026-05-11T10:00:00.000Z');
  assert.equal(history[1].marketId, 7);
});
