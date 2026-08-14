import { binaryPrices, multiPrices } from './amm-math.js';

function normalizeReserves(reserves) {
  if (!Array.isArray(reserves)) return [];
  return reserves
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0);
}

export function pricesFromReserves(reserves) {
  const values = normalizeReserves(reserves);
  if (values.length < 2) return [0.5, 0.5];
  return values.length === 2 ? binaryPrices(values) : multiPrices(values);
}

export async function bestEffortInsertPointsPriceSnapshot(client, {
  marketId,
  reserves,
  logLabel = 'points-price-snapshot',
} = {}) {
  const id = Number(marketId);
  const reserveValues = normalizeReserves(reserves);
  if (!client || !Number.isInteger(id) || id <= 0 || reserveValues.length < 2) return false;

  try {
    const prices = pricesFromReserves(reserveValues);
    await client.query(
      `INSERT INTO points_price_snapshots (market_id, prices, reserves, snapshotted_at)
       VALUES ($1, $2::jsonb, $3::jsonb, NOW())`,
      [id, JSON.stringify(prices), JSON.stringify(reserveValues)],
    );
    return true;
  } catch (e) {
    console.warn(`[${logLabel}] skipped`, {
      marketId: id,
      code: e?.code,
      message: e?.message?.slice(0, 160),
    });
    return false;
  }
}
