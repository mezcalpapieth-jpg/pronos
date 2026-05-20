import {
  marketInCategory,
  marketInGeo,
  marketInTopic,
} from './mvpCategoryFilters.js';

export const CATEGORIES = [
  { key: 'general', label: 'General' },
  { key: 'mexico', label: 'Mexico & Latam' },
  { key: 'politica', label: 'Política' },
  { key: 'deportes', label: 'Deportes' },
  { key: 'finanzas', label: 'Finanzas' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'musica', label: 'Música' },
  { key: 'world-cup', label: 'Copa del Mundo' },
];

export const MARKET_CATEGORY_FILTERS = [
  { key: 'all', label: 'Todas' },
  ...CATEGORIES,
];

export const DEFAULT_CATEGORY_ICONS = {
  general: '📊',
  mexico: '🇲🇽',
  politica: '🗳️',
  deportes: '⚽',
  finanzas: '📈',
  crypto: '₿',
  musica: '🎵',
  'world-cup': '🏆',
};

export const ADMIN_SPORT_FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'soccer', label: 'Fútbol' },
  { key: 'baseball', label: 'Béisbol' },
  { key: 'nba', label: 'NBA' },
  { key: 'nfl', label: 'NFL' },
  { key: 'f1', label: 'F1' },
  { key: 'tennis', label: 'Tenis' },
  { key: 'golf', label: 'Golf' },
  { key: 'combate', label: 'Combate' },
];

export const ADMIN_SOCCER_LEAGUES = [
  { key: 'all', label: 'Todas' },
  { key: 'uefa-cl', label: 'UEFA Champions' },
  { key: 'uefa-europa-league', label: 'Europa League' },
  { key: 'uefa-conference-league', label: 'Conference League' },
  { key: 'la-liga', label: 'La Liga' },
  { key: 'premier-league', label: 'Premier' },
  { key: 'serie-a', label: 'Serie A' },
  { key: 'bundesliga', label: 'Bundesliga' },
  { key: 'copa-libertadores', label: 'Libertadores' },
  { key: 'liga-mx', label: 'Liga MX' },
  { key: 'mls', label: 'MLS' },
];

export const ADMIN_BASEBALL_LEAGUES = [
  { key: 'all', label: 'Todas' },
  { key: 'mlb', label: 'MLB' },
  { key: 'lmb', label: 'LMB' },
  { key: 'lmp', label: 'LMP' },
];

export const ADMIN_COMBATE_LEAGUES = [
  { key: 'all', label: 'Todas' },
  { key: 'ufc', label: 'UFC' },
  { key: 'boxing', label: 'Boxeo' },
];

export const ADMIN_CRYPTO_FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'general', label: 'Eventos' },
  { key: '5min', label: '5 minutos' },
];

export const ADMIN_GEO_FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'mexico', label: 'México' },
  { key: 'latam', label: 'Latam' },
];

export const MARKET_CREATION_GEO_OPTIONS = [
  { key: 'mexico', label: 'México' },
  { key: 'latam', label: 'Latam' },
  { key: 'world', label: 'Mundo' },
];

export const ADMIN_MEXICO_TOPIC_FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'general', label: 'General' },
  { key: 'politica', label: 'Política' },
  { key: 'deportes', label: 'Deportes' },
  { key: 'finanzas', label: 'Finanzas' },
  { key: 'musica', label: 'Música' },
  { key: 'weather', label: 'Clima' },
];

export const MARKET_CREATION_TOPIC_OPTIONS = ADMIN_MEXICO_TOPIC_FILTERS
  .filter(t => t.key !== 'all');

export const MARKET_CREATION_SPORT_OPTIONS = [
  { key: '', label: '— ninguno —' },
  ...ADMIN_SPORT_FILTERS.filter(s => s.key !== 'all'),
];

export const MARKET_CREATION_LEAGUE_BY_SPORT = {
  soccer: [
    { key: '', label: '— ninguna —' },
    ...ADMIN_SOCCER_LEAGUES.filter(l => l.key !== 'all'),
  ],
  baseball: [
    { key: '', label: '— ninguna —' },
    ...ADMIN_BASEBALL_LEAGUES.filter(l => l.key !== 'all'),
  ],
  combate: [
    { key: '', label: '— ninguna —' },
    ...ADMIN_COMBATE_LEAGUES.filter(l => l.key !== 'all'),
  ],
};

function lower(value) {
  return String(value || '').toLowerCase();
}

export function filterProtocolAdminMarkets(rows = [], {
  categoryFilter = 'all',
  sportFilter = 'all',
  leagueFilter = 'all',
  cryptoTypeFilter = 'all',
  geoFilter = 'all',
  topicFilter = 'all',
} = {}) {
  return rows.filter((market) => {
    if (!marketInCategory(market, categoryFilter)) return false;

    if (categoryFilter === 'mexico') {
      if (!marketInGeo(market, geoFilter)) return false;
      if (!marketInTopic(market, topicFilter)) return false;
      return true;
    }

    if (categoryFilter === 'deportes') {
      if (sportFilter !== 'all' && lower(market?.sport) !== sportFilter) return false;
      if (
        leagueFilter !== 'all'
        && (sportFilter === 'soccer' || sportFilter === 'baseball' || sportFilter === 'combate')
        && lower(market?.league) !== leagueFilter
      ) {
        return false;
      }
    }

    if (categoryFilter === 'crypto' && cryptoTypeFilter !== 'all') {
      if (cryptoTypeFilter === '5min' && market?.crypto5min !== true) return false;
      if (cryptoTypeFilter === 'general' && market?.crypto5min === true) return false;
    }

    return true;
  });
}
