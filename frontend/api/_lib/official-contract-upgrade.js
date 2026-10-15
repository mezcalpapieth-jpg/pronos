import { automaticConfig, applyAutomaticContract, GDP_OUTCOMES, RT_OUTCOMES, AA_OUTCOMES, RULES_VERSION } from './automated-market-rules.js';
import { contractHash } from './official-cutoff-snapshots.js';

export const OFFICIAL_UPGRADE_IDS = [317495, 317675, 332179, 337989];
const CONTRACTS = {
  317495: { source: 'october-tournament-2026', event: 'october-2026:mexico-gdp-q3-yoy', outcomes: GDP_OUTCOMES,
    kind: 'inegi-gdp-first-release', targetPeriod: '2026-Q3', resolveAt: '2026-10-30T14:00:00.000Z' },
  317675: { source: 'october-tournament-2026', event: 'october-2026:street-fighter-rotten-tomatoes', outcomes: RT_OUTCOMES,
    kind: 'rotten-tomatoes-cutoff', cutoff: '2026-10-19T14:00:00.000Z' },
  332179: { source: 'ai-benchmark', event: 'ai-benchmark:2026-10:artificial-analysis-index-lab', outcomes: AA_OUTCOMES,
    kind: 'artificial-analysis-cutoff', cutoff: '2026-11-01T05:59:59.000Z', resolveAt: '2026-11-01T17:59:59.000Z' },
  337989: { source: 'ai-named-model-release', event: 'ai-named-release:2026:gpt-astra-6-1', outcomes: ['Sí', 'No'],
    kind: 'openai-astra-release', cutoff: '2026-11-01T05:59:59.000Z', resolveAt: '2026-11-01T17:59:59.000Z' },
};
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const invalid = reason => Object.assign(new Error(reason), { status: 409 });

export function planOfficialContractUpgrade(markets, { now = new Date() } = {}) {
  if (markets.length !== 4 || new Set(markets.map(r => Number(r.id))).size !== 4) throw invalid('official_upgrade_inventory_mismatch');
  const entries = markets.map(m => {
    const contract = CONTRACTS[m.id];
    const cfg = json(m.resolver_config);
    const outcomes = json(m.outcomes);
    if (!contract || m.source !== contract.source || m.source_event_id !== contract.event || m.parent_id
      || m.status !== 'active' || m.mode && m.mode !== 'points' || JSON.stringify(outcomes) !== JSON.stringify(contract.outcomes)
      || !['manual', 'manual_review', 'api_chart'].includes(m.resolver_type) || !cfg) throw invalid(`official_upgrade_identity_mismatch:${m.id}`);
    if (now >= new Date(contract.cutoff || m.end_time)) throw invalid(`official_upgrade_already_closed:${m.id}`);
    const config = automaticConfig(contract.kind, { ...contract, openedAt: contract.kind === 'openai-astra-release'
      ? new Date(m.created_at).toISOString() : undefined });
    const next = applyAutomaticContract({ question: m.question, resolver_config: cfg, source_data: json(m.source_data) || {} }, config);
    next.source_data.resolvesAt = config.resolveAt;
    if (contract.kind === 'rotten-tomatoes-cutoff') delete next.source_data.pendingSetup;
    if (cfg.rulesVersion === RULES_VERSION) {
      if (Object.entries(config).some(([key, value]) => cfg[key] !== value)) {
        throw invalid(`official_upgrade_modified_contract:${m.id}`);
      }
      return null;
    }
    const before = { question: m.question, end_time: new Date(m.end_time).toISOString(), resolver_type: m.resolver_type, resolver_config: cfg };
    const after = { ...before, resolver_type: 'api_chart', resolver_config: next.resolver_config };
    if (contract.kind === 'openai-astra-release') {
      after.end_time = contract.cutoff;
      after.question = '¿GPT Astra 6.1+ será lanzado públicamente antes del cierre del 31 de octubre de 2026?';
      next.source_data.translations = { ...next.source_data.translations,
        es: { question: after.question, outcomes: ['Sí', 'No'] },
        en: { question: 'Will GPT Astra 6.1+ be publicly released by the end of October 31, 2026?', outcomes: ['Yes', 'No'] } };
    }
    return { id: Number(m.id), before, after, sourceData: next.source_data };
  }).filter(Boolean).sort((a, b) => a.id - b.id);
  return { version: RULES_VERSION, entries, planHash: contractHash({ version: RULES_VERSION, entries }, []) };
}

export async function updateOfficialContracts(client, { apply = false, expectedPlanHash, actor, now = new Date() } = {}) {
  const rows = await client.query(`SELECT m.id, m.question, m.outcomes, m.source, m.source_event_id,
    m.status, m.parent_id, m.mode, m.created_at, m.end_time, m.resolver_type, m.resolver_config,
    (SELECT p.source_data FROM points_pending_markets p WHERE p.approved_market_id=m.id ORDER BY p.id DESC LIMIT 1) AS source_data
    FROM points_markets m WHERE m.id = ANY($1::int[]) ORDER BY m.id ${apply ? 'FOR UPDATE' : ''}`, [OFFICIAL_UPGRADE_IDS]);
  const plan = planOfficialContractUpgrade(rows.rows, { now });
  if (!apply) return { ...plan, applied: false };
  if (!actor || expectedPlanHash !== plan.planHash) throw invalid('official_upgrade_preview_required_or_stale');
  for (const entry of plan.entries) {
    const { after } = entry;
    const cfg = { ...after.resolver_config, automationUpgrade: { at: now.toISOString(), by: actor, before: entry.before } };
    await client.query(`UPDATE points_markets SET question=$2, end_time=$3::timestamptz, resolver_type='api_chart', resolver_config=$4::jsonb WHERE id=$1`,
      [entry.id, after.question, after.end_time, JSON.stringify(cfg)]);
    await client.query(`UPDATE points_pending_markets SET question=$2, end_time=$3::timestamptz, resolver_type='api_chart', resolver_config=$4::jsonb,
      source_data=COALESCE(source_data,'{}'::jsonb) || $5::jsonb WHERE approved_market_id=$1`,
      [entry.id, after.question, after.end_time, JSON.stringify(cfg), JSON.stringify(entry.sourceData)]);
    await client.query(`UPDATE points_resolution_candidates SET status='denied', reviewer=$2, reviewed_at=NOW(),
      admin_note='Sustituida por las reglas oficiales automatizadas aprobadas del 15 de octubre'
      WHERE points_market_id=$1 AND status='pending'`, [entry.id, actor]);
  }
  return { applied: true, marketIds: plan.entries.map(r => r.id), version: RULES_VERSION };
}
