export function parallelLegResolutions(legs, outcomes, winningIdx) {
  if (!Number.isInteger(winningIdx) || winningIdx < 0 || winningIdx >= outcomes.length
    || new Set(outcomes).size !== outcomes.length) throw new Error('parallel_invalid_outcomes');
  const labels = legs.map(leg => typeof leg.leg_label === 'string' && leg.leg_label.length > 0);
  const labeled = labels.every(Boolean);
  if (!labeled && labels.some(Boolean)) throw new Error('parallel_partial_leg_labels');
  if (!labeled && legs.length !== outcomes.length) throw new Error('parallel_leg_count_mismatch');
  const indexes = legs.map((leg, i) => labeled ? outcomes.indexOf(leg.leg_label) : i);
  if (indexes.some(i => i < 0) || new Set(indexes).size !== indexes.length
    || !indexes.includes(winningIdx)) throw new Error('parallel_leg_identity_mismatch');
  return legs.map((leg, i) => {
    const outcome = indexes[i] === winningIdx ? 0 : 1;
    if (indexes[i] === winningIdx && leg.status === 'canceled') throw new Error('parallel_winner_canceled');
    if (leg.status === 'resolved' && (leg.outcome == null || Number(leg.outcome) !== outcome)) throw new Error('parallel_prior_resolution_conflict');
    return { ...leg, winningOutcome: outcome };
  });
}
