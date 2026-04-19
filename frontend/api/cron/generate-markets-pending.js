/**
 * Daily agent that discovers upcoming events and upserts them into
 * points_pending_markets for admin approval.
 *
 * Runs on a Vercel cron (see vercel.json). Per-source generators live in
 * `api/_lib/market-gen/*` and each return an array of market specs. We
 * then do one ON CONFLICT (source, source_event_id) DO NOTHING upsert so
 * re-running is idempotent.
 *
 * Env vars:
 *   CRON_SECRET             (required in production)
 *   FOOTBALL_DATA_API_KEY   (required for soccer generator; missing → skip)
 *
 * GET /api/cron/generate-markets-pending              — runs the generator batch
 * GET /api/cron/generate-markets-pending?dry=1        — builds specs, returns them
 *                                                       without DB writes
 *   (use this to manually eyeball what the agent would insert before
 *    enabling the cron.)
 */

import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { generateSoccerMarkets }  from '../_lib/market-gen/soccer.js';
import { generateCryptoMarkets }  from '../_lib/market-gen/crypto.js';
import { generateStockMarkets }   from '../_lib/market-gen/stocks.js';
import { generateWeatherMarkets } from '../_lib/market-gen/weather.js';

const sql = neon(process.env.DATABASE_URL);

// Registry of source-name → generator. Adding a new pipeline later is
// a one-line push; the upsert loop doesn't care where specs come from.
const GENERATORS = [
  { name: 'soccer',  run: generateSoccerMarkets  },
  { name: 'crypto',  run: generateCryptoMarkets  },
  { name: 'stocks',  run: generateStockMarkets   },
  { name: 'weather', run: generateWeatherMarkets },
];

export default async function handler(req, res) {
  // Standard cron-secret guard, matches other /api/cron endpoints.
  const secret = process.env.CRON_SECRET;
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);
  if (!secret) {
    if (isVercelDeploy) {
      return res.status(503).json({ error: 'CRON_SECRET not configured' });
    }
    // Local dev — allow through.
  } else {
    const provided = req.query.key || (req.headers.authorization || '').replace('Bearer ', '');
    if (provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  }

  const dryRun = req.query.dry === '1' || req.query.dry === 'true';
  const started = Date.now();

  try {
    await ensurePointsSchema(sql);

    // Run each generator in sequence. If one fails, keep going — we'd
    // rather ingest 3/4 sources than drop the whole batch.
    const allSpecs = [];
    const sourceStats = {};
    for (const gen of GENERATORS) {
      const label = gen.name;
      try {
        const specs = await gen.run();
        sourceStats[label] = { count: Array.isArray(specs) ? specs.length : 0 };
        if (Array.isArray(specs)) allSpecs.push(...specs);
      } catch (e) {
        console.error('[cron/generate-markets-pending] generator failed', {
          source: label,
          message: e?.message,
          stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
        });
        sourceStats[label] = { count: 0, error: e?.message?.slice(0, 200) || 'unknown' };
      }
    }

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        sources: sourceStats,
        specs: allSpecs.slice(0, 20),
        totalSpecs: allSpecs.length,
        elapsedMs: Date.now() - started,
      });
    }

    // Upsert one row per spec. ON CONFLICT DO NOTHING keeps re-runs
    // idempotent: same match tomorrow → noop. The unique index on
    // (source, source_event_id) is enforced by the schema migration.
    let inserted = 0;
    let skipped = 0;
    for (const s of allSpecs) {
      try {
        const result = await sql`
          INSERT INTO points_pending_markets
            (source, source_event_id, source_data, question, category, icon,
             outcomes, seed_liquidity, end_time, amm_mode, resolver_type,
             resolver_config)
          VALUES (
            ${s.source},
            ${s.source_event_id},
            ${s.source_data ? JSON.stringify(s.source_data) : null}::jsonb,
            ${s.question},
            ${s.category},
            ${s.icon || null},
            ${JSON.stringify(s.outcomes)}::jsonb,
            ${s.seed_liquidity ?? 1000},
            ${s.end_time},
            ${s.amm_mode || 'unified'},
            ${s.resolver_type || null},
            ${s.resolver_config ? JSON.stringify(s.resolver_config) : null}::jsonb
          )
          ON CONFLICT (source, source_event_id) DO NOTHING
          RETURNING id
        `;
        if (result.length > 0) inserted += 1;
        else skipped += 1;
      } catch (e) {
        console.error('[cron/generate-markets-pending] insert failed', {
          source: s.source,
          source_event_id: s.source_event_id,
          message: e?.message,
        });
        skipped += 1;
      }
    }

    return res.status(200).json({
      ok: true,
      sources: sourceStats,
      total: allSpecs.length,
      inserted,
      skipped,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    console.error('[cron/generate-markets-pending] fatal', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'generate_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
