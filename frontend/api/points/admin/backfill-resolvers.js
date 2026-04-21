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
import { generateWorldCupMarkets }      from '../../_lib/market-gen/world-cup.js';
import { generateLmbMarkets }           from '../../_lib/market-gen/lmb.js';
import { generateTennisMarkets }        from '../../_lib/market-gen/tennis.js';
import { generateGolfMarkets }          from '../../_lib/market-gen/golf.js';
import { fetchWikipediaImage }          from '../../_lib/wikipedia.js';
import { LMB_TEAMS }                    from '../../_lib/lmb-2026.js';

const sql = neon(process.env.DATABASE_URL);

// Same registry as cron/generate-markets-pending.
const GENERATORS = [
  generateSoccerMarkets, generateEspnSoccerMarkets,
  generateCryptoMarkets, generateStockMarkets, generateFxMarkets, generateFuelMarkets,
  generateWeatherMarkets,
  generateMlbMarkets, generateNbaMarkets, generateF1Markets,
  generateChartsMarkets, generateYouTubeMarkets, generateEntertainmentMarkets,
  generateWorldCupMarkets,
  generateLmbMarkets, generateTennisMarkets, generateGolfMarkets,
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
      // Also count markets eligible for the force-rebuild passes
      // (F1 / LMB / golf) so the UI doesn't say "nothing to
      // retrofit" when the spec-join path is empty but there are
      // still image rewrites to do.
      const [f1Count] = await sql`
        SELECT COUNT(*)::int AS n FROM points_markets
        WHERE status = 'active' AND parent_id IS NULL AND (
          resolver_config::text LIKE '%"jolpica-f1"%'
          OR icon = '🏁'
          OR league = 'formula-1'
          OR question ILIKE '%gran premio%'
          OR question ILIKE '%grand prix%'
        )
      `;
      const [lmbCount] = await sql`
        SELECT COUNT(*)::int AS n FROM points_markets m
        LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
        WHERE m.status = 'active' AND m.parent_id IS NULL
          AND (m.league = 'lmb' OR pm.source = 'lmb-mx-2026')
      `;
      const [golfCount] = await sql`
        SELECT COUNT(*)::int AS n FROM points_markets m
        LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
        WHERE m.status = 'active' AND m.parent_id IS NULL
          AND (m.league = 'pga' OR pm.source = 'espn-pga' OR m.icon = '⛳')
      `;
      const forceRebuildCount = (f1Count?.n || 0) + (lmbCount?.n || 0) + (golfCount?.n || 0);
      return res.status(200).json({
        dryRun: true,
        candidateCount: rows.length + forceRebuildCount,
        specCandidateCount: rows.length,
        forceRebuildCandidates: {
          f1:   f1Count?.n   || 0,
          lmb:  lmbCount?.n  || 0,
          golf: golfCount?.n || 0,
        },
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

    // ── Force-rebuild pass (F1 + LMB + golf + MLB) ──────────────────
    //
    // The spec-based loop above joins specs to markets via
    // (source, source_event_id) and only patches when
    // outcome_images IS NULL. That misses two cases:
    //   (a) markets approved before today's generator spec exists
    //       (F1 always; anything from past dates)
    //   (b) markets that already have an empty/wrong outcome_images
    //       array from an earlier buggy run
    //
    // This pass walks markets directly by sport / icon / question
    // and rewrites outcome_images from authoritative sources, no
    // NULL guard. Safe to re-run — writes the same URLs each time.

    // ── F1 ──────────────────────────────────────────────────────────
    // Match by resolver_config OR icon='🏁' OR league='formula-1'
    // OR the question mentioning Grand Prix / Gran Premio / GP.
    const f1Rows = await sql`
      SELECT id, question, outcomes, resolver_config, resolver_type,
             icon, category, league, amm_mode
      FROM points_markets
      WHERE status = 'active'
        AND parent_id IS NULL
        AND (
          resolver_config::text LIKE '%"jolpica-f1"%'
          OR icon = '🏁'
          OR league = 'formula-1'
          OR question ILIKE '%gran premio%'
          OR question ILIKE '%grand prix%'
          OR question ILIKE '%f\u00f3rmula 1%'
        )
      LIMIT 50
    `;
    console.log('[backfill-resolvers] F1 candidates', {
      count: f1Rows.length,
      ids: f1Rows.map(r => r.id),
    });
    // Cache the current Jolpica driver roster so we can match by
    // name when a market's resolver_config doesn't carry driverIds.
    let driverRoster = null;
    async function getDriverRoster() {
      if (driverRoster) return driverRoster;
      try {
        const res = await fetch(
          'https://api.jolpi.ca/ergast/f1/current/drivers.json',
          { headers: { 'Accept': 'application/json' } },
        );
        if (!res.ok) { driverRoster = []; return driverRoster; }
        const data = await res.json();
        driverRoster = data?.MRData?.DriverTable?.Drivers || [];
        return driverRoster;
      } catch { driverRoster = []; return driverRoster; }
    }

    // Cache constructor lookups — many drivers share a constructor,
    // so we hit Jolpica + Wikipedia at most once per team across
    // the entire retrofit run.
    const constructorByDriver = new Map(); // driverId → { constructorId, url }
    const logoByConstructor = new Map();   // constructorId → URL
    async function getConstructorLogoForDriver(driverId) {
      if (!driverId) return null;
      let ctor = constructorByDriver.get(driverId);
      if (ctor === undefined) {
        try {
          const res = await fetch(
            `https://api.jolpi.ca/ergast/f1/current/drivers/${encodeURIComponent(driverId)}/constructors.json`,
            { headers: { 'Accept': 'application/json' } },
          );
          if (!res.ok) { constructorByDriver.set(driverId, null); return null; }
          const data = await res.json();
          const c = data?.MRData?.ConstructorTable?.Constructors?.[0];
          ctor = c ? { constructorId: c.constructorId, url: c.url || null } : null;
        } catch { ctor = null; }
        constructorByDriver.set(driverId, ctor);
      }
      if (!ctor?.constructorId) return null;
      if (logoByConstructor.has(ctor.constructorId)) {
        return logoByConstructor.get(ctor.constructorId);
      }
      const logo = ctor.url ? await fetchWikipediaImage(ctor.url) : null;
      logoByConstructor.set(ctor.constructorId, logo);
      return logo;
    }

    let f1ImagesFound = 0;
    for (const row of f1Rows) {
      const cfg = (typeof row.resolver_config === 'object' && row.resolver_config)
        ? row.resolver_config
        : (() => { try { return JSON.parse(row.resolver_config); } catch { return null; } })();
      const outcomes = Array.isArray(row.outcomes)
        ? row.outcomes
        : (() => { try { return JSON.parse(row.outcomes); } catch { return []; } })();
      const legs = Array.isArray(cfg?.legs) ? cfg.legs : [];

      // Resolve driverId per outcome (leg mapping first, name
      // lookup fallback). 'Otro' stays null.
      let driverIdsPerOutcome;
      if (legs.length === outcomes.length) {
        driverIdsPerOutcome = legs.map(l => l?.driverId || null);
      } else {
        const roster = await getDriverRoster();
        driverIdsPerOutcome = outcomes.map(label => {
          const needle = String(label || '').toLowerCase().trim();
          if (!needle || needle === 'otro') return null;
          const match = roster.find(d => {
            const full = `${d.givenName} ${d.familyName}`.toLowerCase().trim();
            return full === needle;
          });
          return match?.driverId || null;
        });
      }

      if (driverIdsPerOutcome.every(id => !id)) {
        console.log('[backfill-resolvers] F1 row — no drivers matched', {
          id: row.id, outcomes,
        });
        continue;
      }

      // Each driver gets their constructor's logo (team badge).
      // Reads much better than driver portraits at card scale.
      const images = await Promise.all(
        driverIdsPerOutcome.map(id => getConstructorLogoForDriver(id)),
      );

      const found = images.filter(Boolean).length;
      console.log('[backfill-resolvers] F1 row processed', {
        id: row.id, driverIdsPerOutcome, imagesFound: found,
      });
      if (found === 0) continue;
      const upd = await sql`
        UPDATE points_markets
        SET outcome_images = ${JSON.stringify(images)}::jsonb
        WHERE id = ${row.id}
        RETURNING id
      `;
      if (upd.length > 0) {
        record(upd[0].id, 'outcomeImages');
        f1ImagesFound += found;
      }
    }

    // ── LMB ─────────────────────────────────────────────────────────
    // Match by league='lmb' OR source='lmb-mx-2026' (from the
    // pending row that created the market — look up via JOIN). For
    // each, rebuild outcome_images from LMB_TEAMS using the source
    // data's home/away codes that the generator persisted.
    const lmbRows = await sql`
      SELECT m.id, m.outcomes, pm.source_data
      FROM points_markets m
      LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
      WHERE m.status = 'active'
        AND m.parent_id IS NULL
        AND (m.league = 'lmb' OR pm.source = 'lmb-mx-2026')
      LIMIT 200
    `;
    let lmbImagesFound = 0;
    for (const row of lmbRows) {
      const sd = (typeof row.source_data === 'object' && row.source_data)
        ? row.source_data
        : (() => { try { return JSON.parse(row.source_data); } catch { return null; } })();
      const homeCode = sd?.home?.code;
      const awayCode = sd?.away?.code;
      const home = homeCode ? LMB_TEAMS[homeCode] : null;
      const away = awayCode ? LMB_TEAMS[awayCode] : null;
      if (!home && !away) continue;
      const images = [home?.logo || null, away?.logo || null];
      if (!images.some(Boolean)) continue;
      const upd = await sql`
        UPDATE points_markets
        SET outcome_images = ${JSON.stringify(images)}::jsonb
        WHERE id = ${row.id}
        RETURNING id
      `;
      if (upd.length > 0) {
        record(upd[0].id, 'outcomeImages');
        lmbImagesFound += images.filter(Boolean).length;
      }
    }

    // ── Golf ────────────────────────────────────────────────────────
    // Generator stashes the full FIELD roster on source_data.field.
    // If that's missing (older rows), fall back to matching the
    // outcome label against today's generator's FIELD.
    const currentGolfSpec = (specs.find(s => s.source === 'espn-pga') || null);
    const golfFieldFallback = currentGolfSpec?.source_data?.field || [];
    const golfRows = await sql`
      SELECT m.id, m.outcomes, pm.source_data
      FROM points_markets m
      LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
      WHERE m.status = 'active'
        AND m.parent_id IS NULL
        AND (m.league = 'pga' OR pm.source = 'espn-pga' OR m.icon = '⛳')
      LIMIT 20
    `;
    let golfImagesFound = 0;
    for (const row of golfRows) {
      const outcomes = Array.isArray(row.outcomes)
        ? row.outcomes
        : (() => { try { return JSON.parse(row.outcomes); } catch { return []; } })();
      const sd = (typeof row.source_data === 'object' && row.source_data)
        ? row.source_data
        : (() => { try { return JSON.parse(row.source_data); } catch { return null; } })();
      const field = (Array.isArray(sd?.field) ? sd.field : golfFieldFallback) || [];
      if (field.length === 0) continue;
      const byName = new Map();
      for (const p of field) byName.set(String(p.name || '').toLowerCase().trim(), p.id);
      const images = outcomes.map(label => {
        const id = byName.get(String(label || '').toLowerCase().trim());
        return id ? `https://a.espncdn.com/i/headshots/golf/players/full/${id}.png` : null;
      });
      if (!images.some(Boolean)) continue;
      const upd = await sql`
        UPDATE points_markets
        SET outcome_images = ${JSON.stringify(images)}::jsonb
        WHERE id = ${row.id}
        RETURNING id
      `;
      if (upd.length > 0) {
        record(upd[0].id, 'outcomeImages');
        golfImagesFound += images.filter(Boolean).length;
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
      lmbImagesFound,
      golfImagesFound,
      updated,
      reviewer: admin.username,
    });
  } catch (e) {
    console.error('[admin/backfill-resolvers] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'backfill_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
