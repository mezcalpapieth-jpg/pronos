export const CATEGORIES = [
  { key: 'general',  label: 'General' },
  { key: 'mexico',   label: 'Mexico & Latam' },
  { key: 'politica', label: 'Politica' },
  { key: 'deportes', label: 'Deportes' },
  { key: 'finanzas', label: 'Finanzas' },
  { key: 'crypto',   label: 'Crypto' },
  { key: 'musica',   label: 'Musica' },
];

export const MARKET_CATEGORY_FILTERS = [
  { key: 'all', label: 'Todas' },
  ...CATEGORIES,
];

export const ADMIN_SPORT_FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'soccer', label: 'Futbol' },
  { key: 'baseball', label: 'Beisbol' },
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
  { key: 'la-liga', label: 'La Liga' },
  { key: 'premier-league', label: 'Premier' },
  { key: 'serie-a', label: 'Serie A' },
  { key: 'bundesliga', label: 'Bundesliga' },
  { key: 'liga-mx', label: 'Liga MX' },
  { key: 'mls', label: 'MLS' },
];

export const ADMIN_BASEBALL_LEAGUES = [
  { key: 'all', label: 'Todas' },
  { key: 'mlb', label: 'MLB' },
  { key: 'lmb', label: 'LMB' },
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
  { key: 'mexico', label: 'Mexico' },
  { key: 'latam', label: 'Latam' },
];

export const ADMIN_MEXICO_TOPIC_FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'general', label: 'General' },
  { key: 'politica', label: 'Politica' },
  { key: 'deportes', label: 'Deportes' },
  { key: 'finanzas', label: 'Finanzas' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'musica', label: 'Musica' },
  { key: 'weather', label: 'Weather' },
];

export function buildAdminMarketsQuery({
  status = 'all',
  categoryFilter = 'all',
  sportFilter = 'all',
  leagueFilter = 'all',
  cryptoTypeFilter = 'all',
  geoFilter = 'all',
  topicFilter = 'all',
} = {}) {
  const q = new URLSearchParams({ status });
  if (categoryFilter !== 'all') q.set('category', categoryFilter);

  if (categoryFilter === 'mexico') {
    if (geoFilter !== 'all') q.set('geo', geoFilter);
    if (topicFilter !== 'all') q.set('topic', topicFilter);
    return q;
  }

  if (categoryFilter === 'deportes') {
    if (sportFilter !== 'all') q.set('sport', sportFilter);
    if (
      leagueFilter !== 'all'
      && (sportFilter === 'soccer' || sportFilter === 'baseball' || sportFilter === 'combate')
    ) {
      q.set('league', leagueFilter);
    }
  }

  if (categoryFilter === 'crypto' && cryptoTypeFilter !== 'all') {
    q.set('crypto_type', cryptoTypeFilter);
  }

  return q;
}

export function formatAdminMarketDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
