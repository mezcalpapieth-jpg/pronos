export const PARLAY_SLIP_STORAGE_KEY = 'pronos:points:parlay-slip:v1';

export const PARLAY_RULES_FALLBACK = {
  minLegs: 3,
  maxLegs: 6,
  minStakeMxnp: 10,
  maxStakeMxnp: 100,
};

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegativeInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function parlayLegGroupId(leg) {
  return positiveInt(leg?.groupId ?? leg?.parentId ?? leg?.sourceMarketId ?? leg?.marketId);
}

export function sanitizeParlaySlip(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .map((leg) => {
      const marketId = positiveInt(leg?.marketId);
      const outcomeIndex = nonNegativeInt(leg?.outcomeIndex);
      const groupId = positiveInt(leg?.groupId ?? leg?.parentId ?? leg?.sourceMarketId) || marketId;
      return {
        marketId,
        outcomeIndex,
        groupId,
        question: String(leg?.question || '').slice(0, 180),
        outcomeLabel: String(leg?.outcomeLabel || '').slice(0, 80),
        price: Number.isFinite(Number(leg?.price)) ? Number(leg.price) : null,
      };
    })
    .filter((leg) => {
      if (!leg.marketId || leg.outcomeIndex == null) return false;
      const key = parlayLegGroupId(leg);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-PARLAY_RULES_FALLBACK.maxLegs);
}

export function readStoredParlaySlip() {
  if (typeof window === 'undefined') return [];
  try {
    return sanitizeParlaySlip(JSON.parse(window.localStorage.getItem(PARLAY_SLIP_STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function storeParlaySlip(legs) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PARLAY_SLIP_STORAGE_KEY, JSON.stringify(sanitizeParlaySlip(legs)));
  } catch {
    // Storage can be unavailable in private contexts; the in-memory slip still works.
  }
}

export function buildParlayLeg({ market, fallbackQuestion, outcomeIndex, outcomeLabel, price }) {
  const marketId = positiveInt(market?.id);
  const oi = nonNegativeInt(outcomeIndex);
  if (!marketId || oi == null) return null;
  return {
    marketId,
    outcomeIndex: oi,
    groupId: positiveInt(market?.groupId ?? market?.parentId ?? market?.sourceMarketId) || marketId,
    question: market?.question || fallbackQuestion || '',
    outcomeLabel: outcomeLabel || `Opcion ${oi + 1}`,
    price: Number.isFinite(Number(price)) ? Number(price) : null,
  };
}

export function addParlayLeg(current, nextLeg) {
  const leg = sanitizeParlaySlip([nextLeg])[0];
  if (!leg) return sanitizeParlaySlip(current);
  const groupId = parlayLegGroupId(leg);
  const withoutGroup = sanitizeParlaySlip(current).filter(item => parlayLegGroupId(item) !== groupId);
  return sanitizeParlaySlip([...withoutGroup, leg]);
}

export function parlayPayloadLegs(legs) {
  return sanitizeParlaySlip(legs).map(leg => ({
    marketId: leg.marketId,
    outcomeIndex: leg.outcomeIndex,
  }));
}
