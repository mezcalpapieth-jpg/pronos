const SELL_ALL_ROUNDING_TOLERANCE = 0.0100001;

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeExecutableSellShares({ requestedShares, heldShares, reservedShares = 0 } = {}) {
  const requested = finiteNumber(requestedShares);
  const held = Math.max(0, finiteNumber(heldShares));
  const reserved = Math.max(0, finiteNumber(reservedShares));
  const available = Math.max(0, held - reserved);

  if (requested <= 0) {
    const err = new Error('invalid_shares');
    err.status = 400;
    throw err;
  }

  if (requested > available) {
    const excess = requested - available;
    if (excess > SELL_ALL_ROUNDING_TOLERANCE) {
      const err = new Error('insufficient_available_shares');
      err.status = 400;
      throw err;
    }
    return { sharesToSell: available, availableShares: available, heldShares: held, reservedShares: reserved };
  }

  return { sharesToSell: requested, availableShares: available, heldShares: held, reservedShares: reserved };
}
