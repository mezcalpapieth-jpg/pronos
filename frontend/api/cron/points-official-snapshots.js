import { neon } from '@neondatabase/serverless';
import { timingSafeEqual } from 'node:crypto';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { CUTOFF_KINDS, collectCutoffEvidence, contractHash, resultRows } from '../_lib/official-cutoff-snapshots.js';
import { RULES_VERSION } from '../_lib/automated-market-rules.js';

export const config = { maxDuration: 300 };
export function authorizedOfficialSnapshotRequest(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return !process.env.VERCEL_ENV && process.env.NODE_ENV !== 'production';
  const provided = String(req.headers?.authorization || '').replace(/^Bearer /i, '');
  return Buffer.byteLength(provided) === Buffer.byteLength(secret)
    && timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

export async function runOfficialSnapshots({ dryRun = false } = {}, {
  sql = null, ensureSchema = ensurePointsSchema, collect = collectCutoffEvidence, clock = () => new Date(),
} = {}) {
  if (!sql) sql = neon(process.env.DATABASE_URL);
  // A dry run only inspects configuration; it neither creates tables nor stores/fetches evidence.
  if (!dryRun) await ensureSchema(sql);
  const now = clock();
  const candidates = resultRows(await sql.query(`SELECT id, outcomes, resolver_config FROM points_markets
    WHERE status = 'active' AND parent_id IS NULL AND resolver_type = 'api_chart'
      AND resolver_config->>'source' = 'official-result'
      AND resolver_config->>'rulesVersion' = $1 AND resolver_config->>'kind' = ANY($2::text[])
      AND CASE WHEN pg_input_is_valid(resolver_config->>'cutoff', 'timestamp with time zone')
        THEN (resolver_config->>'cutoff')::timestamptz BETWEEN $3::timestamptz AND $3::timestamptz + INTERVAL '10 minutes'
        ELSE false END
    ORDER BY resolver_config->>'cutoff', id LIMIT 12`, [RULES_VERSION, CUTOFF_KINDS, now.toISOString()]));
  const report = { ok: true, dryRun, candidates: candidates.map(r => Number(r.id)), written: [], errors: [] };
  if (dryRun) return report;
  for (const row of candidates) {
    try {
      const cfg = typeof row.resolver_config === 'string' ? JSON.parse(row.resolver_config) : row.resolver_config;
      const outcomes = typeof row.outcomes === 'string' ? JSON.parse(row.outcomes) : row.outcomes;
      const { payload, archive } = await collect(cfg, { clock });
      const age = cfg.kind === 'artificial-analysis-cutoff' ? 300000 : 60000;
      if (Date.parse(payload.capturedAt) > Date.parse(cfg.cutoff) || Date.parse(payload.startedAt) < Date.parse(cfg.cutoff) - age) continue;
      const inserted = resultRows(await sql.query(`INSERT INTO points_official_result_snapshots
        (market_id, contract_hash, started_at, captured_at, payload, archive)
        SELECT id, $2, $3::timestamptz, $4::timestamptz, $5::jsonb, $6::jsonb FROM points_markets
        WHERE id = $1 AND status = 'active' AND resolver_type = 'api_chart' AND resolver_config = $7::jsonb AND outcomes = $8::jsonb
        ON CONFLICT (market_id, contract_hash, captured_at) DO NOTHING RETURNING id`,
      [row.id, contractHash(cfg, outcomes), payload.startedAt, payload.capturedAt, JSON.stringify(payload), JSON.stringify(archive), JSON.stringify(cfg), JSON.stringify(outcomes)]));
      if (inserted.length) report.written.push(Number(row.id));
    } catch (e) { report.errors.push({ id: Number(row.id), reason: String(e.message).slice(0, 160) }); }
  }
  report.ok = report.errors.length === 0;
  return report;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  if (!authorizedOfficialSnapshotRequest(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const report = await runOfficialSnapshots({ dryRun: ['1', 'true'].includes(req.query?.dry) });
    if (!report.ok) console.error('[points-official-snapshots]', report.errors);
    return res.status(report.ok ? 200 : 502).json(report);
  } catch (e) { return res.status(500).json({ error: 'official_snapshot_failed', detail: String(e.message).slice(0, 160) }); }
}
