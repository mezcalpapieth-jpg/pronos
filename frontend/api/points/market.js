/**
 * GET /api/points/market?id=<id>
 *
 * Single market + its current reserves + derived prices. Used by the
 * detail page to render the ring chart and buy buttons.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices } from '../_lib/amm-math.js';
import {
  buildSeriesDetail,
  normalizeSeriesMeta,
  seriesSubtitle,
  teamPairKeyFromMeta,
} from '../_lib/series-markets.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function pricesFromReserves(reserves, outcomeCount) {
  if (!Array.isArray(reserves) || reserves.length === 0) {
    return Array.from({ length: outcomeCount || 2 }, () => 1 / (outcomeCount || 2));
  }
  if (reserves.length === 2) return binaryPrices(reserves);
  const invs = reserves.map(r => (Number(r) > 0 ? 1 / Number(r) : 0));
  const total = invs.reduce((s, v) => s + v, 0) || 1;
  return invs.map(v => v / total);
}

function cryptoMetaFromResolverConfig(resolverCfg) {
  if (resolverCfg?.shape !== 'binary-direction') return null;
  return {
    asset:            resolverCfg.asset            || null,
    symbol:           resolverCfg.symbol           || null,
    coinbaseProductId:resolverCfg.coinbaseProductId|| null,
    threshold:        resolverCfg.threshold == null ? null : Number(resolverCfg.threshold),
    openPrice:        resolverCfg.openPrice  == null ? null : Number(resolverCfg.openPrice),
    closePrice:       resolverCfg.closePrice == null ? null : Number(resolverCfg.closePrice),
    openedAt:         resolverCfg.openedAt          || null,
    closesAt:         resolverCfg.closesAt          || null,
    rounding:         resolverCfg.rounding          || 1,
  };
}

function summarizeCryptoMarketRow(row) {
  const resolverCfg = parseJsonb(row.resolver_config, null);
  const cryptoMeta = cryptoMetaFromResolverConfig(resolverCfg);
  if (!cryptoMeta) return null;
  const outcomes = parseJsonb(row.outcomes, ['SUBE', 'BAJA']);
  const reserves = parseJsonb(row.reserves, []).map(Number);
  return {
    id: row.id,
    question: row.question,
    outcomes,
    prices: pricesFromReserves(reserves, outcomes.length),
    status: row.status,
    outcome: row.outcome,
    resolvedAt: row.resolved_at,
    finalScore: row.final_score || null,
    startTime: row.start_time,
    endTime: row.end_time,
    cryptoMeta,
  };
}

function publicSeriesMetaFromRow(row, { requireGameNumber = true } = {}) {
  const resolverCfg = parseJsonb(row.resolver_config, null);
  const sourceData = parseJsonb(row.pending_source_data, null);
  const meta = normalizeSeriesMeta({ resolverConfig: resolverCfg, sourceData, row });
  if (!meta) return null;
  if (requireGameNumber && !meta.gameNumber) return null;
  return {
    key: meta.key,
    leaguePath: meta.leaguePath,
    league: meta.league,
    sport: meta.sport,
    gameNumber: meta.gameNumber,
    bestOf: meta.bestOf,
    winTarget: meta.winTarget,
    guaranteedGames: meta.guaranteedGames,
    round: meta.round,
    seasonYear: meta.seasonYear,
    homeTeam: meta.homeTeam,
    awayTeam: meta.awayTeam,
    teams: meta.teams,
    subtitle: seriesSubtitle({ gameNumber: meta.gameNumber }),
  };
}

function summarizeSeriesMarketRow(row, fallbackMeta) {
  const outcomes = parseJsonb(row.outcomes, ['Sí', 'No']);
  const rawMeta = publicSeriesMetaFromRow(row, { requireGameNumber: false });
  return {
    id: row.id,
    question: row.question,
    outcomes,
    status: row.status,
    outcome: row.outcome,
    resolvedAt: row.resolved_at,
    finalScore: row.final_score || null,
    startTime: row.start_time,
    endTime: row.end_time,
    seriesMeta: {
      ...fallbackMeta,
      gameNumber: rawMeta?.gameNumber || null,
    },
  };
}

async function loadSeriesDetail(sqlClient, currentRow, currentMeta) {
  if (!currentMeta?.leaguePath) return null;
  const currentPair = teamPairKeyFromMeta(currentMeta);
  if (!currentPair) return null;
  const anchor = currentRow.start_time || currentRow.end_time || currentRow.created_at;
  if (!anchor) return null;

  const rows = await sqlClient`
    SELECT m.id, m.question, m.outcomes, m.start_time, m.end_time,
           m.status, m.outcome, m.resolved_at, m.final_score,
           m.resolver_config, m.sport, m.league,
           pm.source_data AS pending_source_data
    FROM points_markets m
    LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
    WHERE m.parent_id IS NULL
      AND m.resolver_type = 'sports_api'
      AND m.resolver_config->>'source' = 'espn'
      AND m.resolver_config->>'leaguePath' = ${currentMeta.leaguePath}
      AND m.start_time >= ${anchor}::timestamptz - INTERVAL '45 days'
      AND m.start_time <= ${anchor}::timestamptz + INTERVAL '45 days'
    ORDER BY m.start_time ASC NULLS LAST, m.id ASC
    LIMIT 80
  `;

  const siblings = rows
    .map((row) => {
      const meta = publicSeriesMetaFromRow(row, { requireGameNumber: false });
      if (!meta || meta.leaguePath !== currentMeta.leaguePath) return null;
      if (teamPairKeyFromMeta(meta) !== currentPair) return null;
      return summarizeSeriesMarketRow(row, currentMeta);
    })
    .filter(Boolean);

  if (siblings.length === 0) return null;
  const detail = buildSeriesDetail(currentMeta, siblings);
  if (!detail) return null;
  const currentItem = detail.sequence?.find(item => Number(item.id) === Number(currentRow.id));
  const gameNumber = currentItem?.gameNumber || detail.gameNumber || currentMeta.gameNumber || null;
  return {
    ...detail,
    gameNumber,
    subtitle: currentItem?.subtitle || seriesSubtitle({ gameNumber, summary: detail.summary }),
  };
}

export default async function handler(req, res) {
  // Top-level try/catch guarantees JSON output — see markets.js for
  // details on why this matters.
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const id = parseInt(req.query.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid_id' });
    }

    try {
      await ensurePointsSchema(schemaSql);

      const rows = await sql`
        SELECT m.*, pm.source_data AS pending_source_data,
          (SELECT COALESCE(SUM(collateral), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
        FROM points_markets m
        LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
        WHERE m.id = ${id}
        LIMIT 1
      `;
      if (rows.length === 0) {
        return res.status(404).json({ error: 'market_not_found' });
      }
      const r = rows[0];
      // Legs are not directly addressable — always redirect through the
      // parent so the detail page sees the full group.
      if (r.parent_id) {
        return res.status(404).json({ error: 'market_not_found', detail: 'leg; use parent id' });
      }

      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      const ammMode = r.amm_mode || 'unified';
      const outcomeImagesRaw = parseJsonb(r.outcome_images, null);
      const outcomeImages = Array.isArray(outcomeImagesRaw) && outcomeImagesRaw.length === outcomes.length
        ? outcomeImagesRaw
        : null;

      // Expose resolver metadata in a minimal shape — just the type +
      // source name from the config, nothing auth-related. Frontend
      // maps (type, source) → a human label ("Chainlink", "ESPN", …).
      const resolverCfg = parseJsonb(r.resolver_config, null);
      const resolverType = r.resolver_type || null;
      const resolverSource = resolverCfg?.source || null;
      const baseSeriesMeta = publicSeriesMetaFromRow(r);
      const seriesMeta = baseSeriesMeta
        ? await loadSeriesDetail(sql, r, baseSeriesMeta).catch(() => baseSeriesMeta)
        : null;

      // Crypto-5min direction markets ship a small public metadata
      // bundle so the live-chart UI can render threshold + asset
      // without needing to refetch resolver_config separately.
      // Fields here are display-only — feedAddress / chainId stay
      // server-side. Null for any other market shape.
      let cryptoMeta = cryptoMetaFromResolverConfig(resolverCfg);
      if (cryptoMeta) {
        cryptoMeta = {
          ...cryptoMeta,
          nextMarketId: null,  // populated below when a pending sibling exists
          prevMarketId: null,  // populated below when an older sibling is still on the books
          marketSequence: [],
          alternateAssetMarket: null,
        };
      }

      // Look up sibling 5-min windows for the same asset so the detail
      // page can render Próximo / Anterior CTAs and the user can hop
      // between consecutive markets without bouncing back to the grid.
      // Lifecycle:
      //   - The cron pre-creates each upcoming window as 'pending' a
      //     full window before activation, so an active market almost
      //     always has a nextMarketId.
      //   - Resolved markets stay on the books for 24h (archive window)
      //     before being soft-deleted; during that time the next market
      //     can still find them via prevMarketId for back-navigation.
      if (cryptoMeta && r.end_time) {
        try {
          const sib = await sql`
            SELECT id FROM points_markets
            WHERE resolver_config->>'source' = 'chainlink'
              AND resolver_config->>'shape'  = 'binary-direction'
              AND resolver_config->>'asset'  = ${cryptoMeta.asset || ''}
              AND start_time = ${r.end_time}
              AND id <> ${r.id}
              AND archived_at IS NULL
            ORDER BY id DESC
            LIMIT 1
          `;
          if (sib.length > 0) {
            cryptoMeta = { ...cryptoMeta, nextMarketId: sib[0].id };
          }
        } catch { /* surfacing this as a hard failure isn't worth it */ }
      }
      if (cryptoMeta && r.start_time) {
        try {
          const prev = await sql`
            SELECT id FROM points_markets
            WHERE resolver_config->>'source' = 'chainlink'
              AND resolver_config->>'shape'  = 'binary-direction'
              AND resolver_config->>'asset'  = ${cryptoMeta.asset || ''}
              AND end_time = ${r.start_time}
              AND id <> ${r.id}
              AND archived_at IS NULL
            ORDER BY id DESC
            LIMIT 1
          `;
          if (prev.length > 0) {
            cryptoMeta = { ...cryptoMeta, prevMarketId: prev[0].id };
          }
        } catch { /* same — best-effort */ }
      }
      if (cryptoMeta && r.start_time) {
        try {
          const sequenceRows = await sql`
            SELECT id, question, outcomes, reserves, start_time, end_time,
                   status, outcome, resolved_at, final_score, resolver_config
            FROM points_markets
            WHERE resolver_config->>'source' = 'chainlink'
              AND resolver_config->>'shape'  = 'binary-direction'
              AND resolver_config->>'asset'  = ${cryptoMeta.asset || ''}
              AND start_time >= ${r.start_time}::timestamptz - INTERVAL '15 minutes'
              AND start_time <= ${r.start_time}::timestamptz + INTERVAL '15 minutes'
              AND archived_at IS NULL
            ORDER BY start_time ASC, id ASC
            LIMIT 9
          `;
          const marketSequence = sequenceRows
            .map(summarizeCryptoMarketRow)
            .filter(Boolean);
          if (marketSequence.length > 0) {
            cryptoMeta = { ...cryptoMeta, marketSequence };
          }
        } catch { /* best-effort; the main market payload is enough to render */ }
      }
      if (cryptoMeta && r.start_time) {
        const alternateAsset = cryptoMeta.asset === 'btc'
          ? 'eth'
          : cryptoMeta.asset === 'eth'
            ? 'btc'
            : null;
        if (alternateAsset) {
          try {
            const alternateRows = await sql`
              SELECT id, resolver_config
              FROM points_markets
              WHERE resolver_config->>'source' = 'chainlink'
                AND resolver_config->>'shape'  = 'binary-direction'
                AND resolver_config->>'asset'  = ${alternateAsset}
                AND start_time = ${r.start_time}
                AND archived_at IS NULL
              ORDER BY id DESC
              LIMIT 1
            `;
            if (alternateRows.length > 0) {
              const altMeta = cryptoMetaFromResolverConfig(parseJsonb(alternateRows[0].resolver_config, null));
              cryptoMeta = {
                ...cryptoMeta,
                alternateAssetMarket: {
                  id: alternateRows[0].id,
                  asset: altMeta?.asset || alternateAsset,
                  symbol: altMeta?.symbol || (alternateAsset === 'eth' ? 'ETH/USD' : 'BTC/USD'),
                },
              };
            }
          } catch { /* optional affordance only */ }
        }
      }

      if (ammMode === 'parallel') {
        const legRows = await sql`
          SELECT l.id, l.leg_label, l.reserves, l.seed_liquidity, l.status, l.outcome,
            (SELECT COALESCE(SUM(collateral), 0) FROM points_trades t WHERE t.market_id = l.id) AS trade_volume
          FROM points_markets l
          WHERE l.parent_id = ${r.id}
          ORDER BY l.id ASC
        `;
        const legs = legRows.map((l, i) => {
          const lr = parseJsonb(l.reserves, []).map(Number);
          const lp = lr.length === 2 ? binaryPrices(lr) : [1 / outcomes.length, 1 - 1 / outcomes.length];
          return {
            id: l.id,
            outcomeIndex: i,
            label: l.leg_label || outcomes[i] || `Opción ${i + 1}`,
            reserves: lr,
            prices: lp,                     // [YES, NO] for the leg
            seedLiquidity: Number(l.seed_liquidity || 0),
            tradeVolume: Number(l.trade_volume || 0),
            status: l.status,
            outcome: l.outcome,             // 0 if this leg's YES won, 1 if NO won
          };
        });
        const seedTotal = legs.reduce((s, l) => s + l.seedLiquidity, 0);
        const tradeTotal = legs.reduce((s, l) => s + l.tradeVolume, 0);
        return res.status(200).json({
          market: {
            id: r.id,
            ammMode: 'parallel',
            question: r.question,
            category: r.category,
            icon: r.icon,
            outcomes,
            reserves: [],
            prices: legs.map(l => l.prices[0] ?? 1 / outcomes.length),
            seedLiquidity: seedTotal,
            volume: seedTotal,
            tradeVolume: tradeTotal,
            startTime: r.start_time,
            endTime: r.end_time,
            status: r.status,
            outcome: r.outcome,
            resolvedAt: r.resolved_at,
            finalScore: r.final_score || null,
            createdAt: r.created_at,
            resolverType,
            resolverSource,
            cryptoMeta,
            seriesMeta,
            sport: r.sport || null,
            league: r.league || null,
            outcomeImages,
            mode: r.mode || 'points',
            chainId: r.chain_id || null,
            chainMarketId: r.chain_market_id ? String(r.chain_market_id) : null,
            chainAddress: r.chain_address || null,
          },
          legs,
        });
      }

      const reserves = parseJsonb(r.reserves, []).map(Number);
      const prices = pricesFromReserves(reserves, outcomes.length);

      return res.status(200).json({
        market: {
          id: r.id,
          ammMode: 'unified',
          question: r.question,
          category: r.category,
          icon: r.icon,
          outcomes,
          reserves,
          prices,
          seedLiquidity: Number(r.seed_liquidity || 0),
          volume: Number(r.seed_liquidity || 0),
          tradeVolume: Number(r.trade_volume || 0),
          startTime: r.start_time,
          endTime: r.end_time,
          status: r.status,
          outcome: r.outcome,
          resolvedAt: r.resolved_at,
          finalScore: r.final_score || null,
          createdAt: r.created_at,
          resolverType,
          resolverSource,
          cryptoMeta,
          seriesMeta,
          sport: r.sport || null,
          league: r.league || null,
          outcomeImages,
          mode: r.mode || 'points',
          chainId: r.chain_id || null,
          chainMarketId: r.chain_market_id ? String(r.chain_market_id) : null,
          chainAddress: r.chain_address || null,
          archivedAt: r.archived_at || null,
        },
      });
    } catch (e) {
      console.error('[points/market] db error', { message: e?.message, code: e?.code });
      return res.status(500).json({
        error: 'db_unavailable',
        detail: e?.message?.slice(0, 240) || null,
      });
    }
  } catch (e) {
    console.error('[points/market] unhandled error', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'server_error',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
