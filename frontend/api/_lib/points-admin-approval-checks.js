import { buildMarketTranslations, translateOutcomeLabel } from './market-translations.js';
import { pointsResolverReadiness } from './points-resolver-readiness.js';
import { generateProposalCriteria, hasWrittenCriteria } from './points-proposal-criteria.js';

function json(value, fallback) {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}

export function proposalChecks(row, duplicates = [], now = Date.now()) {
  const config = json(row.resolver_config, {});
  const sourceData = json(row.source_data, {});
  const outcomes = json(row.outcomes, []);
  const checks = [];
  const add = (severity, code, marketId) => checks.push({ severity, code, ...(marketId ? { marketId } : {}) });
  if (!row.question?.trim() || outcomes.length < 2) add('block', 'incomplete_market');
  if (!row.end_time || !(new Date(row.end_time).getTime() > now)) add('block', 'expired_market');
  const fixtureResolver = row.resolver_type === 'sports_api'
    && (['espn', 'football-data', 'mlb-stats'].includes(config.source)
      || ['binary', 'draw3', 'total-goals-over'].includes(config.shape));
  if (fixtureResolver && !/^[1-9]\d*$/.test(String(config.eventId))) {
    add('block', 'missing_fixture_id');
  }
  const { en } = buildMarketTranslations({ ...row, outcomes, source_data: sourceData });
  const sameQuestion = en.question?.trim().toLowerCase() === row.question?.trim().toLowerCase();
  const likelyLanguageNeutral = row.sport && /^.+\s(?:vs\.?|@)\s.+$/i.test(row.question || '')
    && !/[¿?]/.test(row.question || '');
  const untranslatedOptions = outcomes.some((label, index) => {
    const translated = translateOutcomeLabel(label, 'en');
    return translated !== label && en.outcomes?.[index] === label;
  });
  if (!en.question || (sameQuestion && !likelyLanguageNeutral) || en.outcomes?.length !== outcomes.length || untranslatedOptions) {
    add('warning', 'english_review');
  }
  if (!hasWrittenCriteria(config, sourceData)
    && !generateProposalCriteria(row.resolver_type, config, sourceData, outcomes)) {
    add('warning', 'missing_criteria');
  }
  const readiness = pointsResolverReadiness({ ...row, resolver_config: config });
  if (readiness.mode === 'missing') add('warning', 'manual_review');
  if (readiness.mode === 'blocked') add('block', 'source_disabled');
  for (const row of duplicates) add(row.exact ? 'block' : 'warning', row.exact ? 'duplicate_market' : 'similar_market', row.id);
  return checks;
}

function proposalIdentity(row, event) {
  return {
    id: Number(row.id || 0),
    source: row.source || null,
    event: event || null,
    question: row.question.trim().toLowerCase().replace(/\s+/g, ' '),
    closes: new Date(row.end_time).toISOString(),
    outcomes: json(row.outcomes, []),
  };
}

export async function checkPendingProposals(client, entries) {
  const local = entries.map(({ row, event }) => {
    const checks = proposalChecks(row);
    const identity = checks.some(check => check.severity === 'block') ? null : proposalIdentity(row, event);
    return { row, identity, checks };
  });
  const targets = local.map(entry => entry.identity).filter(Boolean);
  if (!targets.length) return local.map(({ row, checks }) => ({ id: row.id, checks }));
  const { rows } = await client.query(
    `SELECT p.id AS pending_id, duplicate.id, duplicate.exact
      FROM jsonb_to_recordset($1::jsonb) AS p(
        id int, source text, event text, question text, closes timestamptz, outcomes jsonb
      )
      CROSS JOIN LATERAL (
        SELECT m.id,
          ((m.source = p.source AND m.source_event_id = p.event)
            OR (m.end_time = p.closes AND m.outcomes = p.outcomes AND
              LOWER(regexp_replace(btrim(m.question), '[[:space:]]+', ' ', 'g')) = p.question)) AS exact
        FROM points_markets m
        WHERE (m.source = p.source AND m.source_event_id = p.event)
          OR (m.mode = 'points' AND m.parent_id IS NULL AND m.archived_at IS NULL AND m.status <> 'canceled'
            AND m.end_time BETWEEN p.closes - INTERVAL '12 hours' AND p.closes + INTERVAL '12 hours'
            AND LOWER(regexp_replace(btrim(m.question), '[[:space:]]+', ' ', 'g')) = p.question)
        ORDER BY exact DESC NULLS LAST, m.id DESC LIMIT 4
      ) AS duplicate`,
    [JSON.stringify(targets)],
  );
  const duplicatesById = new Map();
  for (const match of rows) {
    const group = duplicatesById.get(match.pending_id) || [];
    group.push(match);
    duplicatesById.set(match.pending_id, group);
  }
  return local.map(({ row, identity, checks }) => ({
    id: row.id, checks: identity ? proposalChecks(row, duplicatesById.get(identity.id)) : checks,
  }));
}

export async function checkPendingProposal(client, row, { lock = false, approvalEventId = row.source_event_id } = {}) {
  if (lock) {
    const checks = proposalChecks(row);
    if (checks.some(check => check.severity === 'block')) return checks;
    const { question, source, event } = proposalIdentity(row, approvalEventId);
    // Serialize duplicate checks for approvals of the same event or title.
    const keys = ['title:' + question];
    if (source && event) keys.push('event:' + source + ':' + event);
    for (const key of keys.sort()) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  }
  const [result] = await checkPendingProposals(client, [{ row, event: approvalEventId }]);
  return result.checks;
}
