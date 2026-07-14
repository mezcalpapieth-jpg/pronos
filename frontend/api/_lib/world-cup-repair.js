import { initialReserves } from './amm-math.js';
import { withTransaction } from './db-tx.js';
import { badgeUrl, GROUP_FIXTURES, GROUPS, teamByEspnCode, TEAMS } from './world-cup-2026.js';

export const WORLD_CUP_ESPN_LEAGUE_PATH = 'soccer/fifa.world';
export const WORLD_CUP_ESPN_DATE_RANGE = '20260611-20260719';
export const WORLD_CUP_REPAIR_ACTOR = 'repair:espn-world-cup';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const WC_TAGS = {
  categoryTags: ['world-cup'],
  geoTags: [],
  topicTags: ['world-cup'],
};

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function cleanString(value) {
  const text = String(value || '').trim();
  return text.length > 0 ? text : null;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function namesMatch(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function ymdFromIso(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

function addHoursIso(value, hours) {
  const ms = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + hours * 3600_000).toISOString();
}

function competition(event) {
  return Array.isArray(event?.competitions) ? event.competitions[0] : null;
}

function competitors(event) {
  const comp = competition(event);
  const rows = Array.isArray(comp?.competitors) ? comp.competitors : [];
  return {
    home: rows.find(c => c.homeAway === 'home') || rows[0] || null,
    away: rows.find(c => c.homeAway === 'away') || rows[1] || null,
  };
}

function scoreNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function teamFromCompetitor(c) {
  const abbreviation = cleanString(c?.team?.abbreviation)?.toLowerCase() || null;
  const mapped = teamByEspnCode(abbreviation);
  if (mapped) {
    return {
      key: mapped.key,
      flagCode: mapped.code,
      espn: mapped.espn,
      name: mapped.name,
      espnName: cleanString(c?.team?.shortDisplayName)
        || cleanString(c?.team?.displayName)
        || cleanString(c?.team?.name)
        || cleanString(c?.team?.abbreviation)
        || mapped.name,
      logo: cleanString(c?.team?.logo) || cleanString(c?.team?.logos?.[0]?.href) || badgeUrl(mapped),
    };
  }
  const display = cleanString(c?.team?.shortDisplayName)
    || cleanString(c?.team?.displayName)
    || cleanString(c?.team?.name)
    || cleanString(c?.displayName)
    || abbreviation;
  return {
    key: abbreviation || normalizeName(display),
    flagCode: null,
    espn: abbreviation,
    name: display || 'Equipo',
    espnName: display || abbreviation,
    logo: cleanString(c?.team?.logo) || cleanString(c?.team?.logos?.[0]?.href) || null,
  };
}

export async function fetchWorldCupEspnEvents({
  fetchImpl = fetch,
  dateRange = WORLD_CUP_ESPN_DATE_RANGE,
} = {}) {
  const url = `${ESPN_BASE}/${WORLD_CUP_ESPN_LEAGUE_PATH}/scoreboard?dates=${dateRange}&limit=500`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`espn-world-cup: HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.events)
    ? data.events.map(normalizeWorldCupEspnEvent).filter(Boolean)
    : [];
}

export function normalizeWorldCupEspnEvent(event) {
  const comp = competition(event);
  if (!comp) return null;
  const { home, away } = competitors(event);
  if (!home || !away) return null;
  const status = event?.status || comp?.status || {};
  const state = cleanString(status?.type?.state);
  const completed = Boolean(status?.type?.completed || state === 'post');
  const homeScore = scoreNumber(home?.score);
  const awayScore = scoreNumber(away?.score);
  let winner = null;
  if (completed) {
    if (home?.winner) winner = 'home';
    else if (away?.winner) winner = 'away';
    else if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
      winner = homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw';
    }
  }
  const dateYmd = ymdFromIso(event?.date);
  return {
    eventId: String(event?.id || comp?.id || ''),
    date: event?.date || null,
    dateYmd,
    round: inferWorldCupRound(event),
    completed,
    state,
    statusLabel: cleanString(status?.type?.shortDetail)
      || cleanString(status?.type?.description)
      || cleanString(status?.type?.name)
      || state,
    home: { ...teamFromCompetitor(home), score: homeScore },
    away: { ...teamFromCompetitor(away), score: awayScore },
    winner,
  };
}

export function inferWorldCupRound(eventOrDate) {
  const season = typeof eventOrDate === 'object' && eventOrDate !== null
    ? eventOrDate.season
    : null;
  const label = String(season?.slug || season?.name || '').toLowerCase();
  if (label.includes('group')) return 'group';
  if (label.includes('round-of-32') || label.includes('round of 32')) return 'r32';
  if (label.includes('round-of-16') || label.includes('round of 16')) return 'r16';
  if (label.includes('quarter')) return 'qf';
  if (label.includes('semi')) return 'sf';
  if (label.includes('3rd') || label.includes('third')) return 'third';
  if (label === 'final' || label.endsWith(', final') || label.includes(' final')) return 'final';

  const dateYmd = typeof eventOrDate === 'string' ? eventOrDate : ymdFromIso(eventOrDate?.date);
  if (!dateYmd) return 'unknown';
  if (dateYmd <= '2026-06-27') return 'group';
  if (dateYmd <= '2026-07-03') return 'r32';
  if (dateYmd <= '2026-07-07') return 'r16';
  if (dateYmd <= '2026-07-12') return 'qf';
  if (dateYmd <= '2026-07-15') return 'sf';
  if (dateYmd === '2026-07-18') return 'third';
  if (dateYmd === '2026-07-19') return 'final';
  return 'knockout';
}

function roundLabel(round) {
  return {
    r32: 'Dieciseisavos',
    r16: 'Octavos',
    qf: 'Cuartos de final',
    sf: 'Semifinal',
    third: 'Tercer lugar',
    final: 'Final',
  }[round] || 'Eliminatoria';
}

function sameFixture(fixture, event) {
  const home = TEAMS[fixture.homeCode];
  const away = TEAMS[fixture.awayCode];
  if (!home || !away) return false;
  const homeMatches = event.home.espn === home.espn || event.away.espn === home.espn;
  const awayMatches = event.home.espn === away.espn || event.away.espn === away.espn;
  return homeMatches && awayMatches;
}

export function findGroupEventForFixture(fixture, events) {
  return events.find(event => event.round === 'group' && sameFixture(fixture, event)) || null;
}

function groupFixtureScores(fixture, event) {
  if (!event) return { homeScore: null, awayScore: null };
  const home = TEAMS[fixture.homeCode];
  const sameOrientation = event.home.espn === home?.espn;
  return sameOrientation
    ? { homeScore: event.home.score, awayScore: event.away.score }
    : { homeScore: event.away.score, awayScore: event.home.score };
}

export function groupFixtureWinnerIndex(fixture, event) {
  if (!event?.completed) return null;
  if (event.winner === 'draw') return 1;
  const winnerTeam = event.winner === 'home' ? event.home : event.away;
  if (winnerTeam.espn === TEAMS[fixture.homeCode]?.espn) return 0;
  if (winnerTeam.espn === TEAMS[fixture.awayCode]?.espn) return 2;
  return null;
}

export function finalScoreForGroupFixture(fixture, event) {
  const home = TEAMS[fixture.homeCode];
  const away = TEAMS[fixture.awayCode];
  const { homeScore, awayScore } = groupFixtureScores(fixture, event);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
  return `${home.name} ${homeScore}-${awayScore} ${away.name}`;
}

export function buildWorldCupGroupSpec(fixture, event = null) {
  const home = TEAMS[fixture.homeCode];
  const away = TEAMS[fixture.awayCode];
  if (!home || !away) return null;
  const startTime = event?.date || fixture.kickoffIso;
  const dateYmd = ymdFromIso(startTime);
  const endTime = addHoursIso(startTime, 2) || addHoursIso(fixture.kickoffIso, 2);
  return {
    source: 'fifa-wc-2026',
    source_event_id: fixture.matchId,
    question: `${home.name} vs ${away.name}`,
    category: 'world-cup',
    icon: '🏆',
    outcomes: [home.name, 'Empate', away.name],
    outcome_images: [badgeUrl(home), null, badgeUrl(away)],
    seed_liquidity: 1000,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'unified',
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'espn',
      leaguePath: WORLD_CUP_ESPN_LEAGUE_PATH,
      eventId: event?.eventId || null,
      dateYmd,
      homeName: home.espn,
      awayName: away.espn,
      matchId: fixture.matchId,
      group: fixture.group,
      matchday: fixture.matchday,
      shape: 'draw3',
    },
    sport: 'soccer',
    league: 'world-cup',
    source_data: {
      matchId: fixture.matchId,
      eventId: event?.eventId || null,
      competitionCode: 'WC',
      group: fixture.group,
      round: fixture.round,
      matchday: fixture.matchday,
      venue: fixture.venue,
      kickoffIso: fixture.kickoffIso,
      kickoffUtc: startTime,
      home: { code: fixture.homeCode, flagCode: home.code, espn: home.espn, name: home.name },
      away: { code: fixture.awayCode, flagCode: away.code, espn: away.espn, name: away.name },
    },
    ...WC_TAGS,
  };
}

export function buildWorldCupKnockoutSpec(event) {
  if (!event || event.round === 'group' || event.round === 'unknown') return null;
  if (event.round === 'third' || event.round === 'final') return null;
  if (event.dateYmd > '2026-07-15') return null;
  const home = event.home;
  const away = event.away;
  const startTime = event.date;
  const endTime = addHoursIso(startTime, 4);
  if (!startTime || !endTime) return null;
  return {
    source: 'fifa-wc-2026',
    source_event_id: `wc26-espn-${event.eventId}`,
    question: `${home.name} vs ${away.name}`,
    category: 'world-cup',
    icon: '🏆',
    outcomes: [home.name, away.name],
    outcome_images: [home.logo || badgeUrl(home), away.logo || badgeUrl(away)],
    seed_liquidity: 1000,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'unified',
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'espn',
      leaguePath: WORLD_CUP_ESPN_LEAGUE_PATH,
      eventId: event.eventId,
      dateYmd: event.dateYmd,
      homeName: home.espn || home.espnName || home.name,
      awayName: away.espn || away.espnName || away.name,
      round: event.round,
      shape: 'binary',
    },
    sport: 'soccer',
    league: 'world-cup',
    source_data: {
      eventId: event.eventId,
      competitionCode: 'WC',
      round: event.round,
      roundLabel: roundLabel(event.round),
      kickoffUtc: startTime,
      home: { code: home.key, flagCode: home.flagCode, espn: home.espn, name: home.name },
      away: { code: away.key, flagCode: away.flagCode, espn: away.espn, name: away.name },
    },
    ...WC_TAGS,
  };
}

export function knockoutWinnerIndex(event) {
  if (!event?.completed) return null;
  if (event.winner === 'home') return 0;
  if (event.winner === 'away') return 1;
  return null;
}

export function finalScoreForKnockout(event) {
  if (!event?.completed) return null;
  if (!Number.isFinite(event.home.score) || !Number.isFinite(event.away.score)) return null;
  return `${event.home.name} ${event.home.score}-${event.away.score} ${event.away.name}`;
}

export function computeEspnGroupStandings(events) {
  const byGroup = {};
  for (const g of GROUPS) {
    byGroup[g.key] = g.teams.map(code => {
      const team = TEAMS[code];
      return {
        code,
        name: team?.name || code,
        espn: team?.espn || null,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        gf: 0,
        ga: 0,
        gd: 0,
      };
    });
  }

  for (const fixture of GROUP_FIXTURES) {
    const event = findGroupEventForFixture(fixture, events);
    if (!event?.completed) continue;
    const homeRow = byGroup[fixture.group]?.find(t => t.code === fixture.homeCode);
    const awayRow = byGroup[fixture.group]?.find(t => t.code === fixture.awayCode);
    if (!homeRow || !awayRow) continue;
    const { homeScore, awayScore } = groupFixtureScores(fixture, event);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;
    homeRow.played += 1;
    awayRow.played += 1;
    homeRow.gf += homeScore;
    homeRow.ga += awayScore;
    awayRow.gf += awayScore;
    awayRow.ga += homeScore;
    if (homeScore > awayScore) {
      homeRow.wins += 1; homeRow.points += 3; awayRow.losses += 1;
    } else if (awayScore > homeScore) {
      awayRow.wins += 1; awayRow.points += 3; homeRow.losses += 1;
    } else {
      homeRow.draws += 1; awayRow.draws += 1; homeRow.points += 1; awayRow.points += 1;
    }
  }

  for (const rows of Object.values(byGroup)) {
    for (const row of rows) row.gd = row.gf - row.ga;
    rows.sort((a, b) =>
      (b.points - a.points)
      || (b.gd - a.gd)
      || (b.gf - a.gf)
      || a.name.localeCompare(b.name, 'es')
    );
  }
  return byGroup;
}

function specsFromEvents(events) {
  const groupSpecs = GROUP_FIXTURES.map(fixture => ({
    fixture,
    event: findGroupEventForFixture(fixture, events),
    spec: buildWorldCupGroupSpec(fixture, findGroupEventForFixture(fixture, events)),
  })).filter(x => x.spec);
  const knockoutSpecs = events
    .map(event => ({ event, spec: buildWorldCupKnockoutSpec(event) }))
    .filter(x => x.spec);
  return { groupSpecs, knockoutSpecs };
}

async function readWorldCupRows(sql) {
  const pendingRows = await sql`
    SELECT p.*,
           m.id AS market_id,
           m.status AS market_status,
           m.outcome AS market_outcome,
           m.amm_mode AS market_amm_mode
      FROM points_pending_markets p
      LEFT JOIN points_markets m ON m.id = p.approved_market_id
     WHERE p.category = 'world-cup'
        OR p.source = 'fifa-wc-2026'
     ORDER BY p.id ASC
  `;
  const marketRows = await sql`
    SELECT id, source, source_event_id, question, status, outcome, parent_id, amm_mode
      FROM points_markets
     WHERE category = 'world-cup'
       AND parent_id IS NULL
  `;
  return { pendingRows, marketRows };
}

function bySourceEventId(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.source_event_id) map.set(String(row.source_event_id), row);
  }
  return map;
}

export async function planWorldCupRepair({ sql, events }) {
  const { pendingRows, marketRows } = await readWorldCupRows(sql);
  const pendingBySource = bySourceEventId(pendingRows);
  const marketBySource = bySourceEventId(marketRows);
  const { groupSpecs, knockoutSpecs } = specsFromEvents(events);
  const standings = computeEspnGroupStandings(events);

  const groupResolverPatches = groupSpecs.filter(({ spec }) => {
    const row = pendingBySource.get(spec.source_event_id);
    return row?.approved_market_id && (row.resolver_type !== 'sports_api' || parseJsonb(row.resolver_config, {})?.source !== 'espn');
  });
  const groupMatchesToResolve = groupSpecs.filter(({ fixture, event, spec }) => {
    const row = pendingBySource.get(spec.source_event_id);
    return row?.approved_market_id && row.market_status === 'active' && event?.completed && groupFixtureWinnerIndex(fixture, event) != null;
  });
  const groupWinnerMarketsToResolve = GROUPS.filter(group => {
    const row = pendingBySource.get(`wc26-winner-group-${group.key}`);
    const winner = standings[group.key]?.[0];
    return row?.approved_market_id && row.market_status === 'active' && winner?.played >= 3;
  });
  const knockoutMarketsToCreate = knockoutSpecs.filter(({ spec }) => {
    const pending = pendingBySource.get(spec.source_event_id);
    const market = marketBySource.get(spec.source_event_id);
    return !market && !pending?.approved_market_id;
  });
  const knockoutMarketsToPatch = knockoutSpecs.filter(({ spec }) => {
    const pending = pendingBySource.get(spec.source_event_id);
    const market = marketBySource.get(spec.source_event_id);
    return Boolean(market || pending?.approved_market_id);
  });
  const knockoutMarketsToResolve = knockoutSpecs.filter(({ event, spec }) => {
    const pending = pendingBySource.get(spec.source_event_id);
    const market = marketBySource.get(spec.source_event_id);
    const status = market?.status || pending?.market_status;
    return status === 'active' && event.completed && knockoutWinnerIndex(event) != null;
  });

  return {
    espnEvents: events.length,
    groupFixturesMatched: groupSpecs.filter(x => x.event).length,
    groupResolverPatches: groupResolverPatches.length,
    groupMatchesToResolve: groupMatchesToResolve.length,
    groupWinnerMarketsToResolve: groupWinnerMarketsToResolve.length,
    knockoutMarketsToCreate: knockoutMarketsToCreate.length,
    knockoutMarketsToPatch: knockoutMarketsToPatch.length,
    knockoutMarketsToResolve: knockoutMarketsToResolve.length,
    totalPlanned:
      groupResolverPatches.length
      + groupMatchesToResolve.length
      + groupWinnerMarketsToResolve.length
      + knockoutMarketsToCreate.length
      + knockoutMarketsToResolve.length,
    standings,
    samples: {
      knockout: knockoutSpecs.slice(0, 6).map(({ event, spec }) => ({
        eventId: event.eventId,
        round: event.round,
        question: spec.question,
        status: event.completed ? 'completed' : event.state || 'scheduled',
      })),
      group: groupSpecs.slice(0, 3).map(({ fixture, event, spec }) => ({
        matchId: fixture.matchId,
        question: spec.question,
        eventId: event?.eventId || null,
      })),
    },
    _internal: { pendingRows, marketRows, groupSpecs, knockoutSpecs, standings },
  };
}

function json(value) {
  return JSON.stringify(value ?? null);
}

async function patchPendingAndMarket(client, { row, marketId, spec }) {
  if (row?.id) {
    await client.query(
      `UPDATE points_pending_markets
          SET source_data = $1::jsonb,
              question = $2,
              icon = $3,
              outcomes = $4::jsonb,
              seed_liquidity = $5,
              start_time = $6,
              end_time = $7,
              amm_mode = $8,
              resolver_type = $9,
              resolver_config = $10::jsonb,
              sport = $11,
              league = $12,
              outcome_images = $13::jsonb,
              category_tags = $14::jsonb,
              geo_tags = $15::jsonb,
              topic_tags = $16::jsonb
        WHERE id = $17`,
      [
        json(spec.source_data),
        spec.question,
        spec.icon,
        json(spec.outcomes),
        spec.seed_liquidity,
        spec.start_time || null,
        spec.end_time,
        spec.amm_mode,
        spec.resolver_type,
        json(spec.resolver_config),
        spec.sport,
        spec.league,
        json(spec.outcome_images),
        json(spec.categoryTags),
        json(spec.geoTags),
        json(spec.topicTags),
        row.id,
      ],
    );
  }
  if (!marketId) return;
  await client.query(
    `UPDATE points_markets
        SET question = $1,
            category = $2,
            icon = $3,
            outcomes = $4::jsonb,
            seed_liquidity = $5,
            start_time = $6,
            end_time = $7,
            amm_mode = $8,
            resolver_type = $9,
            resolver_config = $10::jsonb,
            sport = $11,
            league = $12,
            outcome_images = $13::jsonb,
            category_tags = $14::jsonb,
            geo_tags = $15::jsonb,
            topic_tags = $16::jsonb,
            source = $17,
            source_event_id = $18
      WHERE id = $19`,
    [
      spec.question,
      spec.category,
      spec.icon,
      json(spec.outcomes),
      spec.seed_liquidity,
      spec.start_time || null,
      spec.end_time,
      spec.amm_mode,
      spec.resolver_type,
      json(spec.resolver_config),
      spec.sport,
      spec.league,
      json(spec.outcome_images),
      json(spec.categoryTags),
      json(spec.geoTags),
      json(spec.topicTags),
      spec.source,
      spec.source_event_id,
      marketId,
    ],
  );
}

async function resolveUnifiedMarket(client, { marketId, outcomeIndex, finalScore }) {
  if (!marketId || outcomeIndex == null) return false;
  const res = await client.query(
    `UPDATE points_markets
        SET status = 'resolved',
            outcome = $1,
            final_score = $2,
            resolved_at = COALESCE(resolved_at, NOW()),
            resolved_by = $3
      WHERE id = $4
        AND status = 'active'`,
    [outcomeIndex, finalScore || null, WORLD_CUP_REPAIR_ACTOR, marketId],
  );
  return res.rowCount > 0;
}

async function insertOrPatchKnockout(client, { pendingRow, marketRow, spec, event }) {
  let marketId = marketRow?.id || pendingRow?.approved_market_id || null;
  if (!marketId) {
    const status = event.completed && knockoutWinnerIndex(event) != null ? 'resolved' : 'active';
    const outcomeIndex = status === 'resolved' ? knockoutWinnerIndex(event) : null;
    const market = await client.query(
      `INSERT INTO points_markets
         (source, source_event_id, question, category, icon, outcomes, reserves, seed_liquidity,
          start_time, end_time, status, outcome, created_by, amm_mode,
          resolver_type, resolver_config, sport, league, outcome_images, featured,
          category_tags, geo_tags, topic_tags, final_score, resolved_at, resolved_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8,
               $9, $10, $11, $12, $13, $14,
               $15, $16::jsonb, $17, $18, $19::jsonb, TRUE,
               $20::jsonb, $21::jsonb, $22::jsonb, $23,
               CASE WHEN $11 = 'resolved' THEN NOW() ELSE NULL END,
               CASE WHEN $11 = 'resolved' THEN $24 ELSE NULL END)
       RETURNING id`,
      [
        spec.source,
        spec.source_event_id,
        spec.question,
        spec.category,
        spec.icon,
        json(spec.outcomes),
        json(initialReserves(spec.seed_liquidity, spec.outcomes.length)),
        spec.seed_liquidity,
        spec.start_time,
        spec.end_time,
        status,
        outcomeIndex,
        WORLD_CUP_REPAIR_ACTOR,
        spec.amm_mode,
        spec.resolver_type,
        json(spec.resolver_config),
        spec.sport,
        spec.league,
        json(spec.outcome_images),
        json(spec.categoryTags),
        json(spec.geoTags),
        json(spec.topicTags),
        status === 'resolved' ? finalScoreForKnockout(event) : null,
        WORLD_CUP_REPAIR_ACTOR,
      ],
    );
    marketId = market.rows[0].id;
  } else {
    await patchPendingAndMarket(client, { row: pendingRow, marketId, spec });
    if (event.completed) {
      await resolveUnifiedMarket(client, {
        marketId,
        outcomeIndex: knockoutWinnerIndex(event),
        finalScore: finalScoreForKnockout(event),
      });
    }
  }

  if (pendingRow?.id) {
    await patchPendingAndMarket(client, { row: pendingRow, marketId, spec });
    await client.query(
      `UPDATE points_pending_markets
          SET status = 'approved',
              admin_note = COALESCE(admin_note, 'auto-approved by World Cup ESPN repair'),
              reviewer = COALESCE(reviewer, $1),
              reviewed_at = COALESCE(reviewed_at, NOW()),
              approved_market_id = $2
        WHERE id = $3`,
      [WORLD_CUP_REPAIR_ACTOR, marketId, pendingRow.id],
    );
  } else {
    await client.query(
      `INSERT INTO points_pending_markets
         (source, source_event_id, source_data, question, category, icon, outcomes,
          seed_liquidity, start_time, end_time, amm_mode, resolver_type, resolver_config,
          status, admin_note, reviewer, reviewed_at, approved_market_id,
          sport, league, outcome_images, category_tags, geo_tags, topic_tags, featured)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb,
               $8, $9, $10, $11, $12, $13::jsonb,
               'approved', 'auto-approved by World Cup ESPN repair', $14, NOW(), $15,
               $16, $17, $18::jsonb, $19::jsonb, $20::jsonb, $21::jsonb, TRUE)
       ON CONFLICT (source, source_event_id) DO UPDATE
          SET source_data = EXCLUDED.source_data,
              question = EXCLUDED.question,
              outcomes = EXCLUDED.outcomes,
              start_time = EXCLUDED.start_time,
              end_time = EXCLUDED.end_time,
              resolver_type = EXCLUDED.resolver_type,
              resolver_config = EXCLUDED.resolver_config,
              status = 'approved',
              approved_market_id = COALESCE(points_pending_markets.approved_market_id, EXCLUDED.approved_market_id),
              sport = EXCLUDED.sport,
              league = EXCLUDED.league,
              outcome_images = EXCLUDED.outcome_images,
              category_tags = EXCLUDED.category_tags,
              geo_tags = EXCLUDED.geo_tags,
              topic_tags = EXCLUDED.topic_tags`,
      [
        spec.source,
        spec.source_event_id,
        json(spec.source_data),
        spec.question,
        spec.category,
        spec.icon,
        json(spec.outcomes),
        spec.seed_liquidity,
        spec.start_time,
        spec.end_time,
        spec.amm_mode,
        spec.resolver_type,
        json(spec.resolver_config),
        WORLD_CUP_REPAIR_ACTOR,
        marketId,
        spec.sport,
        spec.league,
        json(spec.outcome_images),
        json(spec.categoryTags),
        json(spec.geoTags),
        json(spec.topicTags),
      ],
    );
  }
  return marketId;
}

export async function runWorldCupRepair({ sql, dry = true, events = null } = {}) {
  if (!sql) throw new Error('world-cup-repair: missing sql');
  const espnEvents = events || await fetchWorldCupEspnEvents();
  const plan = await planWorldCupRepair({ sql, events: espnEvents });
  if (dry) {
    const { _internal, ...publicPlan } = plan;
    return { ok: true, dryRun: true, ...publicPlan };
  }

  const {
    pendingRows,
    marketRows,
    groupSpecs,
    knockoutSpecs,
    standings,
  } = plan._internal;
  const pendingBySource = bySourceEventId(pendingRows);
  const marketBySource = bySourceEventId(marketRows);
  const applied = {
    groupResolverPatches: 0,
    groupMatchesResolved: 0,
    groupWinnerMarketsResolved: 0,
    knockoutMarketsCreatedOrPatched: 0,
    knockoutMarketsResolved: 0,
  };

  await withTransaction(async (client) => {
    for (const { fixture, event, spec } of groupSpecs) {
      const row = pendingBySource.get(spec.source_event_id);
      if (!row?.approved_market_id) continue;
      await patchPendingAndMarket(client, { row, marketId: row.approved_market_id, spec });
      applied.groupResolverPatches += 1;
      if (event?.completed) {
        const resolved = await resolveUnifiedMarket(client, {
          marketId: row.approved_market_id,
          outcomeIndex: groupFixtureWinnerIndex(fixture, event),
          finalScore: finalScoreForGroupFixture(fixture, event),
        });
        if (resolved) applied.groupMatchesResolved += 1;
      }
    }

    for (const group of GROUPS) {
      const row = pendingBySource.get(`wc26-winner-group-${group.key}`);
      const ordered = standings[group.key] || [];
      const winner = ordered[0];
      if (!row?.approved_market_id || row.market_status !== 'active' || !winner || winner.played < 3) continue;
      const outcomes = parseJsonb(row.outcomes, []);
      const winnerIdx = outcomes.findIndex(label => namesMatch(label, winner.name));
      if (winnerIdx < 0) continue;
      const finalScore = `Grupo ${group.key}: ${winner.name} (${winner.points} pts, ${winner.gd >= 0 ? '+' : ''}${winner.gd} DG)`;
      const resolved = await resolveUnifiedMarket(client, {
        marketId: row.approved_market_id,
        outcomeIndex: winnerIdx,
        finalScore,
      });
      if (!resolved) continue;
      const legs = await client.query(
        `SELECT id, leg_label FROM points_markets WHERE parent_id = $1 ORDER BY id ASC`,
        [row.approved_market_id],
      );
      for (const leg of legs.rows) {
        const isWinner = namesMatch(leg.leg_label, winner.name);
        await client.query(
          `UPDATE points_markets
              SET status = 'resolved',
                  outcome = $1,
                  final_score = $2,
                  resolved_at = COALESCE(resolved_at, NOW()),
                  resolved_by = $3
            WHERE id = $4
              AND status = 'active'`,
          [isWinner ? 0 : 1, finalScore, WORLD_CUP_REPAIR_ACTOR, leg.id],
        );
      }
      applied.groupWinnerMarketsResolved += 1;
    }

    for (const { event, spec } of knockoutSpecs) {
      const pending = pendingBySource.get(spec.source_event_id) || null;
      const market = marketBySource.get(spec.source_event_id) || null;
      const preStatus = market?.status || pending?.market_status || null;
      const willResolve = event.completed
        && knockoutWinnerIndex(event) != null
        && (!preStatus || preStatus === 'active');
      await insertOrPatchKnockout(client, { pendingRow: pending, marketRow: market, spec, event });
      applied.knockoutMarketsCreatedOrPatched += 1;
      if (willResolve) applied.knockoutMarketsResolved += 1;
    }
  });

  const { _internal, ...publicPlan } = plan;
  return {
    ok: true,
    dryRun: false,
    ...publicPlan,
    applied,
  };
}
