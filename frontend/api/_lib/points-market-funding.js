import { fundingAmount, fundingReserves, marketFundingPreview, planMarketFunding } from './market-funding.js';

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function json(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function requireFundableMarket(market) {
  if ((market.mode || 'points') !== 'points' || market.chain_id || market.chain_address) fail('points_funding_only');
  if (market.parent_id || market.amm_mode === 'parallel') fail('unified_parent_required');
  if (market.status !== 'active') fail('market_not_active');
  if (market.archived_at || (market.end_time && new Date(market.end_time) <= new Date())) fail('market_expired');
  const reserves = fundingReserves(json(market.reserves));
  const outcomes = json(market.outcomes);
  if (!Array.isArray(outcomes) || outcomes.length !== reserves.length) fail('outcomes_reserves_mismatch');
  return { reserves, outcomes };
}

async function readMarket(client, marketId, lock = false) {
  const result = await client.query(
    `SELECT id, question, outcomes, reserves, mode, chain_id, chain_address, parent_id,
            amm_mode, status, end_time, archived_at
       FROM points_markets WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [marketId],
  );
  if (!result.rows.length) fail('market_not_found', 404);
  return result.rows[0];
}

export async function previewPointsMarketFunding(client, { marketId, amount = null }) {
  const market = await readMarket(client, marketId);
  const { reserves, outcomes } = requireFundableMarket(market);
  return { marketId, question: market.question, outcomes, ...marketFundingPreview(reserves, amount) };
}

export async function addPointsMarketFunding(client, { marketId, amount, expectedReserves, requestId, username }) {
  const collateral = fundingAmount(amount);
  const expected = fundingReserves(expectedReserves);
  if (!username) fail('admin_username_required');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) fail('invalid_funding_request_id');
  const market = await readMarket(client, marketId, true);
  const previous = await client.query(
    'SELECT market_id, admin_username, collateral, result FROM points_market_funding WHERE request_id = $1', [requestId],
  );
  if (previous.rows.length) {
    const row = previous.rows[0];
    if (Number(row.market_id) !== marketId || row.admin_username !== username || Number(row.collateral) !== collateral) fail('funding_request_conflict', 409);
    return { ...json(row.result), replayed: true };
  }
  const { reserves } = requireFundableMarket(market);
  if (JSON.stringify(reserves) !== JSON.stringify(expected)) fail('funding_preview_stale', 409);
  const plan = planMarketFunding(reserves, collateral);
  await client.query('UPDATE points_markets SET reserves = $1::jsonb WHERE id = $2', [JSON.stringify(plan.reservesAfter), marketId]);
  const result = { ok: true, marketId, requestId, ...plan };
  await client.query(
    `INSERT INTO points_market_funding
      (market_id, request_id, admin_username, collateral, result)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [marketId, requestId, username, collateral, JSON.stringify(result)],
  );
  await client.query(
    `INSERT INTO points_price_snapshots (market_id, prices, reserves, snapshotted_at)
     VALUES ($1, $2::jsonb, $3::jsonb, NOW())`,
    [marketId, JSON.stringify(plan.pricesAfter), JSON.stringify(plan.reservesAfter)],
  );
  return result;
}
