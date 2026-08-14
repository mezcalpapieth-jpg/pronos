function parseJsonb(value, fallback = null) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function intOrNull(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) ? n : null;
}

function nullableOutcomeIndex(value) {
  const n = intOrNull(value);
  return n != null && n >= 0 ? n : null;
}

function trimOrNull(value, maxLength = 500) {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, maxLength) : null;
}

export function buildResolutionCandidateInsert(report = {}) {
  const outcomeIndex = nullableOutcomeIndex(report.outcomeIndex);
  const outcomeCount = Number(report.outcomeCount);
  const confidenceBps = Number(report.confidenceBps);
  return {
    protocol_market_id: Number(report.protocolMarketId),
    resolver_type: trimOrNull(report.resolverType, 60),
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
    status: 'pending',
  };
}

export function formatResolutionCandidate(row = {}, outcomes = []) {
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
    protocolMarketId: intOrNull(row.protocol_market_id ?? row.protocolMarketId),
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
