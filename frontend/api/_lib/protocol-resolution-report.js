const DEFAULT_MAX_REPORT_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MIN_CONFIDENCE_BPS = 9000;
const ALLOWED_RESOLVER_TYPES = new Set(['chainlink-cre', 'chainlink-cre-ai']);
const ALLOWED_STATUSES = new Set(['ready', 'dry-run', 'candidate']);

function fail(message, status = 400, detail = null) {
  const err = new Error(message);
  err.status = status;
  err.detail = detail;
  return err;
}

function parsePositiveInt(value, name) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw fail(`invalid_${name}`);
  }
  return n;
}

function parseNonNegativeInt(value, name) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) {
    throw fail(`invalid_${name}`);
  }
  return n;
}

function trimRequired(value, name, maxLength = 240) {
  const s = String(value ?? '').trim();
  if (!s) throw fail(`missing_${name}`);
  return s.slice(0, maxLength);
}

function normalizeObservedAt(value, { nowMs, maxAgeMs }) {
  const observedMs = Date.parse(String(value || ''));
  if (!Number.isFinite(observedMs)) {
    throw fail('invalid_observed_at');
  }
  if (observedMs > nowMs + 60_000) {
    throw fail('report_from_future');
  }
  if (nowMs - observedMs > maxAgeMs) {
    throw fail('report_stale');
  }
  return new Date(observedMs).toISOString();
}

function normalizeFinalScore(value) {
  if (value == null || value === '') return { finalScore: null, finalScoreText: null };

  if (typeof value === 'string') {
    const finalScoreText = value.trim().slice(0, 240);
    return {
      finalScore: finalScoreText || null,
      finalScoreText: finalScoreText || null,
    };
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const home = value.home == null ? null : String(value.home).trim().slice(0, 60);
    const away = value.away == null ? null : String(value.away).trim().slice(0, 60);
    const finalScore = {
      ...(home ? { home } : {}),
      ...(away ? { away } : {}),
    };
    const finalScoreText = home && away ? `${home}-${away}` : null;
    return {
      finalScore: Object.keys(finalScore).length > 0 ? finalScore : null,
      finalScoreText,
    };
  }

  throw fail('invalid_final_score');
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((item) => {
    if (!item || typeof item !== 'object') return null;
    const title = String(item.title ?? '').trim().slice(0, 180);
    const url = String(item.url ?? '').trim().slice(0, 500);
    const quote = String(item.quote ?? '').trim().slice(0, 500);
    const evidence = {
      ...(title ? { title } : {}),
      ...(url ? { url } : {}),
      ...(quote ? { quote } : {}),
    };
    return Object.keys(evidence).length > 0 ? evidence : null;
  }).filter(Boolean);
}

function protocolMarketIdFrom(raw = {}) {
  if (raw.protocolMarketId != null) return raw.protocolMarketId;
  if (raw.protocol_market_id != null) return raw.protocol_market_id;
  return raw.marketId;
}

export function normalizeProtocolResolutionReport(raw = {}, opts = {}) {
  const nowMs = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
  const maxAgeMs = Number.isFinite(Number(opts.maxAgeMs))
    ? Number(opts.maxAgeMs)
    : DEFAULT_MAX_REPORT_AGE_MS;

  const resolverType = trimRequired(raw.resolverType ?? raw.resolver_type, 'resolver_type', 60);
  if (!ALLOWED_RESOLVER_TYPES.has(resolverType)) {
    throw fail('unsupported_resolver_type');
  }

  const status = String(raw.status || 'ready').trim() || 'ready';
  if (!ALLOWED_STATUSES.has(status)) {
    throw fail('invalid_report_status');
  }

  const outcomeCount = parsePositiveInt(raw.outcomeCount ?? raw.outcome_count, 'outcome_count');
  const outcomeIndex = parseNonNegativeInt(raw.outcomeIndex ?? raw.outcome_index, 'outcome');
  if (outcomeIndex >= outcomeCount) {
    throw fail('invalid_outcome');
  }

  const confidenceBps = parseNonNegativeInt(raw.confidenceBps ?? raw.confidence_bps, 'confidence_bps');
  if (confidenceBps > 10_000) {
    throw fail('invalid_confidence_bps');
  }

  const { finalScore, finalScoreText } = normalizeFinalScore(raw.finalScore ?? raw.final_score);

  const report = {
    resolverType,
    status,
    protocolMarketId: parsePositiveInt(protocolMarketIdFrom(raw), 'protocol_market_id'),
    source: trimRequired(raw.source, 'source', 120),
    sourceEventId: trimRequired(raw.sourceEventId ?? raw.source_event_id, 'source_event_id', 180),
    outcomeIndex,
    outcomeCount,
    confidenceBps,
    observedAt: normalizeObservedAt(raw.observedAt ?? raw.observed_at, { nowMs, maxAgeMs }),
    finalScore,
    finalScoreText,
    evidenceUrl: raw.evidenceUrl || raw.evidence_url
      ? String(raw.evidenceUrl ?? raw.evidence_url).trim().slice(0, 500)
      : null,
  };

  const evidence = normalizeEvidence(raw.evidence);
  if (evidence.length > 0) report.evidence = evidence;
  const rationale = String(raw.rationale ?? '').trim().slice(0, 1000);
  if (rationale) report.rationale = rationale;

  return report;
}

export function validateProtocolResolutionReportForMarket(report, market = {}, opts = {}) {
  const minConfidenceBps = Number.isFinite(Number(opts.minConfidenceBps))
    ? Number(opts.minConfidenceBps)
    : DEFAULT_MIN_CONFIDENCE_BPS;

  const marketId = Number(market.id);
  if (!Number.isInteger(marketId) || marketId !== report.protocolMarketId) {
    throw fail('report_market_mismatch', 409);
  }

  if (market.status !== 'active') {
    throw fail('market_not_active');
  }

  const marketOutcomeCount = Number(market.outcome_count || market.outcomeCount || 2);
  if (Number.isInteger(marketOutcomeCount) && marketOutcomeCount > 0) {
    if (report.outcomeCount !== marketOutcomeCount || report.outcomeIndex >= marketOutcomeCount) {
      throw fail('invalid_outcome');
    }
  }

  const source = String(market.source || '').trim();
  const sourceEventId = String(market.source_event_id || market.sourceEventId || '').trim();
  if (source && source !== report.source) {
    throw fail('report_source_mismatch', 409, `market source ${source} != report source ${report.source}`);
  }
  if (sourceEventId && sourceEventId !== report.sourceEventId) {
    throw fail(
      'report_source_mismatch',
      409,
      `market source_event_id ${sourceEventId} != report sourceEventId ${report.sourceEventId}`,
    );
  }

  if (report.confidenceBps < minConfidenceBps) {
    throw fail('report_confidence_too_low', 409);
  }

  return true;
}

function headerValue(headers = {}, name) {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === lower) return Array.isArray(value) ? value[0] : value;
  }
  return null;
}

export function assertAuthorizedCreRequest(req = {}, configuredSecret) {
  const secret = String(configuredSecret || '').trim();
  if (!secret) {
    throw fail('cre_resolution_secret_not_configured', 503);
  }

  const authorization = String(headerValue(req.headers, 'authorization') || '').trim();
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const fallback = String(headerValue(req.headers, 'x-pronos-cre-secret') || '').trim();

  if (bearer !== secret && fallback !== secret) {
    throw fail('cre_resolution_unauthorized', 401);
  }
}
