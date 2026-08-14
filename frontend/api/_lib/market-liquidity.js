export function normalizeSeedLiquidities({
  outcomes,
  seedLiquidity = 500,
  seedLiquidities = null,
  min = 100,
  max = 10_000_000,
} = {}) {
  const count = Array.isArray(outcomes) ? outcomes.length : 0;
  if (count < 2) return { error: 'outcome_count_out_of_range' };

  const fallback = Number(seedLiquidity ?? 500);
  const source = Array.isArray(seedLiquidities) && seedLiquidities.length > 0
    ? seedLiquidities
    : Array.from({ length: count }, () => fallback);

  if (!Array.isArray(source) || source.length !== count) {
    return { error: 'seed_liquidities_length_mismatch' };
  }

  const values = source.map((v) => Number(v));
  if (values.some(v => !Number.isFinite(v))) {
    return { error: 'invalid_seed_liquidity' };
  }
  if (values.some(v => v < min)) {
    return { error: 'seed_too_small' };
  }
  if (values.some(v => v > max)) {
    return { error: 'seed_too_large' };
  }

  return {
    values,
    fallback: values[0],
    total: values.reduce((sum, v) => sum + v, 0),
    uniform: values.every(v => Math.abs(v - values[0]) < 0.000001),
  };
}

export function seedLiquiditiesFromRow(row, outcomes = []) {
  const count = Array.isArray(outcomes) ? outcomes.length : 0;
  const raw = row?.seed_liquidities ?? row?.seedLiquidities ?? null;
  const parsed = Array.isArray(raw)
    ? raw
    : (() => {
      if (typeof raw !== 'string') return null;
      try { return JSON.parse(raw); } catch { return null; }
    })();

  const normalized = normalizeSeedLiquidities({
    outcomes,
    seedLiquidity: row?.seed_liquidity ?? row?.seedLiquidity ?? 500,
    seedLiquidities: parsed,
  });
  return normalized.values || Array.from({ length: count }, () => Number(row?.seed_liquidity ?? row?.seedLiquidity ?? 500));
}
