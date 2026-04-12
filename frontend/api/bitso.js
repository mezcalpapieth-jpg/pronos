import { applyCors } from './_lib/cors.js';

/**
 * /api/bitso — Mock MXN ↔ USDC conversion endpoint.
 *
 * Stub that returns simulated exchange rates and conversion quotes.
 * Will be replaced with real Bitso API integration post-MVP.
 *
 * GET /api/bitso?action=ticker          → current MXN/USDC rate
 * GET /api/bitso?action=quote&amount=100&side=buy  → quote for buying 100 USDC with MXN
 * GET /api/bitso?action=quote&amount=50&side=sell   → quote for selling 50 USDC for MXN
 */

// Mock rate: 1 USDC ≈ 17.20 MXN (approximate real rate)
const BASE_RATE = 17.20;
const SPREAD = 0.005; // 0.5% spread

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action = 'ticker', amount, side = 'buy' } = req.query;

  // Add slight randomness to simulate live market
  const jitter = (Math.random() - 0.5) * 0.10; // ±0.05 MXN
  const midRate = BASE_RATE + jitter;
  const buyRate = midRate * (1 + SPREAD);   // User pays more MXN to buy USDC
  const sellRate = midRate * (1 - SPREAD);  // User gets less MXN when selling USDC

  if (action === 'ticker') {
    return res.status(200).json({
      pair: 'usdc_mxn',
      mid: round(midRate),
      bid: round(sellRate),  // Price someone will buy USDC at (user sells)
      ask: round(buyRate),   // Price someone will sell USDC at (user buys)
      spread: round(SPREAD * 100, 2) + '%',
      volume_24h: round(1_250_000 + Math.random() * 500_000),
      updated_at: new Date().toISOString(),
      _mock: true,
    });
  }

  if (action === 'quote') {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ error: 'Valid amount required' });
    }

    if (side === 'buy') {
      // User wants to buy USDC with MXN
      const mxnNeeded = amt * buyRate;
      const fee = amt * 0.006; // 0.6% Bitso fee
      return res.status(200).json({
        side: 'buy',
        usdc_amount: round(amt),
        mxn_cost: round(mxnNeeded),
        rate: round(buyRate),
        fee_usdc: round(fee),
        fee_pct: '0.6%',
        total_mxn: round(mxnNeeded + fee * buyRate),
        expires_in: 30, // seconds
        _mock: true,
      });
    }

    if (side === 'sell') {
      // User wants to sell USDC for MXN
      const mxnReceived = amt * sellRate;
      const fee = amt * 0.006;
      return res.status(200).json({
        side: 'sell',
        usdc_amount: round(amt),
        mxn_received: round(mxnReceived),
        rate: round(sellRate),
        fee_usdc: round(fee),
        fee_pct: '0.6%',
        net_mxn: round((amt - fee) * sellRate),
        expires_in: 30,
        _mock: true,
      });
    }

    return res.status(400).json({ error: 'side must be buy or sell' });
  }

  return res.status(400).json({ error: 'action must be ticker or quote' });
}

function round(n, decimals = 2) {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}
