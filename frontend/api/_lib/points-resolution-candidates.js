function parseJsonb(value, fallback = null) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

// Call inside the same transaction that completes the market. Closing an
// obsolete suggestion is review bookkeeping, never another settlement.
export async function closeCompletedPointsResolutionCandidates(client, marketIds) {
  const ids = [...new Set(marketIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return [];
  const result = await client.query(`
    UPDATE points_resolution_candidates c
    SET status = CASE WHEN m.status = 'resolved' AND c.outcome_index = m.outcome
                      THEN 'confirmed' ELSE 'denied' END,
        reviewer = 'system:completed-market-review', reviewed_at = NOW(),
        admin_note = CONCAT('Revisión cerrada: mercado ', m.status, '; resultado final ', COALESCE(m.outcome::text, 'ninguno'), '. No se modificó la liquidación.')
    FROM points_markets m
    WHERE c.points_market_id = m.id AND m.id = ANY($1::bigint[])
      AND m.mode = 'points' AND m.status IN ('resolved', 'canceled') AND c.status = 'pending'
    RETURNING c.*`, [ids]);
  return result.rows;
}

// The market lock serializes a delayed evidence fetch against settlement.
// Without it, a cron can recreate a pending review after an admin resolves.
// The caller must use the same transaction for the lock and the upsert.
export async function upsertPendingPointsResolutionCandidate(client, candidate) {
  const market = await client.query(`SELECT id FROM points_markets
    WHERE id = $1 AND mode = 'points' AND status = 'active' FOR UPDATE`, [candidate.points_market_id]);
  if (!market.rows.length) return [];
  const result = await client.query(`INSERT INTO points_resolution_candidates
    (points_market_id, resolver_type, source, source_event_id, outcome_index, outcome_count,
     confidence_bps, observed_at, final_score, evidence_url, evidence, rationale, raw_report, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,NOW()),$9,$10,$11::jsonb,$12,$13::jsonb,'pending')
    ON CONFLICT (points_market_id) WHERE status = 'pending' DO UPDATE SET
      resolver_type = EXCLUDED.resolver_type, source = EXCLUDED.source,
      source_event_id = EXCLUDED.source_event_id, outcome_index = EXCLUDED.outcome_index,
      outcome_count = EXCLUDED.outcome_count, confidence_bps = EXCLUDED.confidence_bps,
      observed_at = EXCLUDED.observed_at, final_score = EXCLUDED.final_score,
      evidence_url = EXCLUDED.evidence_url, evidence = EXCLUDED.evidence,
      rationale = EXCLUDED.rationale, raw_report = EXCLUDED.raw_report
    RETURNING id`, [candidate.points_market_id, candidate.resolver_type, candidate.source,
    candidate.source_event_id, candidate.outcome_index, candidate.outcome_count, candidate.confidence_bps,
    candidate.observed_at, candidate.final_score, candidate.evidence_url, JSON.stringify(candidate.evidence),
    candidate.rationale, JSON.stringify(candidate.raw_report || {})]);
  return result.rows;
}

function intOrNull(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) ? n : null;
}

function trimOrNull(value, maxLength = 500) {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, maxLength) : null;
}

function nullableOutcomeIndex(value) {
  const n = intOrNull(value);
  return n != null && n >= 0 ? n : null;
}

export function buildPointsResolutionCandidateInsert(report = {}) {
  const outcomeIndex = nullableOutcomeIndex(report.outcomeIndex);
  const outcomeCount = Number(report.outcomeCount);
  const confidenceBps = Number(report.confidenceBps);
  return {
    points_market_id: Number(report.pointsMarketId),
    resolver_type: trimOrNull(report.resolverType, 60) || 'manual_review',
    source: trimOrNull(report.source, 120),
    source_event_id: trimOrNull(report.sourceEventId, 180),
    outcome_index: outcomeIndex,
    outcome_count: Number.isFinite(outcomeCount) && outcomeCount > 0 ? outcomeCount : 2,
    confidence_bps: Number.isFinite(confidenceBps) ? Math.max(0, Math.min(10000, Math.round(confidenceBps))) : 0,
    observed_at: report.observedAt || null,
    final_score: trimOrNull(report.finalScoreText, 240),
    evidence_url: trimOrNull(report.evidenceUrl, 500),
    evidence: Array.isArray(report.evidence) ? report.evidence : [],
    rationale: trimOrNull(report.rationale, 1000),
    raw_report: report.rawReport && typeof report.rawReport === 'object' ? report.rawReport : null,
    status: 'pending',
  };
}

export function formatPointsResolutionCandidate(row = {}, outcomes = []) {
  const outcomeIndex = nullableOutcomeIndex(row.outcome_index ?? row.outcomeIndex);
  const confidenceBps = intOrNull(row.confidence_bps ?? row.confidenceBps) ?? 0;
  const status = String(row.status || 'pending');
  const statusLabels = {
    pending: 'Sugerida',
    confirmed: 'Confirmada',
    denied: 'Negada',
  };
  const parsedOutcomes = parseJsonb(outcomes, []);
  const labels = Array.isArray(parsedOutcomes) ? parsedOutcomes : [];

  return {
    id: row.id == null ? null : Number(row.id),
    pointsMarketId: intOrNull(row.points_market_id ?? row.pointsMarketId),
    resolverType: row.resolver_type ?? row.resolverType ?? null,
    source: row.source ?? null,
    sourceEventId: row.source_event_id ?? row.sourceEventId ?? null,
    outcomeIndex,
    outcomeCount: intOrNull(row.outcome_count ?? row.outcomeCount) ?? labels.length,
    label: outcomeIndex == null ? 'Elegir resultado' : (labels[outcomeIndex] || `Resultado ${outcomeIndex + 1}`),
    needsOutcome: outcomeIndex == null,
    confidenceBps,
    confidenceLabel: confidenceBps > 0 ? `${Math.round(confidenceBps / 100)}%` : null,
    observedAt: row.observed_at ?? row.observedAt ?? null,
    finalScore: row.final_score ?? row.finalScore ?? null,
    evidenceUrl: row.evidence_url ?? row.evidenceUrl ?? null,
    evidence: parseJsonb(row.evidence, []),
    rationale: row.rationale ?? null,
    status,
    statusLabel: statusLabels[status] || status,
    createdAt: row.created_at ?? row.createdAt ?? null,
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? null,
    reviewer: row.reviewer ?? null,
    adminNote: row.admin_note ?? row.adminNote ?? null,
  };
}
