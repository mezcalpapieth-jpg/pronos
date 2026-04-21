/**
 * POST /api/points/admin/backfill-resolvers           — apply
 * POST /api/points/admin/backfill-resolvers?dry=1     — preview
 *
 * One-shot migration that patches already-approved points_markets
 * rows with any generator-owned fields that were added AFTER the
 * market was approved:
 *
 *   - resolver_type / resolver_config  (original purpose)
 *   - sport / league                   (per-type page classifiers)
 *   - outcome_images                   (team crests, driver portraits)
 *
 * Each field is COALESCE-patched only when the existing column is
 * NULL, so running this twice is safe and we never clobber a value
 * a human admin edited by hand.
 *
 * Flow:
 *   1. Run every generator inline — same pool as the daily cron.
 *   2. For each spec, UPDATE points_markets via the
 *      (source, source_event_id) → approved_market_id chain on
 *      points_pending_markets.
 *
 * Admin-only.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

import { generateSoccerMarkets }        from '../../_lib/market-gen/soccer.js';
import { generateEspnSoccerMarkets }    from '../../_lib/market-gen/espn-soccer.js';
import { generateCryptoMarkets }        from '../../_lib/market-gen/crypto.js';
import { generateStockMarkets }         from '../../_lib/market-gen/stocks.js';
import { generateWeatherMarkets }       from '../../_lib/market-gen/weather.js';
import { generateMlbMarkets }           from '../../_lib/market-gen/mlb.js';
import { generateNbaMarkets }           from '../../_lib/market-gen/nba.js';
import { generateF1Markets }            from '../../_lib/market-gen/f1.js';
import { generateFxMarkets }            from '../../_lib/market-gen/fx.js';
import { generateFuelMarkets }          from '../../_lib/market-gen/fuel.js';
import { generateChartsMarkets }        from '../../_lib/market-gen/charts.js';
import { generateYouTubeMarkets }       from '../../_lib/market-gen/youtube.js';
import { generateEntertainmentMarkets } from '../../_lib/market-gen/entertainment.js';
import { fetchWikipediaImage }          from '../../_lib/wikipedia.js';

const sql = neon(process.env.DATABASE_URL);

// Same registry as cron/generate-markets-pending.
const GENERATORS = [
  generateSoccerMarkets, generateEspnSoccerMarkets,
  generateCryptoMarkets, generateStockMarkets, generateFxMarkets, generateFuelMarkets,
  generateWeatherMarkets,
  generateMlbMarkets, generateNbaMarkets, generateF1Markets,
  generateChartsMarkets, generateYouTubeMarkets, generateEntertainmentMarkets,
];

async function collectSpecs() {
  const out = [];
  for (const run of GENERATORS) {
    try {
      const specs = await run();
      if (Array.isArray(specs)) out.push(...specs);
    } catch (e) {
      console.error('[admin/backfill-resolvers] generator failed', { message: e?.message });
    }
  }
  return out;
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const dryRun = req.query.dry === '1' || req.query.dry === 'true';
    await ensurePointsSchema(sql);

    const specs = await collectSpecs();

    if (specs.length === 0) {
      return res.status(200).json({
        ok: true,
        dryRun,
        candidateCount: 0,
        updatedCount: 0,
        note: 'No generator returned any spec — nothing to retrofit.',
      });
    }

    if (dryRun) {
      // Preview: a row is a candidate if the market has at least one
      // NULL field the fresh spec can fill in. We check the same set
      // the wet-run UPDATE touches so the count is truthful.
      const rows = [];
      for (const s of specs) {
        const r = await sql`
          SELECT m.id AS market_id,
                 m.resolver_type,
                 m.sport,
                 m.league,
                 m.outcome_images
          FROM points_markets m
          JOIN points_pending_markets pm ON pm.approved_market_id = m.id
          WHERE pm.source = ${s.source}
            AND pm.source_event_id = ${s.source_event_id}
            AND m.status = 'active'
            AND m.parent_id IS NULL
            AND (
              (m.resolver_type IS NULL AND ${s.resolver_type || null}::text IS NOT NULL)
              OR (m.sport IS NULL AND ${s.sport || null}::text IS NOT NULL)
              OR (m.league IS NULL AND ${s.league || null}::text IS NOT NULL)
              OR (m.outcome_images IS NULL
                  AND ${s.outcome_images ? JSON.stringify(s.outcome_images) : null}::jsonb IS NOT NULL)
            )
          LIMIT 1
        `;
        if (r.length > 0) {
          rows.push({
            marketId: r[0].market_id,
            source: s.source,
            sourceEventId: s.source_event_id,
            patches: {
              resolverType:   r[0].resolver_type   === null && !!s.resolver_type,
              sport:          r[0].sport           === null && !!s.sport,
              league:         r[0].league          === null && !!s.league,
              outcomeImages:  r[0].outcome_images  === null && !!s.outcome_images,
            },
          });
        }
      }
      return res.status(200).json({
        dryRun: true,
        candidateCount: rows.length,
        candidates: rows.slice(0, 50),
        specsTotal: specs.length,
      });
    }

    // Wet run — one UPDATE per field per spec. Each UPDATE guards on
    // "column IS NULL AND spec value IS NOT NULL", so we only touch
    // rows that genuinely need the value AND we can count accurately
    // which fields flipped.
    const patchedMarkets = new Map(); // marketId → Set(patches)
    const patchCounts = { resolverType: 0, sport: 0, league: 0, outcomeImages: 0 };

    function record(marketId, field) {
      if (!patchedMarkets.has(marketId)) patchedMarkets.set(marketId, new Set());
      patchedMarkets.get(marketId).add(field);
      patchCounts[field] += 1;
    }

    for (const s of specs) {
      if (s.resolver_type) {
        const r = await sql`
          UPDATE points_markets m
          SET resolver_type   = ${s.resolver_type},
              resolver_config = ${s.resolver_config ? JSON.stringify(s.resolver_config) : null}::jsonb
          FROM points_pending_markets pm
          WHERE pm.source = ${s.source}
            AND pm.source_event_id = ${s.source_event_id}
            AND pm.approved_market_id = m.id
            AND m.resolver_type IS NULL
            AND m.status = 'active'
            AND m.parent_id IS NULL
          RETURNING m.id
        `;
        for (const row of r) record(row.id, 'resolverType');
      }
      if (s.sport) {
        const r = await sql`
          UPDATE points_markets m
          SET sport = ${s.sport}
          FROM points_pending_markets pm
          WHERE pm.source = ${s.source}
            AND pm.source_event_id = ${s.source_event_id}
            AND pm.approved_market_id = m.id
            AND m.sport IS NULL
            AND m.parent_id IS NULL
          RETURNING m.id
        `;
        for (const row of r) record(row.id, 'sport');
      }
      if (s.league) {
        const r = await sql`
          UPDATE points_markets m
          SET league = ${s.league}
          FROM points_pending_markets pm
          WHERE pm.source = ${s.source}
            AND pm.source_event_id = ${s.source_event_id}
            AND pm.approved_market_id = m.id
            AND m.league IS NULL
            AND m.parent_id IS NULL
          RETURNING m.id
        `;
        for (const row of r) record(row.id, 'league');
      }
      if (Array.isArray(s.outcome_images) && s.outcome_images.length > 0) {
        const r = await sql`
          UPDATE points_markets m
          SET outcome_images = ${JSON.stringify(s.outcome_images)}::jsonb
          FROM points_pending_markets pm
          WHERE pm.source = ${s.source}
            AND pm.source_event_id = ${s.source_event_id}
            AND pm.approved_market_id = m.id
            AND m.outcome_images IS NULL
            AND m.parent_id IS NULL
          RETURNING m.id
        `;
        for (const row of r) record(row.id, 'outcomeImages');
      }
    }

    // ── F1 portrait pass ────────────────────────────────────────────────
    // The spec-based loop above relies on the (source, source_event_id)
    // join to match specs onto markets. For F1 that never works for
    // already-approved races: today's generator only ever returns the
    // NEXT race (source_event_id like 'f1:2026:N'), whereas existing
    // markets live at earlier rounds. So we do a second pass that
    // walks every active F1 parent directly via resolver_config.
    const f1Rows = await sql`
      SELECT id, outcomes, resolver_config
      FROM points_markets
      WHERE status = 'active'
        AND outcome_images IS NULL
        AND parent_id IS NULL
        AND resolver_type = 'sports_api'
        AND resolver_config::text LIKE '%"jolpica-f1"%'
      LIMIT 50
    `;
    let f1ImagesFound = 0;
    for (const row of f1Rows) {
      const cfg = (typeof row.resolver_config === 'object' && row.resolver_config)
        ? row.resolver_config
        : (() => { try { return JSON.parse(row.resolver_config); } catch { return null; } })();
      const outcomes = Array.isArray(row.outcomes)
        ? row.outcomes
        : (() => { try { return JSON.parse(row.outcomes); } catch { return []; } })();
      const legs = Array.isArray(cfg?.legs) ? cfg.legs : [];
      if (legs.length === 0 || legs.length !== outcomes.length) continue;

      // Jolpica driver profile endpoint returns the Wikipedia URL we
      // hand off to the REST summary API. 'Otro' (driverId === null)
      // gets a null slot.
      const images = await Promise.all(legs.map(async (leg) => {
        if (!leg?.driverId) return null;
        try {
          const res = await fetch(
            `https://api.jolpi.ca/ergast/f1/drivers/${encodeURIComponent(leg.driverId)}.json`,
            { headers: { 'Accept': 'application/json' } },
          );
          if (!res.ok) return null;
          const data = await res.json();
          const wikiUrl = data?.MRData?.DriverTable?.Drivers?.[0]?.url || null;
          if (!wikiUrl) return null;
          return fetchWikipediaImage(wikiUrl);
        } catch { return null; }
      }));

      const found = images.filter(Boolean).length;
      if (found === 0) continue;  // skip all-null writes
      const upd = await sql`
        UPDATE points_markets
        SET outcome_images = ${JSON.stringify(images)}::jsonb
        WHERE id = ${row.id}
          AND outcome_images IS NULL
        RETURNING id
      `;
      if (upd.length > 0) {
        record(upd[0].id, 'outcomeImages');
        f1ImagesFound += found;
      }
    }

    const updated = Array.from(patchedMarkets.entries()).map(([marketId, set]) => ({
      marketId,
      patches: Array.from(set),
    }));

    return res.status(200).json({
      ok: true,
      updatedCount: updated.length,
      patchCounts,
      f1ImagesFound,
      updated,
      reviewer: admin.username,
    });
  } catch (e) {
    console.error('[admin/backfill-resolvers] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'backfill_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
