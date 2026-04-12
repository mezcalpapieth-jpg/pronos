// Shared allow-list for imported Polymarket markets. The MVP should only pull
// markets that are relevant to sports (excluding esports), politics, finance,
// or Latin America.

const ESPORTS_TERMS = [
  'esports', 'e-sports', 'e sports', 'gaming', 'video game', 'video games',
  'valorant', 'league of legends', 'dota', 'dota 2', 'counter strike',
  'counter-strike', 'cs2', 'csgo', 'overwatch', 'rocket league', 'fortnite',
  'minecraft', 'call of duty', 'warzone', 'pubg', 'free fire', 'rainbow six',
  'apex legends', 'starcraft', 'mobile legends', 'twitch rivals',
];

const SPORTS_TERMS = [
  'sports', 'sport', 'soccer', 'football', 'futbol', 'basketball',
  'baseball', 'tennis', 'golf', 'boxing', 'mma', 'ufc', 'wwe', 'formula 1',
  'f1', 'motogp', 'nascar', 'olympics', 'world cup', 'fifa', 'uefa', 'concacaf',
  'conmebol', 'copa america', 'copa libertadores', 'copa sudamericana',
  'champions league', 'premier league', 'la liga', 'serie a', 'bundesliga',
  'liga mx', 'mls', 'nba', 'nfl', 'mlb', 'nhl', 'wnba', 'ncaa', 'ucl',
  'europa league', 'euro 2028', 'super bowl', 'world series', 'grand slam',
  'wimbledon', 'us open', 'australian open', 'french open',
];

const POLITICS_TERMS = [
  'politics', 'political', 'election', 'elections', 'vote', 'voting',
  'president', 'presidential', 'congress', 'senate', 'parliament', 'government',
  'minister', 'prime minister', 'mayor', 'governor', 'cabinet', 'policy',
  'referendum', 'impeachment', 'campaign', 'poll', 'approval rating',
  'tariff', 'sanction', 'ceasefire', 'war', 'peace deal', 'supreme court',
  'trump', 'biden', 'vance', 'democrat', 'republican',
];

const FINANCE_TERMS = [
  'finance', 'financial', 'economy', 'economic', 'inflation', 'cpi', 'ppi',
  'gdp', 'recession', 'fed', 'federal reserve', 'central bank', 'interest rate',
  'rate cut', 'rate hike', 'stock', 'stocks', 'equities', 'earnings', 'ipo',
  'etf', 'bond', 'bonds', 'treasury', 'yield', 'nasdaq', 'dow', 's&p',
  'sp500', 's p 500', 'oil', 'gold', 'silver', 'dollar', 'usd', 'peso',
  'mxn', 'brl', 'ars', 'forex', 'currency', 'bitcoin', 'btc', 'ethereum',
  'eth', 'solana', 'sol', 'crypto', 'cryptocurrency', 'token', 'stablecoin',
  'usdc', 'usdt', 'binance', 'coinbase',
];

const LATAM_TERMS = [
  'latin america', 'latam', 'latinoamerica', 'latino', 'hispanic',
  'mexico', 'mexican', 'cdmx', 'monterrey', 'guadalajara', 'cancun',
  'argentina', 'argentinian', 'brazil', 'brasil', 'brazilian', 'chile',
  'colombia', 'colombian', 'peru', 'peruvian', 'venezuela', 'venezuelan',
  'ecuador', 'bolivia', 'paraguay', 'uruguay', 'costa rica', 'panama',
  'guatemala', 'honduras', 'el salvador', 'nicaragua', 'dominican republic',
  'dominican', 'cuba', 'cuban', 'puerto rico', 'sheinbaum', 'amlo', 'morena',
  'milei', 'lula', 'petro', 'maduro', 'bukele', 'bolsonaro',
];

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectTags(market) {
  const tags = market?.tags || market?._tags || [];
  if (!Array.isArray(tags)) return [];
  return tags
    .map(tag => {
      if (typeof tag === 'string') return tag;
      return tag?.label || tag?.slug || tag?.name || tag?.id || '';
    })
    .filter(Boolean);
}

export function getPolymarketSearchText(market) {
  const parts = [
    market?.title,
    market?.title_en,
    market?.question,
    market?.description,
    market?._description,
    market?.category,
    market?.categoryLabel,
    market?._categoryRaw,
    market?.slug,
    market?.id,
    ...collectTags(market),
  ];
  return normalize(parts.filter(Boolean).join(' '));
}

function containsTerm(text, term) {
  const normalized = normalize(term).trim();
  if (!normalized) return false;
  const pattern = normalized.split(/\s+/).map(escapeRegex).join('[\\s_-]+');
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`).test(text);
}

function matchesAny(text, terms) {
  return terms.some(term => containsTerm(text, term));
}

export function getPolymarketImportReason(market) {
  const text = getPolymarketSearchText(market);
  if (!text) return null;
  if (matchesAny(text, ESPORTS_TERMS)) return null;
  if (matchesAny(text, LATAM_TERMS)) return 'latin-america';
  if (matchesAny(text, SPORTS_TERMS)) return 'sports';
  if (matchesAny(text, POLITICS_TERMS)) return 'politics';
  if (matchesAny(text, FINANCE_TERMS)) return 'finance';
  return null;
}

export function isRelevantPolymarketMarket(market) {
  return !!getPolymarketImportReason(market);
}

export function filterRelevantPolymarketMarkets(markets) {
  return (markets || []).filter(m => {
    if (!m || m._source !== 'polymarket') return true;
    return isRelevantPolymarketMarket(m);
  });
}
