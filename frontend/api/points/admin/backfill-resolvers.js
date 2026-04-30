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
import { generateLivMarkets }           from '../../_lib/market-gen/liv.js';
import { generateF1SeasonMarkets }      from '../../_lib/market-gen/f1-season.js';
import { fetchWikipediaImage }          from '../../_lib/wikipedia.js';
import { LMB_TEAMS }                    from '../../_lib/lmb-2026.js';
import { teamForDriver, CONSTRUCTORS_2026 } from '../../_lib/f1-grid-2026.js';

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
  generateLivMarkets, generateF1SeasonMarkets,
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
          AND (
            m.league IN ('pga', 'liv')
            OR pm.source IN ('espn-pga', 'espn-liv')
            OR m.icon = '⛳'
          )
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
    // Constructor logos fetched from Wikipedia once per team, per
    // retrofit run. Jolpica's driver→constructor endpoint is
    // unreliable for 2025/2026 transfers so we bypass it and map
    // directly from the driver's DISPLAY NAME (outcome label) via
    // the hardcoded grid in f1-grid-2026.js.
    const logoByTeam = new Map();
    async function resolveTeamLogo(teamKey) {
      if (logoByTeam.has(teamKey)) return logoByTeam.get(teamKey);
      const wiki = CONSTRUCTORS_2026[teamKey]?.wiki;
      const logo = wiki ? await fetchWikipediaImage(wiki) : null;
      logoByTeam.set(teamKey, logo);
      return logo;
    }

    let f1ImagesFound = 0;
    for (const row of f1Rows) {
      const outcomes = Array.isArray(row.outcomes)
        ? row.outcomes
        : (() => { try { return JSON.parse(row.outcomes); } catch { return []; } })();

      // Map each outcome label → team key via the grid (lowercase +
      // accent-stripped matching). 'Otro' and unknown reserve
      // drivers stay null.
      const teamsPerOutcome = outcomes.map(label => {
        const team = teamForDriver(label);
        return team?.teamKey || null;
      });

      if (teamsPerOutcome.every(t => !t)) {
        console.log('[backfill-resolvers] F1 row — no grid drivers matched', {
          id: row.id, outcomes,
        });
        continue;
      }

      const images = await Promise.all(
        teamsPerOutcome.map(t => (t ? resolveTeamLogo(t) : null)),
      );
      const found = images.filter(Boolean).length;
      console.log('[backfill-resolvers] F1 row processed', {
        id: row.id, teamsPerOutcome, imagesFound: found,
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

    // ── Golf (PGA + LIV) ────────────────────────────────────────────
    // Both tours share icon='⛳' and shape, so we walk them together
    // but per-row detect which tour we're on (PGA vs LIV) so the
    // resolver migration writes the correct cfg.source. Detection
    // priority:
    //   1. m.league ('pga' / 'liv')
    //   2. pm.source ('espn-pga' / 'espn-liv')
    //   3. source_event_id prefix ('pga:' / 'liv:')
    // Fallback: 'pga' (the original tour, matches the pre-LIV code).
    //
    // Generators stash the league-specific FIELD on
    // source_data.field, so the per-row roster is correct as long as
    // pm.source_data exists. For older malformed rows missing that,
    // we fall back to whichever current spec matches the detected
    // league.
    const currentPgaSpec = (specs.find(s => s.source === 'espn-pga') || null);
    const currentLivSpec = (specs.find(s => s.source === 'espn-liv') || null);
    const fallbackFieldFor = (league) =>
      (league === 'liv' ? currentLivSpec : currentPgaSpec)?.source_data?.field || [];

    const golfRows = await sql`
      SELECT m.id, m.outcomes, m.resolver_type, m.resolver_config, m.league,
             pm.source, pm.source_data, pm.source_event_id
      FROM points_markets m
      LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
      WHERE m.status = 'active'
        AND m.parent_id IS NULL
        AND (
          m.league IN ('pga', 'liv')
          OR pm.source IN ('espn-pga', 'espn-liv')
          OR m.icon = '⛳'
        )
      LIMIT 40
    `;
    let golfImagesFound = 0;
    let golfResolverMigrated = 0;
    for (const row of golfRows) {
      const outcomes = Array.isArray(row.outcomes)
        ? row.outcomes
        : (() => { try { return JSON.parse(row.outcomes); } catch { return []; } })();
      const sd = (typeof row.source_data === 'object' && row.source_data)
        ? row.source_data
        : (() => { try { return JSON.parse(row.source_data); } catch { return null; } })();

      // Detect tour for this row.
      const league = row.league === 'liv' ? 'liv'
        : row.league === 'pga' ? 'pga'
        : row.source === 'espn-liv' ? 'liv'
        : row.source === 'espn-pga' ? 'pga'
        : String(row.source_event_id || '').startsWith('liv:') ? 'liv'
        : String(row.source_event_id || '').startsWith('pga:') ? 'pga'
        : 'pga';
      const cfgSource = league === 'liv' ? 'espn-liv' : 'espn-pga';
      const eventIdPrefix = league === 'liv' ? 'liv:' : 'pga:';
      const field = (Array.isArray(sd?.field) ? sd.field : fallbackFieldFor(league)) || [];

      // Image rewrite (always safe — same URLs, no NULL guard).
      if (field.length > 0) {
        const byName = new Map();
        for (const p of field) byName.set(String(p.name || '').toLowerCase().trim(), p.id);
        const images = outcomes.map(label => {
          const id = byName.get(String(label || '').toLowerCase().trim());
          return id ? `https://a.espncdn.com/i/headshots/golf/players/full/${id}.png` : null;
        });
        if (images.some(Boolean)) {
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
      }

      // Resolver migration: golf markets created before the
      // sports_api readers landed had resolver_type='manual'. Switch
      // to sports_api with the league-correct cfg.source.
      const isManualOrNull = !row.resolver_type || row.resolver_type === 'manual';
      const eventId = sd?.eventId
        || (row.source_event_id ? String(row.source_event_id).replace(eventIdPrefix, '') : null);
      if (isManualOrNull && field.length > 0 && eventId) {
        const byName = new Map();
        for (const p of field) byName.set(String(p.name || '').toLowerCase().trim(), p.id);
        const legs = outcomes.map(label => {
          const norm = String(label || '').toLowerCase().trim();
          const id = byName.get(norm);
          if (id) return { label, driverId: String(id) };
          return { label, driverId: null };
        });
        const newCfg = {
          source: cfgSource,
          shape: 'parallel',
          eventId,
          legs,
        };
        const upd = await sql`
          UPDATE points_markets
          SET resolver_type = 'sports_api',
              resolver_config = ${JSON.stringify(newCfg)}::jsonb
          WHERE id = ${row.id}
            AND status = 'active'
            AND (resolver_type IS NULL OR resolver_type = 'manual')
          RETURNING id
        `;
        if (upd.length > 0) {
          record(upd[0].id, 'resolverType');
          golfResolverMigrated += 1;
        }
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
      golfResolverMigrated,
      updated,
      reviewer: admin.username,
    });
  } catch (e) {
    console.error('[admin/backfill-resolvers] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'backfill_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
