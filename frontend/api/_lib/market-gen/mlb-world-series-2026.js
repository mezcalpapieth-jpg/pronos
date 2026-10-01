const SOURCE = 'mlb-world-series-2026';
const SOURCE_EVENT_ID = 'world-series-winner-2026';
const CLOSE_ISO = '2026-11-01T05:59:59.000Z';

const MLB_POSTSEASON_SCHEDULE_URL = 'https://www.mlb.com/live-stream-games/postseason/2026-schedule';
const MLB_BRACKET_URL = 'https://www.mlb.com/postseason/bracket-schedule';
const MLB_SCHEDULE_NEWS_URL = 'https://www.mlb.com/news/2026-mlb-playoff-and-world-series-schedule';

function espnLogo(id) {
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${id}.png`;
}

const CONTENDERS = [
  { slug: 'cleveland-guardians', name: 'Cleveland Guardians', abbr: 'CLE', espnTeamId: 5, league: 'AL' },
  { slug: 'chicago-white-sox', name: 'Chicago White Sox', abbr: 'CWS', espnTeamId: 4, league: 'AL' },
  { slug: 'tampa-bay-rays', name: 'Tampa Bay Rays', abbr: 'TB', espnTeamId: 30, league: 'AL' },
  { slug: 'new-york-yankees', name: 'New York Yankees', abbr: 'NYY', espnTeamId: 10, league: 'AL' },
  { slug: 'milwaukee-brewers', name: 'Milwaukee Brewers', abbr: 'MIL', espnTeamId: 8, league: 'NL' },
  { slug: 'san-diego-padres', name: 'San Diego Padres', abbr: 'SD', espnTeamId: 25, league: 'NL' },
  { slug: 'los-angeles-dodgers', name: 'Los Angeles Dodgers', abbr: 'LAD', espnTeamId: 19, league: 'NL' },
  { slug: 'philadelphia-phillies', name: 'Philadelphia Phillies', abbr: 'PHI', espnTeamId: 22, league: 'NL' },
  { slug: 'atlanta-braves', name: 'Atlanta Braves', abbr: 'ATL', espnTeamId: 15, league: 'NL' },
];

const EVIDENCE = [
  {
    title: 'MLB.TV 2026 Postseason Schedule',
    url: MLB_POSTSEASON_SCHEDULE_URL,
    note: 'Lists World Series Game 7 on October 31, 2026, if necessary.',
  },
  {
    title: 'MLB Postseason Bracket Schedule',
    url: MLB_BRACKET_URL,
    note: 'Shows the current postseason bracket and remaining confirmed Division Series teams.',
  },
  {
    title: 'MLB 2026 Playoff and World Series schedule',
    url: MLB_SCHEDULE_NEWS_URL,
    note: 'Confirms October 31, 2026 as the possible Game 7 date.',
  },
];

const RESOLUTION_CRITERIA_ES = [
  'Se resuelve con el equipo que MLB declare campeon oficial de la Serie Mundial 2026.',
  'Si la Serie Mundial se cancela, MLB no declara campeon, o hay una contingencia no cubierta por las reglas oficiales, el mercado pasa a revision manual.',
].join(' ');

const RESOLUTION_CRITERIA_EN = [
  'Resolves to the team MLB declares the official 2026 World Series champion.',
  'If the World Series is canceled, MLB does not declare a champion, or an uncovered official-rules contingency occurs, the market goes to manual review.',
].join(' ');

function uniformProbabilities(count) {
  return Array.from({ length: count }, () => 1 / count);
}

export async function generateMlbWorldSeries2026Markets() {
  const outcomes = CONTENDERS.map(team => team.name);
  const probabilities = uniformProbabilities(outcomes.length);

  return [{
    source: SOURCE,
    source_event_id: SOURCE_EVENT_ID,
    sport: 'baseball',
    league: 'mlb',
    question: '¿Quién ganará la Serie Mundial de MLB 2026?',
    category: 'deportes',
    icon: '⚾',
    outcomes,
    outcome_images: CONTENDERS.map(team => espnLogo(team.espnTeamId)),
    seed_liquidity: 1000,
    start_time: null,
    end_time: CLOSE_ISO,
    amm_mode: 'parallel',
    resolver_type: 'manual',
    resolver_config: {
      source: 'manual',
      shape: 'parallel',
      competition: 'mlb-world-series',
      season: 2026,
      criteria: RESOLUTION_CRITERIA_ES,
      criteriaEn: RESOLUTION_CRITERIA_EN,
      evidence: EVIDENCE,
      legs: CONTENDERS.map(team => ({
        label: team.name,
        slug: team.slug,
        abbr: team.abbr,
        league: team.league,
        espnTeamId: team.espnTeamId,
      })),
    },
    featured: true,
    tournament_featured: true,
    source_data: {
      kind: 'mlb_world_series_winner',
      season: 2026,
      generatedAt: new Date().toISOString(),
      closeLocal: {
        date: '2026-10-31',
        timezone: 'America/Mexico_City',
        rationale: 'Cierre al final del dia local de Mexico para cubrir el posible Juego 7 de Serie Mundial.',
      },
      tournament: {
        key: 'october-2026',
        label: 'Torneo octubre 2026',
      },
      teams: CONTENDERS,
      currentFieldSource: 'mlb-official-postseason-bracket',
      resolutionCriteria: RESOLUTION_CRITERIA_ES,
      resolutionCriteriaEn: RESOLUTION_CRITERIA_EN,
      evidence: EVIDENCE,
      sourceUrls: EVIDENCE.map(item => item.url),
      translations: {
        es: {
          question: '¿Quién ganará la Serie Mundial de MLB 2026?',
          outcomes,
        },
        en: {
          question: 'Who will win the 2026 MLB World Series?',
          outcomes,
        },
      },
      categorization: {
        categoryTags: ['deportes'],
        geoTags: ['world'],
        topicTags: ['deportes'],
      },
      suggestedPricing: {
        source: 'admin-config',
        probabilities,
        probabilityPct: probabilities.map(value => Math.round(value * 1000) / 10),
        rationale: 'Campo vivo de playoffs con precio inicial uniforme hasta que exista flujo de usuarios.',
        evidence: EVIDENCE,
      },
    },
  }];
}

export const _internal = {
  CLOSE_ISO,
  CONTENDERS,
  EVIDENCE,
  RESOLUTION_CRITERIA_ES,
  RESOLUTION_CRITERIA_EN,
  SOURCE,
  SOURCE_EVENT_ID,
};
