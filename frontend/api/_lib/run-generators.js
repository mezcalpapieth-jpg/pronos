/**
 * Shared generator-runner for the pending-markets pipeline.
 *
 * Two callers today:
 *   - cron/generate-markets-pending  (scheduled, CRON_SECRET-gated)
 *   - points/admin/run-generators    (admin button, session-gated)
 *
 * Exported:
 *   GENERATORS           — canonical registry; adding a new pipeline is
 *                          a one-line push here
 *   runAllGenerators()   — fires every generator in sequence; one bad
 *                          source logs + records the error but doesn't
 *                          drop the batch
 *   upsertPending(sql, specs) — ON CONFLICT DO UPDATE upsert into
 *                          points_pending_markets. WHERE status='pending'
 *                          guard keeps approved/rejected rows frozen.
 *   upsertProtocolPending(sql, specs) — same generator output, but into
 *                          protocol_pending_markets for MVP/on-chain review.
 *
 * The `xmax = 0` check in RETURNING is the canonical PG trick to tell
 * an INSERT apart from an UPDATE: xmax is 0 for fresh rows, non-zero
 * when the row was updated via ON CONFLICT.
 */

import { generateSoccerMarkets }        from './market-gen/soccer.js';
import { generateEspnSoccerMarkets }    from './market-gen/espn-soccer.js';
import { generateCryptoMarkets }        from './market-gen/crypto.js';
import { generateStockMarkets }         from './market-gen/stocks.js';
import { generateWeatherMarkets }       from './market-gen/weather.js';
import { generateMlbMarkets }           from './market-gen/mlb.js';
import { generateNbaMarkets }           from './market-gen/nba.js';
import { generateF1Markets }            from './market-gen/f1.js';
import { generateFxMarkets }            from './market-gen/fx.js';
import { generateFuelMarkets }          from './market-gen/fuel.js';
import { generateMananeraMarkets }      from './market-gen/mananera.js';
import { generateChartsMarkets }        from './market-gen/charts.js';
import { generateYouTubeMarkets }       from './market-gen/youtube.js';
import { generateEntertainmentMarkets } from './market-gen/entertainment.js';
import { generateLcdlfMarkets }         from './market-gen/lcdlf.js';
import { generateWorldCupMarkets }      from './market-gen/world-cup.js';
import { generateLmbMarkets }           from './market-gen/lmb.js';
import { generateTennisMarkets }        from './market-gen/tennis.js';
import { generateGolfMarkets }          from './market-gen/golf.js';
import { generateLivMarkets }           from './market-gen/liv.js';
import { generateUfcMarkets }           from './market-gen/ufc.js';
import { generateBoxingMarkets }        from './market-gen/boxing.js';
import { generateNextOpponentMarkets }  from './market-gen/next-opponent.js';
import { generateF1SeasonMarkets }      from './market-gen/f1-season.js';
import { deriveMarketTags }             from './category-tags.js';
import { attachDefaultSuggestedPricing } from './market-pricing.js';
import { tryAttachPolymarketPricing }    from './polymarket-pricing.js';
import { attachMarketContextBlocks }      from './market-context-blocks.js';

const MARKET_ICON = null;
const PRICING_CONCURRENCY = 4;
const APPROVED_SCHEDULE_SYNC_SOURCES = new Set([
  'espn-atp-match',
]);

export const GENERATORS = [
  { name: 'soccer',         run: generateSoccerMarkets        },
  { name: 'espn-soccer',    run: generateEspnSoccerMarkets    },
  { name: 'crypto',         run: generateCryptoMarkets        },
  { name: 'stocks',         run: generateStockMarkets         },
  { name: 'fx',             run: generateFxMarkets            },
  { name: 'fuel',           run: generateFuelMarkets          },
  { name: 'mananera',       run: generateMananeraMarkets      },
  { name: 'weather',        run: generateWeatherMarkets       },
  { name: 'mlb',            run: generateMlbMarkets           },
  { name: 'nba',            run: generateNbaMarkets           },
  { name: 'f1',             run: generateF1Markets            },
  { name: 'charts',         run: generateChartsMarkets        },
  { name: 'youtube',        run: generateYouTubeMarkets       },
  { name: 'lcdlf',          run: generateLcdlfMarkets         },
  { name: 'entertainment',  run: generateEntertainmentMarkets },
  { name: 'world-cup',      run: generateWorldCupMarkets      },
  { name: 'lmb',            run: generateLmbMarkets            },
  { name: 'tennis',         run: generateTennisMarkets         },
  { name: 'golf',           run: generateGolfMarkets           },
  { name: 'liv',            run: generateLivMarkets            },
  { name: 'ufc',            run: generateUfcMarkets            },
  { name: 'boxing',         run: generateBoxingMarkets         },
  { name: 'next-opponent',  run: generateNextOpponentMarkets   },
  { name: 'f1-season',      run: generateF1SeasonMarkets       },
];

async function attachGeneratorPricing(specs, { concurrency = PRICING_CONCURRENCY } = {}) {
  if (!Array.isArray(specs) || !specs.length) return [];
  const priced = new Array(specs.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, specs.length);

  async function worker() {
    while (nextIndex < specs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const polymarketPriced = await tryAttachPolymarketPricing(specs[index]);
      priced[index] = attachDefaultSuggestedPricing(polymarketPriced);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return priced;
}

export async function runAllGenerators() {
  const allSpecs = [];
  const sourceStats = {};
  for (const gen of GENERATORS) {
    try {
      const specs = await gen.run();
      const pricedSpecs = await attachGeneratorPricing(specs);
      const contextualSpecs = pricedSpecs.map(spec => attachMarketContextBlocks(spec));
      sourceStats[gen.name] = { count: contextualSpecs.length };
      if (contextualSpecs.length) allSpecs.push(...contextualSpecs);
    } catch (e) {
      console.error('[run-generators] generator failed', {
        source: gen.name,
        message: e?.message,
        stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
      });
      sourceStats[gen.name] = {
        count: 0,
        error: e?.message?.slice(0, 200) || 'unknown',
      };
    }
  }
  return { allSpecs, sourceStats };
}

export async function upsertPending(sql, allSpecs) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const s of allSpecs) {
    try {
      const tags = deriveMarketTags(s);
      const result = await sql`
        INSERT INTO points_pending_markets
          (source, source_event_id, source_data, question, category, icon,
           outcomes, seed_liquidity, seed_liquidities, start_time, end_time, amm_mode,
           resolver_type, resolver_config, sport, league, outcome_images,
           category_tags, geo_tags, topic_tags)
        VALUES (
          ${s.source},
          ${s.source_event_id},
          ${s.source_data ? JSON.stringify(s.source_data) : null}::jsonb,
          ${s.question},
          ${s.category},
          ${MARKET_ICON},
          ${JSON.stringify(s.outcomes)}::jsonb,
          ${s.seed_liquidity ?? 1000},
          ${s.seed_liquidities ? JSON.stringify(s.seed_liquidities) : null}::jsonb,
          ${s.start_time || null},
          ${s.end_time},
          ${s.amm_mode || 'unified'},
          ${s.resolver_type || null},
          ${s.resolver_config ? JSON.stringify(s.resolver_config) : null}::jsonb,
          ${s.sport || null},
          ${s.league || null},
          ${s.outcome_images ? JSON.stringify(s.outcome_images) : null}::jsonb,
          ${JSON.stringify(tags.categoryTags)}::jsonb,
          ${JSON.stringify(tags.geoTags)}::jsonb,
          ${JSON.stringify(tags.topicTags)}::jsonb
        )
        ON CONFLICT (source, source_event_id) DO UPDATE
        SET source_data     = EXCLUDED.source_data,
            question        = EXCLUDED.question,
            category        = EXCLUDED.category,
            icon            = EXCLUDED.icon,
            outcomes        = EXCLUDED.outcomes,
            seed_liquidity  = EXCLUDED.seed_liquidity,
            seed_liquidities = EXCLUDED.seed_liquidities,
            start_time      = EXCLUDED.start_time,
            end_time        = EXCLUDED.end_time,
            amm_mode        = EXCLUDED.amm_mode,
            resolver_type   = EXCLUDED.resolver_type,
            resolver_config = EXCLUDED.resolver_config,
            sport           = EXCLUDED.sport,
            league          = EXCLUDED.league,
            outcome_images  = EXCLUDED.outcome_images,
            category_tags   = EXCLUDED.category_tags,
            geo_tags        = EXCLUDED.geo_tags,
            topic_tags      = EXCLUDED.topic_tags,
            status          = CASE
              WHEN points_pending_markets.status = 'rejected'
               AND points_pending_markets.reviewer = 'system'
               AND points_pending_markets.admin_note LIKE 'auto-%'
              THEN 'pending'
              ELSE points_pending_markets.status
            END,
            admin_note      = CASE
              WHEN points_pending_markets.status = 'rejected'
               AND points_pending_markets.reviewer = 'system'
               AND points_pending_markets.admin_note LIKE 'auto-%'
              THEN NULL
              ELSE points_pending_markets.admin_note
            END,
            reviewer        = CASE
              WHEN points_pending_markets.status = 'rejected'
               AND points_pending_markets.reviewer = 'system'
               AND points_pending_markets.admin_note LIKE 'auto-%'
              THEN NULL
              ELSE points_pending_markets.reviewer
            END,
            reviewed_at     = CASE
              WHEN points_pending_markets.status = 'rejected'
               AND points_pending_markets.reviewer = 'system'
               AND points_pending_markets.admin_note LIKE 'auto-%'
              THEN NULL
              ELSE points_pending_markets.reviewed_at
            END
        WHERE points_pending_markets.status = 'pending'
           OR (
             points_pending_markets.status = 'rejected'
             AND points_pending_markets.reviewer = 'system'
             AND points_pending_markets.admin_note LIKE 'auto-%'
           )
        RETURNING id, (xmax = 0) AS inserted
      `;
      if (result.length > 0) {
        if (result[0].inserted) inserted += 1;
        else updated += 1;
      } else {
        // Conflict hit an approved/rejected row — WHERE blocked the
        // update, so the row is untouched.
        skipped += 1;
      }
    } catch (e) {
      console.error('[run-generators] insert failed', {
        source: s.source,
        source_event_id: s.source_event_id,
        message: e?.message,
      });
      skipped += 1;
    }
  }
  return { inserted, updated, skipped };
}

function approvedScheduleSyncCandidate(spec, nowMs = Date.now()) {
  if (!spec || !APPROVED_SCHEDULE_SYNC_SOURCES.has(spec.source)) return null;
  const sourceEventId = String(spec.source_event_id || '').trim();
  if (!sourceEventId) return null;
  const endMs = new Date(spec.end_time).getTime();
  if (!Number.isFinite(endMs) || endMs <= nowMs) return null;
  return { source: spec.source, sourceEventId, endMs };
}

function resolverTimingPatch(spec) {
  const patch = {};
  const dateYmd = spec?.resolver_config?.dateYmd;
  if (dateYmd) patch.dateYmd = dateYmd;
  return patch;
}

export async function syncApprovedMarketSchedules(sql, allSpecs, { dryRun = false, nowMs = Date.now() } = {}) {
  const stats = {
    checked: 0,
    candidates: 0,
    updated: 0,
    skipped: 0,
    updates: [],
  };
  const seen = new Set();

  for (const s of allSpecs) {
    const candidate = approvedScheduleSyncCandidate(s, nowMs);
    if (!candidate) continue;
    const dedupeKey = `${candidate.source}:${candidate.sourceEventId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    stats.checked += 1;

    const resolverPatch = JSON.stringify(resolverTimingPatch(s));
    const freshResolverConfig = s.resolver_config ? JSON.stringify(s.resolver_config) : null;
    const sourceDataPatch = JSON.stringify({
      startDateIso: s.source_data?.startDateIso || s.end_time,
      scheduleSyncedAt: new Date(nowMs).toISOString(),
    });

    try {
      if (dryRun) {
        const rows = await sql`
          SELECT m.id AS market_id,
                 m.question,
                 m.end_time AS old_end_time,
                 ${s.end_time}::timestamptz AS new_end_time
          FROM points_markets m
          JOIN points_pending_markets pm ON pm.approved_market_id = m.id
          WHERE pm.source = ${s.source}
            AND pm.source_event_id = ${s.source_event_id}
            AND m.status = 'active'
            AND m.parent_id IS NULL
            AND COALESCE(m.source, pm.source) = ${s.source}
            AND COALESCE(m.source_event_id, pm.source_event_id) = ${s.source_event_id}
            AND ${s.end_time}::timestamptz > NOW()
            AND m.end_time IS DISTINCT FROM ${s.end_time}::timestamptz
        `;
        stats.candidates += rows.length;
        for (const row of rows) {
          stats.updates.push({
            marketId: row.market_id,
            question: row.question,
            oldEndTime: row.old_end_time,
            newEndTime: row.new_end_time,
          });
        }
        continue;
      }

      const rows = await sql`
        WITH candidate AS (
          SELECT m.id AS market_id,
                 m.question,
                 m.end_time AS old_end_time,
                 pm.id AS pending_id
          FROM points_markets m
          JOIN points_pending_markets pm ON pm.approved_market_id = m.id
          WHERE pm.source = ${s.source}
            AND pm.source_event_id = ${s.source_event_id}
            AND m.status = 'active'
            AND m.parent_id IS NULL
            AND COALESCE(m.source, pm.source) = ${s.source}
            AND COALESCE(m.source_event_id, pm.source_event_id) = ${s.source_event_id}
            AND ${s.end_time}::timestamptz > NOW()
            AND m.end_time IS DISTINCT FROM ${s.end_time}::timestamptz
        )
        UPDATE points_markets m
        SET end_time = ${s.end_time}::timestamptz,
            resolver_config = CASE
              WHEN ${resolverPatch}::jsonb = '{}'::jsonb THEN m.resolver_config
              ELSE COALESCE(m.resolver_config, '{}'::jsonb) || ${resolverPatch}::jsonb
            END
        FROM candidate c
        WHERE m.id = c.market_id
        RETURNING m.id AS market_id,
                  m.question,
                  c.pending_id,
                  c.old_end_time,
                  m.end_time AS new_end_time
      `;

      if (rows.length === 0) continue;
      stats.candidates += rows.length;
      stats.updated += rows.length;
      for (const row of rows) {
        if (row.pending_id) {
          await sql`
            UPDATE points_pending_markets
            SET end_time = ${s.end_time}::timestamptz,
                resolver_config = ${freshResolverConfig}::jsonb,
                source_data = COALESCE(source_data, '{}'::jsonb) || ${sourceDataPatch}::jsonb
            WHERE id = ${row.pending_id}
          `;
        }
        stats.updates.push({
          marketId: row.market_id,
          question: row.question,
          oldEndTime: row.old_end_time,
          newEndTime: row.new_end_time,
        });
      }
    } catch (e) {
      console.error('[run-generators] approved schedule sync failed', {
        source: s.source,
        source_event_id: s.source_event_id,
        message: e?.message,
      });
      stats.skipped += 1;
    }
  }

  return stats;
}

export async function upsertProtocolPending(sql, allSpecs) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const s of allSpecs) {
    try {
      const tags = deriveMarketTags(s);
      const result = await sql`
        INSERT INTO protocol_pending_markets
          (source, source_event_id, source_data, question, category, icon,
           outcomes, seed_liquidity, start_time, end_time, amm_mode,
           resolver_type, resolver_config, sport, league, outcome_images,
           category_tags, geo_tags, topic_tags)
        VALUES (
          ${s.source},
          ${s.source_event_id},
          ${s.source_data ? JSON.stringify(s.source_data) : null}::jsonb,
          ${s.question},
          ${s.category},
          ${MARKET_ICON},
          ${JSON.stringify(s.outcomes)}::jsonb,
          ${s.seed_liquidity ?? 1000},
          ${s.start_time || null},
          ${s.end_time},
          ${s.amm_mode || 'unified'},
          ${s.resolver_type || null},
          ${s.resolver_config ? JSON.stringify(s.resolver_config) : null}::jsonb,
          ${s.sport || null},
          ${s.league || null},
          ${s.outcome_images ? JSON.stringify(s.outcome_images) : null}::jsonb,
          ${JSON.stringify(tags.categoryTags)}::jsonb,
          ${JSON.stringify(tags.geoTags)}::jsonb,
          ${JSON.stringify(tags.topicTags)}::jsonb
        )
        ON CONFLICT (source, source_event_id) DO UPDATE
        SET source_data     = EXCLUDED.source_data,
            question        = EXCLUDED.question,
            category        = EXCLUDED.category,
            icon            = EXCLUDED.icon,
            outcomes        = EXCLUDED.outcomes,
            seed_liquidity  = EXCLUDED.seed_liquidity,
            start_time      = EXCLUDED.start_time,
            end_time        = EXCLUDED.end_time,
            amm_mode        = EXCLUDED.amm_mode,
            resolver_type   = EXCLUDED.resolver_type,
            resolver_config = EXCLUDED.resolver_config,
            sport           = EXCLUDED.sport,
            league          = EXCLUDED.league,
            outcome_images  = EXCLUDED.outcome_images,
            category_tags   = EXCLUDED.category_tags,
            geo_tags        = EXCLUDED.geo_tags,
            topic_tags      = EXCLUDED.topic_tags,
            status          = CASE
              WHEN protocol_pending_markets.status = 'rejected'
               AND protocol_pending_markets.reviewer = 'system'
               AND protocol_pending_markets.admin_note LIKE 'auto-%'
              THEN 'pending'
              ELSE protocol_pending_markets.status
            END,
            admin_note      = CASE
              WHEN protocol_pending_markets.status = 'rejected'
               AND protocol_pending_markets.reviewer = 'system'
               AND protocol_pending_markets.admin_note LIKE 'auto-%'
              THEN NULL
              ELSE protocol_pending_markets.admin_note
            END,
            reviewer        = CASE
              WHEN protocol_pending_markets.status = 'rejected'
               AND protocol_pending_markets.reviewer = 'system'
               AND protocol_pending_markets.admin_note LIKE 'auto-%'
              THEN NULL
              ELSE protocol_pending_markets.reviewer
            END,
            reviewed_at     = CASE
              WHEN protocol_pending_markets.status = 'rejected'
               AND protocol_pending_markets.reviewer = 'system'
               AND protocol_pending_markets.admin_note LIKE 'auto-%'
              THEN NULL
              ELSE protocol_pending_markets.reviewed_at
            END
        WHERE protocol_pending_markets.status = 'pending'
           OR (
             protocol_pending_markets.status = 'rejected'
             AND protocol_pending_markets.reviewer = 'system'
             AND protocol_pending_markets.admin_note LIKE 'auto-%'
           )
        RETURNING id, (xmax = 0) AS inserted
      `;
      if (result.length > 0) {
        if (result[0].inserted) inserted += 1;
        else updated += 1;
      } else {
        skipped += 1;
      }
    } catch (e) {
      console.error('[run-generators] protocol insert failed', {
        source: s.source,
        source_event_id: s.source_event_id,
        message: e?.message,
      });
      skipped += 1;
    }
  }
  return { inserted, updated, skipped };
}
