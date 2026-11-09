export function resolverCheckResult({ market, error, deferred, resolved, sourceResponseAt, sourceUrl }) {
  const config = market.resolver_config && typeof market.resolver_config === 'object' ? market.resolver_config : {};
  const reason = String(deferred?.reason || error?.error || '');
  let status = 'awaiting_result';
  if (resolved) status = resolved.canceled ? 'canceled' : 'resolved';
  else if (/market_already_completed/.test(reason)) status = 'market_changed';
  else if (/manual_review_(queued|candidate)/.test(reason)) status = 'manual_review';
  else if (/catchup_limit/.test(reason)) status = 'run_limit';
  else if (/missing_resolver|missing_event_id|unsupported|unknown resolver|invalid.*config/.test(reason)) status = 'configuration';
  else if (deferred?.notFound || /fixture.*(mismatch|not.found)|participant.*mismatch|event_not_found|ambiguous_reschedule|event_identity_mismatch/.test(reason)) status = 'fixture_mismatch';
  else if (market.resolver_type === 'api_transcript' && deferred) status = 'transcript_unavailable';
  else if (deferred?.invalidResult || /draw\/null winner|null winner|missing score|lmp_conflicting_final|lmp_invalid_game_date/.test(reason)) status = 'invalid_result';
  else if (deferred?.interrupted) status = 'event_interrupted';
  else if (reason === 'not_finished_yet') status = 'event_in_progress';
  else if (/^write_failed/.test(reason)) status = 'settlement_error';
  else if (error) status = 'provider_error';
  return {
    status,
    provider: deferred?.source || resolved?.source || config?.source || market.source || null,
    providerState: typeof deferred?.state === 'string' ? deferred.state.slice(0, 80) : null,
    sourceResponseAt: sourceResponseAt || null,
    sourceUrl: firstResolverSourceUrl(sourceUrl, deferred?.youtubeVideoUrl, deferred?.searchUrl, resolved?.transcriptUrl, resolved?.sourceUrl),
  };
}

export function resolverSourceUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    for (const key of url.searchParams.keys()) {
      if (/key|token|secret|auth|signature/i.test(key)) return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function firstResolverSourceUrl(...values) {
  for (const value of values) {
    const url = resolverSourceUrl(value);
    if (url) return url;
  }
  return null;
}

export async function writeResolverChecks(sql, checks) {
  if (!checks.length) return;
  await sql`
    INSERT INTO points_resolver_checkpoints (market_id, checkpoint_key, last_checked_at, metadata)
    SELECT entry.market_id, 'admin-diagnostic', entry.checked_at, entry.metadata
    FROM jsonb_to_recordset(${JSON.stringify(checks)}::jsonb)
      AS entry(market_id int, checked_at timestamptz, metadata jsonb)
    JOIN points_markets m ON m.id = entry.market_id
    ON CONFLICT (market_id, checkpoint_key) DO UPDATE SET
      last_checked_at = GREATEST(points_resolver_checkpoints.last_checked_at, EXCLUDED.last_checked_at),
      metadata = (
        CASE WHEN EXCLUDED.last_checked_at >= points_resolver_checkpoints.last_checked_at
          THEN EXCLUDED.metadata ELSE points_resolver_checkpoints.metadata END
      ) || jsonb_build_object('sourceResponseAt', GREATEST(
        (points_resolver_checkpoints.metadata->>'sourceResponseAt')::timestamptz,
        (EXCLUDED.metadata->>'sourceResponseAt')::timestamptz
      )),
      updated_at = NOW()
  `;
}
