const DEFAULT_SEED_LIQUIDITY = 1000;
const MIN_PROBABILITY = 0.05;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function asProbability(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1 ? n / 100 : n;
}

export function normalizeProbabilities(values, outcomeCount = null, {
  minProbability = MIN_PROBABILITY,
} = {}) {
  const count = Number.isInteger(outcomeCount) && outcomeCount > 0
    ? outcomeCount
    : Array.isArray(values) ? values.length : 0;
  if (count < 2) return { error: 'outcome_count_out_of_range' };

  const parsed = Array.isArray(values) && values.length === count
    ? values.map(asProbability)
    : Array.from({ length: count }, () => 1 / count);

  if (parsed.some(v => v === null)) {
    return { error: 'invalid_probability' };
  }

  const clamped = parsed.map(v => clamp(v, minProbability, 1 - minProbability));
  const total = clamped.reduce((sum, v) => sum + v, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return { error: 'invalid_probability_total' };
  }

  const probabilities = clamped.map(v => v / total);
  return {
    probabilities,
    probabilityPct: probabilities.map(v => Math.round(v * 1000) / 10),
  };
}

export function seedLiquiditiesFromProbabilities(probabilities, {
  seedLiquidity = DEFAULT_SEED_LIQUIDITY,
  minSeed = 100,
  maxSeed = 10_000_000,
} = {}) {
  const normalized = normalizeProbabilities(probabilities);
  if (normalized.error) return normalized;

  const seed = Number(seedLiquidity ?? DEFAULT_SEED_LIQUIDITY);
  if (!Number.isFinite(seed) || seed < minSeed) {
    return { error: 'invalid_seed_liquidity' };
  }

  // In the Pronos CPMM, prices are proportional to 1/reserve_i.
  // To open at P_i, use reserves proportional to 1/P_i and scale
  // so the average per-option seed remains the generator's seed.
  const inverse = normalized.probabilities.map(p => 1 / p);
  const inverseAvg = inverse.reduce((sum, v) => sum + v, 0) / inverse.length;
  const seedLiquidities = inverse.map(v => {
    const next = roundMoney(seed * (v / inverseAvg));
    return clamp(next, minSeed, maxSeed);
  });

  return {
    ...normalized,
    seedLiquidities,
    seedLiquidity: seedLiquidities[0],
  };
}

export function decimalOddsToProbability(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 1) return null;
  return 1 / n;
}

export function americanOddsToProbability(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

export function impliedProbabilitiesFromOdds(prices, { format = 'decimal' } = {}) {
  if (!Array.isArray(prices) || prices.length < 2) {
    return { error: 'outcome_count_out_of_range' };
  }
  const converter = format === 'american'
    ? americanOddsToProbability
    : decimalOddsToProbability;
  return normalizeProbabilities(prices.map(converter), prices.length, {
    minProbability: 0.02,
  });
}

function pricingFromSpec(spec) {
  const existing = spec?.suggestedPricing || spec?.source_data?.suggestedPricing || {};
  return {
    probabilities: spec?.suggested_probabilities
      || spec?.suggestedProbabilities
      || existing.probabilities
      || existing.probabilityPct
      || null,
    source: existing.source || spec?.pricing_source || spec?.pricingSource || 'uniform-default',
    rationale: existing.rationale || spec?.pricing_rationale || spec?.pricingRationale || null,
    evidence: Array.isArray(existing.evidence) ? existing.evidence : [],
  };
}

export function attachSuggestedPricing(spec = {}, pricingOverride = {}) {
  const outcomes = Array.isArray(spec.outcomes) ? spec.outcomes : [];
  if (outcomes.length < 2) return spec;

  const seed = Number(spec.seed_liquidity ?? spec.seedLiquidity ?? DEFAULT_SEED_LIQUIDITY);
  const suggested = {
    ...pricingFromSpec(spec),
    ...pricingOverride,
  };
  const priced = seedLiquiditiesFromProbabilities(suggested.probabilities, {
    seedLiquidity: Number.isFinite(seed) ? seed : DEFAULT_SEED_LIQUIDITY,
  });
  if (priced.error) return spec;

  const sourceData = spec.source_data && typeof spec.source_data === 'object'
    ? { ...spec.source_data }
    : {};
  sourceData.suggestedPricing = {
    source: suggested.source || 'uniform-default',
    probabilities: priced.probabilities,
    probabilityPct: priced.probabilityPct,
    seedLiquidities: priced.seedLiquidities,
    rationale: suggested.rationale || null,
    evidence: suggested.evidence || [],
  };

  return {
    ...spec,
    seed_liquidity: Number.isFinite(seed) ? seed : DEFAULT_SEED_LIQUIDITY,
    seed_liquidities: priced.seedLiquidities,
    seedLiquidity: Number.isFinite(seed) ? seed : DEFAULT_SEED_LIQUIDITY,
    seedLiquidities: priced.seedLiquidities,
    source_data: sourceData,
  };
}

export function attachDefaultSuggestedPricing(spec = {}) {
  const outcomes = Array.isArray(spec.outcomes) ? spec.outcomes : [];
  const existing = spec?.source_data?.suggestedPricing || spec?.suggestedPricing || null;
  if (existing?.probabilities || existing?.probabilityPct || spec.seed_liquidities || spec.seedLiquidities) {
    return attachSuggestedPricing(spec);
  }
  return attachSuggestedPricing(spec, {
    probabilities: Array.from({ length: outcomes.length }, () => 1 / outcomes.length),
    source: 'uniform-default',
    rationale: 'Sin odds externas disponibles; se abre balanceado para revisión admin.',
  });
}
