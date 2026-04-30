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
import { generateChartsMarkets }        from './market-gen/charts.js';
import { generateYouTubeMarkets }       from './market-gen/youtube.js';
import { generateEntertainmentMarkets } from './market-gen/entertainment.js';
import { generateWorldCupMarkets }      from './market-gen/world-cup.js';
import { generateLmbMarkets }           from './market-gen/lmb.js';
import { generateTennisMarkets }        from './market-gen/tennis.js';
import { generateGolfMarkets }          from './market-gen/golf.js';
import { generateLivMarkets }           from './market-gen/liv.js';
import { generateF1SeasonMarkets }      from './market-gen/f1-season.js';

export const GENERATORS = [
  { name: 'soccer',         run: generateSoccerMarkets        },
  { name: 'espn-soccer',    run: generateEspnSoccerMarkets    },
  { name: 'crypto',         run: generateCryptoMarkets        },
  { name: 'stocks',         run: generateStockMarkets         },
  { name: 'fx',             run: generateFxMarkets            },
  { name: 'fuel',           run: generateFuelMarkets          },
  { name: 'weather',        run: generateWeatherMarkets       },
  { name: 'mlb',            run: generateMlbMarkets           },
  { name: 'nba',            run: generateNbaMarkets           },
  { name: 'f1',             run: generateF1Markets            },
  { name: 'charts',         run: generateChartsMarkets        },
  { name: 'youtube',        run: generateYouTubeMarkets       },
  { name: 'entertainment',  run: generateEntertainmentMarkets },
  { name: 'world-cup',      run: generateWorldCupMarkets      },
  { name: 'lmb',            run: generateLmbMarkets            },
  { name: 'tennis',         run: generateTennisMarkets         },
  { name: 'golf',           run: generateGolfMarkets           },
  { name: 'liv',            run: generateLivMarkets            },
  { name: 'f1-season',      run: generateF1SeasonMarkets       },
];

export async function runAllGenerators() {
  const allSpecs = [];
  const sourceStats = {};
  for (const gen of GENERATORS) {
    try {
      const specs = await gen.run();
      sourceStats[gen.name] = { count: Array.isArray(specs) ? specs.length : 0 };
      if (Array.isArray(specs)) allSpecs.push(...specs);
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
      const result = await sql`
        INSERT INTO points_pending_markets
          (source, source_event_id, source_data, question, category, icon,
           outcomes, seed_liquidity, start_time, end_time, amm_mode,
           resolver_type, resolver_config, sport, league, outcome_images)
        VALUES (
          ${s.source},
          ${s.source_event_id},
          ${s.source_data ? JSON.stringify(s.source_data) : null}::jsonb,
          ${s.question},
          ${s.category},
          ${s.icon || null},
          ${JSON.stringify(s.outcomes)}::jsonb,
          ${s.seed_liquidity ?? 1000},
          ${s.start_time || null},
          ${s.end_time},
          ${s.amm_mode || 'unified'},
          ${s.resolver_type || null},
          ${s.resolver_config ? JSON.stringify(s.resolver_config) : null}::jsonb,
          ${s.sport || null},
          ${s.league || null},
          ${s.outcome_images ? JSON.stringify(s.outcome_images) : null}::jsonb
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
            outcome_images  = EXCLUDED.outcome_images
        WHERE points_pending_markets.status = 'pending'
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
