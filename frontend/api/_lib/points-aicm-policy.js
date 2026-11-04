// Aviation Edge is a separate, paid source from the public AICM board.
// A retained API key does not mean the subscription is still available.
export function aviationEdgeEnabled(env = process.env) {
  return env.POINTS_AVIATION_EDGE_ENABLED === 'true';
}

export function disabledPointsGenerators(env = process.env) {
  return aviationEdgeEnabled(env) ? [] : ['aicm', 'aicm-48h'];
}

export function isAviationEdgeMarket(market = {}) {
  const cfg = market.resolver_config || market.resolverConfig || {};
  return ['aicm', 'aicm-48h', 'aicm-official-flight-board', 'aviation-edge-timetable', 'aviation-edge'].includes(market.source)
    || ['aicm_delay_minutes', 'aicm_delay_minutes_live', 'aicm_delay_count'].includes(market.resolver_type || market.resolverType)
    || /^(?:aicm(?:-|_)|aviation-edge)/.test(String(cfg.source || ''))
    || /^aicm:/.test(String(market.source_event_id || market.sourceEventId || ''))
    || /^https:\/\/(?:www\.)?aviation-edge\.com\//i.test(String(cfg.evidenceUrl || ''));
}

export function aviationEdgeReadiness({ env = process.env, latestRun = null, now = new Date() } = {}) {
  const enabled = aviationEdgeEnabled(env);
  const keyConfigured = Boolean(env.AVIATION_EDGE_KEY);
  const ageMs = Number(now) - new Date(latestRun?.observed_at || latestRun?.observedAt || '').getTime();
  const healthy = latestRun?.status === 'ok' && ageMs >= -60_000 && ageMs <= 45 * 60_000;
  const reason = !enabled ? 'aviation_edge_disabled'
    : !keyConfigured ? 'aviation_edge_key_missing'
      : !healthy ? 'aviation_edge_unhealthy' : null;
  return { enabled, keyConfigured, ready: reason == null, reason };
}

export async function assertPointsAirportApproval(client, market, { env = process.env, now = new Date() } = {}) {
  if (!isAviationEdgeMarket(market)) return;
  let readiness = aviationEdgeReadiness({ env, now });
  if (readiness.enabled && readiness.keyConfigured) {
    const result = await client.query(`SELECT status, observed_at
      FROM points_aicm_timetable_runs WHERE direction = 'departure' ORDER BY observed_at DESC, id DESC LIMIT 1`);
    readiness = aviationEdgeReadiness({ env, now, latestRun: result.rows[0] });
  }
  if (!readiness.ready) {
    const error = new Error(readiness.reason);
    error.status = 409;
    error.detail = 'No se puede aprobar: Aviation Edge está deshabilitado o no tiene una lectura válida reciente. Restablece la fuente y verifica su cobertura antes de publicar mercados del AICM.';
    throw error;
  }
}
