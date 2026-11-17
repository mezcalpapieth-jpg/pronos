import { FESTIVAL_SOURCE } from '../../shared/trading-festival.js';
import { normalizeSportsTeamName } from '../../shared/sports-team-names.js';
import { PRONOS_TREASURY_USERNAME } from './points-limit-orders.js';
import { applySeriesGateToMarket, normalizeSeriesMeta } from './series-markets.js';

const GENERIC_OUTCOMES = new Set(['si', 'yes', 'no', 'draw', 'tie', 'empate', 'mas', 'menos', 'over', 'under']);
const ENTITY_FIELDS = ['entity', 'entityName', 'asset', 'symbol', 'ticker', 'coinId', 'mint', 'city'];

function marketIdentity(row) {
  const config = row.resolver_config || {};
  const data = row.source_data || {};
  const series = normalizeSeriesMeta({ resolverConfig: config, sourceData: data, row });
  const events = new Set();
  function addEvent(source, id) {
    if (source && id != null && String(id).trim()) events.add(`${source}:${id}`);
  }
  addEvent(row.source, row.source_event_id);
  addEvent(row.source, data.eventId);
  addEvent(row.source, data.matchId);
  addEvent(config.source || row.source, config.eventId);
  addEvent(config.source || row.source, config.matchId);
  addEvent(config.espnFallback?.source || 'espn', config.espnFallback?.eventId);

  const teams = [series?.homeTeam, series?.awayTeam, data.home, data.away, config.homeTeam, config.awayTeam];
  const teamNames = [
    ...teams.flatMap(team => typeof team === 'string' ? [team] : [team?.name, team?.shortName, team?.espn]),
    data.homeName, data.awayName, config.homeName, config.awayName,
  ];
  if (row.sport && row.outcomes?.length >= 2 && row.outcomes.length <= 3) {
    teamNames.push(...row.outcomes);
  }
  const teamKeys = new Set(teamNames.map(normalizeSportsTeamName)
    .filter(team => team && !GENERIC_OUTCOMES.has(team)));
  for (const id of [data.home?.id, data.away?.id, config.homeId, config.awayId, ...teams.map(team => team?.id)]) {
    if (row.source && id != null && id !== '') teamKeys.add(`${row.source}:${id}`);
  }

  const entities = new Set(ENTITY_FIELDS.flatMap(key => [config[key], data[key]])
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim().toLowerCase()));
  return { series, events, teamKeys, entities, sport: row.sport || series?.sport, category: row.category };
}

function sharesValue(left, right) {
  return [...left].some(value => right.has(value));
}

function relatedRank(anchor, candidate) {
  if ((anchor.series?.key && anchor.series.key === candidate.series?.key) || sharesValue(anchor.events, candidate.events)) {
    return 0;
  }
  const sameSport = !anchor.sport || !candidate.sport || anchor.sport === candidate.sport;
  if ((sameSport && sharesValue(anchor.teamKeys, candidate.teamKeys)) || sharesValue(anchor.entities, candidate.entities)) {
    return 1;
  }
  return anchor.category && anchor.category === candidate.category ? 2 : null;
}

export async function findRelatedMarketIds(sql, relatedTo, limit) {
  const rows = await sql`
    WITH anchor AS (
      SELECT id FROM points_markets
      WHERE id = ${relatedTo}
        AND parent_id IS NULL
        AND archived_at IS NULL
        AND COALESCE(mode, 'points') = 'points'
        AND source IS DISTINCT FROM ${FESTIVAL_SOURCE}
    ), pending_metadata AS (
      SELECT DISTINCT ON (approved_market_id) approved_market_id, source_data
      FROM points_pending_markets
      WHERE approved_market_id IS NOT NULL
      ORDER BY approved_market_id, id DESC
    )
    SELECT m.id, m.category, m.outcomes, m.source, m.source_event_id,
           m.resolver_config, m.start_time, m.sport, m.league, m.status,
           p.source_data
    FROM anchor
    JOIN points_markets m ON m.id = anchor.id OR (
      m.status = 'active'
      AND m.parent_id IS NULL
      AND m.archived_at IS NULL
      AND COALESCE(m.mode, 'points') = 'points'
      AND m.source IS DISTINCT FROM ${FESTIVAL_SOURCE}
      AND (m.hidden_from_home IS NOT TRUE OR m.tournament_featured IS TRUE)
      AND (m.end_time IS NULL OR m.end_time > NOW())
      AND (m.resolver_config->>'shape' IS DISTINCT FROM 'binary-direction' OR m.start_time <= NOW())
    )
    LEFT JOIN pending_metadata p ON p.approved_market_id = m.id
  `;
  const anchorRow = rows.find(row => Number(row.id) === relatedTo);
  if (!anchorRow) return [];
  const anchor = marketIdentity(anchorRow);
  const ranked = rows.flatMap(row => {
    if (row.id === anchorRow.id) return [];
    const candidate = marketIdentity(row);
    const rank = relatedRank(anchor, candidate);
    if (rank == null || applySeriesGateToMarket(row, candidate.series).status !== 'active') return [];
    return [{ id: Number(row.id), rank }];
  });
  if (!ranked.length) return [];

  const candidateIds = ranked.map(item => item.id);
  const volumes = await sql`
    SELECT COALESCE(m.parent_id, m.id) AS id, SUM(ABS(t.collateral)) AS volume
    FROM points_markets m
    JOIN points_trades t ON t.market_id = m.id AND t.username <> ${PRONOS_TREASURY_USERNAME}
    WHERE m.id = ANY(${candidateIds}::int[])
       OR (m.parent_id = ANY(${candidateIds}::int[]) AND m.status <> 'canceled')
    GROUP BY COALESCE(m.parent_id, m.id)
  `;
  const volumeById = new Map(volumes.map(row => [Number(row.id), Number(row.volume)]));
  return ranked
    .sort((a, b) => a.rank - b.rank || (volumeById.get(b.id) || 0) - (volumeById.get(a.id) || 0) || a.id - b.id)
    .slice(0, limit)
    .map(item => item.id);
}
