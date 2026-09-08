export const MARKET_CATEGORY_IMAGE_PLACEHOLDERS = Object.freeze({
  general: '/market-placeholders/general.svg',
  mexico: '/market-placeholders/mexico.svg',
  politica: '/market-placeholders/politica.svg',
  deportes: '/market-placeholders/deportes.svg',
  finanzas: '/market-placeholders/finanzas.svg',
  crypto: '/market-placeholders/crypto.svg',
  musica: '/market-placeholders/musica.svg',
  'world-cup': '/market-placeholders/world-cup.svg',
  weather: '/market-placeholders/weather.svg',
  aicm: '/market-placeholders/aicm.svg',
});

const BADGE_DATA_URI_PREFIX = 'data:image/svg+xml;utf8,';
const BADGE_CACHE = new Map();

const BADGE_THEMES = Object.freeze({
  airport: {
    bg: '#13213f',
    bg2: '#2864a6',
    accent: '#8bd3ff',
    accent2: '#f7c948',
    text: '#ffffff',
    muted: '#c7e8ff',
  },
  weather: {
    bg: '#103344',
    bg2: '#2f7f8f',
    accent: '#f8d66d',
    accent2: '#9de7ff',
    text: '#f8fcff',
    muted: '#d7f5ff',
  },
  basketball: {
    bg: '#241515',
    bg2: '#b45309',
    accent: '#facc15',
    accent2: '#fff7ed',
    text: '#fff7ed',
    muted: '#fed7aa',
  },
  football: {
    bg: '#11221b',
    bg2: '#23704b',
    accent: '#f7c948',
    accent2: '#c6f6d5',
    text: '#f7fff9',
    muted: '#c6f6d5',
  },
  baseball: {
    bg: '#102039',
    bg2: '#1d4ed8',
    accent: '#ef4444',
    accent2: '#dbeafe',
    text: '#f8fbff',
    muted: '#dbeafe',
  },
  soccer: {
    bg: '#10251d',
    bg2: '#138f5d',
    accent: '#f4d35e',
    accent2: '#d1fae5',
    text: '#f7fff8',
    muted: '#d1fae5',
  },
  sportsBlue: {
    bg: '#101827',
    bg2: '#2155a3',
    accent: '#38bdf8',
    accent2: '#f8d66d',
    text: '#f8fbff',
    muted: '#dbeafe',
  },
  racing: {
    bg: '#20141c',
    bg2: '#7c2d12',
    accent: '#ffffff',
    accent2: '#ef4444',
    text: '#fffaf5',
    muted: '#fed7aa',
  },
  fight: {
    bg: '#21131a',
    bg2: '#8b1e3f',
    accent: '#f7c948',
    accent2: '#fecdd3',
    text: '#fff7fb',
    muted: '#fecdd3',
  },
  crypto: {
    bg: '#171717',
    bg2: '#3f3f46',
    accent: '#f4b740',
    accent2: '#7dd3fc',
    text: '#ffffff',
    muted: '#e7e5e4',
  },
  bitcoin: {
    bg: '#2b1605',
    bg2: '#b45309',
    accent: '#f7931a',
    accent2: '#fff3d6',
    text: '#fff8eb',
    muted: '#ffedd5',
  },
  ethereum: {
    bg: '#151b32',
    bg2: '#4f46e5',
    accent: '#8b9cff',
    accent2: '#c7d2fe',
    text: '#f8faff',
    muted: '#dbeafe',
  },
  solana: {
    bg: '#17111f',
    bg2: '#5b21b6',
    accent: '#14f195',
    accent2: '#80ecff',
    text: '#f9f5ff',
    muted: '#d8b4fe',
  },
  doge: {
    bg: '#201807',
    bg2: '#9a7a25',
    accent: '#d6b55f',
    accent2: '#fef3c7',
    text: '#fffbea',
    muted: '#fef3c7',
  },
  netflix: {
    bg: '#1f0709',
    bg2: '#8f1118',
    accent: '#e50914',
    accent2: '#ffe4e6',
    text: '#ffffff',
    muted: '#fecdd3',
  },
  youtube: {
    bg: '#210b0b',
    bg2: '#9f1239',
    accent: '#ff0033',
    accent2: '#ffffff',
    text: '#ffffff',
    muted: '#ffe4e6',
  },
  tv: {
    bg: '#201038',
    bg2: '#6d28d9',
    accent: '#f0abfc',
    accent2: '#d9f99d',
    text: '#fbf7ff',
    muted: '#e9d5ff',
  },
  music: {
    bg: '#12251d',
    bg2: '#0f766e',
    accent: '#34d399',
    accent2: '#fde68a',
    text: '#f6fffb',
    muted: '#ccfbf1',
  },
  film: {
    bg: '#15171f',
    bg2: '#334155',
    accent: '#f97316',
    accent2: '#fde68a',
    text: '#f8fafc',
    muted: '#e2e8f0',
  },
  finance: {
    bg: '#101c27',
    bg2: '#1d4b63',
    accent: '#5eead4',
    accent2: '#fef08a',
    text: '#f8ffff',
    muted: '#ccfbf1',
  },
  mexico: {
    bg: '#102018',
    bg2: '#117847',
    accent: '#d6273b',
    accent2: '#f8f4e3',
    text: '#fbfff9',
    muted: '#d1fae5',
  },
  politics: {
    bg: '#201625',
    bg2: '#7c3aed',
    accent: '#f8d66d',
    accent2: '#e9d5ff',
    text: '#fffaff',
    muted: '#f3e8ff',
  },
});

const SPORTS_LEAGUE_BADGES = Object.freeze([
  { key: 'league:nba', label: 'NBA', eyebrow: 'Basket', theme: 'basketball', aliases: ['nba', 'basketball-nba'] },
  { key: 'league:nfl', label: 'NFL', eyebrow: 'Football', theme: 'football', aliases: ['nfl', 'football-nfl'] },
  { key: 'league:mlb', label: 'MLB', eyebrow: 'Beisbol', theme: 'baseball', aliases: ['mlb', 'baseball-mlb'] },
  { key: 'league:lmb', label: 'LMB', eyebrow: 'Beisbol MX', theme: 'baseball', aliases: ['lmb', 'liga-mexicana-de-beisbol'] },
  { key: 'league:lmp', label: 'LMP', eyebrow: 'Pacifico', theme: 'baseball', aliases: ['lmp', 'liga-mexicana-del-pacifico'] },
  { key: 'league:liga-mx', label: 'LIGA MX', eyebrow: 'Futbol MX', theme: 'soccer', aliases: ['liga-mx', 'ligamx', 'mexico-liga-mx', 'soccer-mex-1'] },
  { key: 'league:mls', label: 'MLS', eyebrow: 'Soccer', theme: 'soccer', aliases: ['mls', 'soccer-usa-1'] },
  { key: 'league:premier-league', label: 'PL', eyebrow: 'Premier', theme: 'soccer', aliases: ['premier-league', 'epl', 'england-premier-league', 'soccer-eng-1'] },
  { key: 'league:la-liga', label: 'LALIGA', eyebrow: 'Espana', theme: 'soccer', aliases: ['la-liga', 'laliga', 'spain-la-liga', 'soccer-esp-1'] },
  { key: 'league:serie-a', label: 'SERIE A', eyebrow: 'Italia', theme: 'soccer', aliases: ['serie-a', 'italy-serie-a', 'soccer-ita-1'] },
  { key: 'league:bundesliga', label: 'BUND', eyebrow: 'Alemania', theme: 'soccer', aliases: ['bundesliga', 'germany-bundesliga', 'soccer-ger-1'] },
  { key: 'league:uefa-cl', label: 'UCL', eyebrow: 'Champions', theme: 'soccer', aliases: ['uefa-cl', 'uefa-champions-league', 'champions-league', 'soccer-uefa-champions'] },
  { key: 'league:uefa-europa', label: 'UEL', eyebrow: 'Europa', theme: 'soccer', aliases: ['uefa-europa', 'uefa-europa-league', 'europa-league', 'soccer-uefa-europa'] },
  { key: 'league:uefa-conference', label: 'UECL', eyebrow: 'Conference', theme: 'soccer', aliases: ['uefa-conference', 'uefa-conference-league', 'conference-league', 'soccer-uefa-europa-conf'] },
  { key: 'league:copa-libertadores', label: 'LIB', eyebrow: 'Conmebol', theme: 'soccer', aliases: ['copa-libertadores', 'libertadores', 'conmebol-libertadores', 'soccer-conmebol-libertadores'] },
  { key: 'league:leagues-cup', label: 'LCUP', eyebrow: 'Leagues', theme: 'soccer', aliases: ['leagues-cup'] },
  { key: 'league:world-cup', label: 'WORLD', eyebrow: 'Copa', theme: 'soccer', aliases: ['world-cup', 'fifa-world-cup', 'copa-del-mundo'] },
  { key: 'league:f1', label: 'F1', eyebrow: 'Racing', theme: 'racing', aliases: ['f1', 'formula-1', 'formula-one', 'racing-f1', 'motorsports-f1'] },
  { key: 'league:atp', label: 'ATP', eyebrow: 'Tennis', theme: 'sportsBlue', aliases: ['atp', 'tennis-atp'] },
  { key: 'league:pga', label: 'PGA', eyebrow: 'Golf', theme: 'sportsBlue', aliases: ['pga', 'golf-pga'] },
  { key: 'league:liv', label: 'LIV', eyebrow: 'Golf', theme: 'sportsBlue', aliases: ['liv', 'golf-liv'] },
  { key: 'league:ufc', label: 'UFC', eyebrow: 'MMA', theme: 'fight', aliases: ['ufc', 'mma-ufc'] },
  { key: 'league:boxing', label: 'BOX', eyebrow: 'Combate', theme: 'fight', aliases: ['boxing', 'boxeo', 'boxing-boxing'] },
]);

const SPORT_BADGES = Object.freeze([
  { key: 'sport:soccer', label: 'FUTBOL', eyebrow: 'Partido', theme: 'soccer', aliases: ['soccer', 'football', 'futbol'] },
  { key: 'sport:basketball', label: 'BASKET', eyebrow: 'Partido', theme: 'basketball', aliases: ['basketball', 'basquetbol'] },
  { key: 'sport:baseball', label: 'BEISBOL', eyebrow: 'Juego', theme: 'baseball', aliases: ['baseball', 'beisbol', 'mlb'] },
  { key: 'sport:f1', label: 'F1', eyebrow: 'Racing', theme: 'racing', aliases: ['f1', 'formula-1', 'formula-one'] },
  { key: 'sport:tennis', label: 'TENNIS', eyebrow: 'Match', theme: 'sportsBlue', aliases: ['tennis', 'tenis', 'atp'] },
  { key: 'sport:golf', label: 'GOLF', eyebrow: 'Torneo', theme: 'sportsBlue', aliases: ['golf', 'pga', 'liv'] },
  { key: 'sport:fight', label: 'FIGHT', eyebrow: 'Combate', theme: 'fight', aliases: ['mma', 'ufc', 'boxing', 'boxeo', 'combate'] },
]);

const CRYPTO_BADGES = Object.freeze([
  { key: 'coin:btc', label: 'BTC', eyebrow: 'Bitcoin', theme: 'bitcoin', aliases: ['btc', 'bitcoin', 'xbt', 'btc-usd', 'btcusd', 'btc-usdt'] },
  { key: 'coin:eth', label: 'ETH', eyebrow: 'Ethereum', theme: 'ethereum', aliases: ['eth', 'ethereum', 'eth-usd', 'ethusd', 'eth-usdt'] },
  { key: 'coin:sol', label: 'SOL', eyebrow: 'Solana', theme: 'solana', aliases: ['sol', 'solana', 'sol-usd', 'solusd', 'sol-usdt'] },
  { key: 'coin:doge', label: 'DOGE', eyebrow: 'Dogecoin', theme: 'doge', aliases: ['doge', 'dogecoin', 'doge-usd', 'dogeusd', 'doge-usdt'] },
  { key: 'coin:doggy', label: 'DOGGY', eyebrow: 'Token', theme: 'doge', aliases: ['doggy', 'holder', 'the-holder', 'holdr'] },
  { key: 'coin:mxnb', label: 'MXNB', eyebrow: 'Stablecoin', theme: 'crypto', aliases: ['mxnb', 'mxn-b', 'mxn'] },
]);

const ENTERTAINMENT_BADGES = Object.freeze([
  { key: 'source:netflix', label: 'NETFLIX', eyebrow: 'Top 10', theme: 'netflix', aliases: ['netflix', 'netflix-top10', 'tudum-top10'] },
  { key: 'source:youtube', label: 'YOUTUBE', eyebrow: 'Video', theme: 'youtube', glyph: 'play', aliases: ['youtube', 'youtube-trending-mx', 'youtube-official-captions', 'video', 'videos', 'views', 'reproducciones'] },
  { key: 'show:lcdlf', label: 'LCDLF', eyebrow: 'Reality', theme: 'tv', aliases: ['lcdlf', 'la-casa-de-los-famosos', 'casa-de-los-famosos', 'casa-famosos'] },
  { key: 'show:granja-vip', label: 'GRANJA VIP', eyebrow: 'Reality', theme: 'tv', aliases: ['granja-vip', 'la-granja-vip', 'granja-vip-official', 'granja-vip-elimination'] },
  { key: 'source:spotify', label: 'SPOTIFY', eyebrow: 'Charts', theme: 'music', aliases: ['spotify', 'spotify-mexico', 'spotify-global'] },
  { key: 'topic:music', label: 'TOP 50', eyebrow: 'Musica', theme: 'music', aliases: ['musica', 'music', 'song', 'songs', 'cancion', 'album', 'artist', 'artista', 'billboard'] },
  { key: 'topic:film', label: 'CINE', eyebrow: 'Pantalla', theme: 'film', aliases: ['cine', 'movie', 'movies', 'pelicula', 'taquilla', 'box-office', 'oscar', 'd23', 'marvel', 'disney'] },
  { key: 'topic:gaming', label: 'GAMING', eyebrow: 'Juego', theme: 'tv', aliases: ['gaming', 'gta', 'videojuego', 'game'] },
  { key: 'topic:concert', label: 'LIVE', eyebrow: 'Concierto', theme: 'music', aliases: ['concert', 'concierto', 'tour', 'tickets', 'boletos'] },
  { key: 'topic:tv', label: 'TV', eyebrow: 'Show', theme: 'tv', aliases: ['tv', 'serie', 'series', 'show', 'streaming', 'reality'] },
]);

const FINANCE_BADGES = Object.freeze([
  { key: 'source:banxico', label: 'BANXICO', eyebrow: 'MXN', theme: 'finance', aliases: ['banxico', 'banxico-fix', 'fix'] },
  { key: 'source:fx', label: 'FX', eyebrow: 'Divisas', theme: 'finance', aliases: ['frankfurter', 'usd-mxn', 'usdmxn', 'eur-mxn', 'eurmxn', 'dolar', 'dolares', 'peso'] },
  { key: 'source:stocks', label: 'STOCK', eyebrow: 'Bolsa', theme: 'finance', aliases: ['finnhub', 'stock', 'stocks', 'equity', 'acciones', 'nasdaq', 'nyse'] },
  { key: 'source:rates', label: 'FED', eyebrow: 'Tasas', theme: 'finance', aliases: ['fed', 'fomc', 'rates', 'tasa', 'tasas'] },
  { key: 'source:fuel', label: 'GAS', eyebrow: 'Energia', theme: 'finance', aliases: ['cre-gasolina', 'gasolina', 'diesel', 'fuel'] },
]);

const SPECIAL_BADGES = Object.freeze([
  { key: 'aicm', label: 'AICM', eyebrow: 'Aeropuerto', theme: 'airport', aliases: ['aicm', 'mex-airport', 'airport-mex'] },
  { key: 'weather', label: 'CLIMA', eyebrow: 'Tiempo', theme: 'weather', aliases: ['weather', 'weather-api', 'temperatura', 'lluvia', 'clima', 'wind', 'viento'] },
  { key: 'politica', label: 'POL', eyebrow: 'Politica', theme: 'politics', aliases: ['politica', 'politics', 'election', 'eleccion', 'gobierno', 'presidente', 'congreso'] },
  { key: 'mexico', label: 'MX', eyebrow: 'Mexico', theme: 'mexico', aliases: ['mexico', 'cdmx', 'mexicano', 'mexicana'] },
]);
const PRIORITY_SPECIAL_BADGES = Object.freeze(SPECIAL_BADGES.slice(0, 2));
const FALLBACK_SPECIAL_BADGES = Object.freeze(SPECIAL_BADGES.slice(2));

/**
 * True only inside the presentation demo (/demo), which renders markets with
 * no artwork at all.
 *
 * Clearing `imageUrl` in the demo data isn't enough on its own: every render
 * site falls back to a per-category placeholder, so ~90 cards end up carrying
 * nine repeated drawings. Read from sessionStorage rather than imported from
 * the demo module so this stays a two-line check in the shared bundle.
 */
export function marketArtworkHidden() {
  try {
    return window.sessionStorage.getItem('pronos-demo-live-seed') === '1';
  } catch {
    return false;
  }
}

export function cleanMarketImageRef(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^\/[a-z0-9][a-z0-9/_\-.%]*$/i.test(text) && !text.includes('..')) return text;
  return null;
}

function readObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeSlug(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeText(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textIncludesPhrase(text, phrase) {
  const haystack = ` ${normalizeText(text)} `;
  const needle = normalizeText(phrase);
  return needle ? haystack.includes(` ${needle} `) : false;
}

function compactString(value) {
  return normalizeSlug(value).replace(/-/g, '');
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function arrayValues(value) {
  return Array.isArray(value) ? value : [];
}

function marketMetadata(market = {}) {
  const resolverConfig = readObject(market?.resolverConfig ?? market?.resolver_config);
  const resolver = readObject(market?.resolver);
  const sourceData = readObject(market?.sourceData ?? market?.source_data ?? market?.pending_source_data);
  const categorization = readObject(sourceData?.categorization);
  const tokenMeta = readObject(market?.tokenMeta ?? market?.token_meta);
  const cryptoMeta = readObject(market?.cryptoMeta ?? market?.crypto_meta);
  const soccerMatchMeta = readObject(market?.soccerMatchMeta ?? market?.soccer_match_meta);
  const seriesMeta = readObject(market?.seriesMeta ?? market?.series_meta);

  const tags = [
    ...arrayValues(market?.categoryTags),
    ...arrayValues(market?.category_tags),
    ...arrayValues(market?.topicTags),
    ...arrayValues(market?.topic_tags),
    ...arrayValues(market?.geoTags),
    ...arrayValues(market?.geo_tags),
    ...arrayValues(categorization?.categoryTags),
    ...arrayValues(categorization?.topicTags),
    ...arrayValues(categorization?.geoTags),
  ];

  const fields = [
    market?.question,
    market?.category,
    market?.sport,
    market?.league,
    market?.source,
    market?.sourceEventId,
    market?.source_event_id,
    market?.resolverType,
    market?.resolver_type,
    market?.resolverSource,
    market?.resolver_source,
    resolver?.type,
    resolver?.source,
    resolver?.shape,
    resolver?.sport,
    resolver?.league,
    resolver?.symbol,
    resolver?.metric,
    resolverConfig?.source,
    resolverConfig?.shape,
    resolverConfig?.sport,
    resolverConfig?.league,
    resolverConfig?.leaguePath,
    resolverConfig?.symbol,
    resolverConfig?.asset,
    resolverConfig?.coinId,
    resolverConfig?.coinbaseProductId,
    resolverConfig?.pair,
    resolverConfig?.topic,
    resolverConfig?.kind,
    sourceData?.source,
    sourceData?.kind,
    sourceData?.topic,
    sourceData?.showLabel,
    sourceData?.seasonLabel,
    sourceData?.eventLabel,
    sourceData?.movie,
    sourceData?.franchise,
    sourceData?.platform,
    sourceData?.sourceUrl,
    sourceData?.marketType,
    tokenMeta?.symbol,
    tokenMeta?.coinId,
    cryptoMeta?.asset,
    cryptoMeta?.symbol,
    cryptoMeta?.coinbaseProductId,
    soccerMatchMeta?.leaguePath,
    soccerMatchMeta?.league,
    soccerMatchMeta?.sport,
    seriesMeta?.leaguePath,
    seriesMeta?.league,
    seriesMeta?.sport,
    ...tags,
  ];

  const text = fields.map(value => String(value || '')).filter(Boolean).join(' ');
  return {
    resolverConfig,
    resolver,
    sourceData,
    tokenMeta,
    cryptoMeta,
    soccerMatchMeta,
    seriesMeta,
    tags,
    text,
  };
}

function withDescriptorKey(prefix, descriptor) {
  return descriptor ? { ...descriptor, key: descriptor.key || prefix } : null;
}

function findBadgeFromValues(badges, values = [], fallbackText = '') {
  const normalizedValues = values
    .map(value => normalizeSlug(value))
    .filter(Boolean);
  const compactValues = values
    .map(value => compactString(value))
    .filter(Boolean);

  for (const badge of badges) {
    const aliases = badge.aliases || [];
    if (aliases.some(alias => normalizedValues.includes(normalizeSlug(alias)))) {
      return { ...badge };
    }
    if (aliases.some(alias => compactValues.includes(compactString(alias)))) {
      return { ...badge };
    }
  }

  for (const badge of badges) {
    const aliases = badge.aliases || [];
    if (aliases.some(alias => textIncludesPhrase(fallbackText, alias))) {
      return { ...badge };
    }
  }

  return null;
}

function sportBadgeDescriptor(market, meta) {
  const category = normalizeSlug(market?.category);
  const sport = firstString(
    market?.sport,
    meta.resolver?.sport,
    meta.resolverConfig?.sport,
    meta.soccerMatchMeta?.sport,
    meta.seriesMeta?.sport,
  );
  const league = firstString(
    market?.league,
    meta.resolver?.league,
    meta.resolverConfig?.league,
    meta.resolverConfig?.leaguePath,
    meta.soccerMatchMeta?.league,
    meta.soccerMatchMeta?.leaguePath,
    meta.seriesMeta?.league,
    meta.seriesMeta?.leaguePath,
  );

  const explicitSportsValues = [
    sport,
    league,
    meta.resolverConfig?.leaguePath,
    meta.soccerMatchMeta?.leaguePath,
    meta.seriesMeta?.leaguePath,
  ];
  const hasSportsSignal = category === 'deportes'
    || category === 'world-cup'
    || explicitSportsValues.some(Boolean)
    || textIncludesPhrase(meta.text, 'sports-api')
    || textIncludesPhrase(meta.text, 'espn');
  if (!hasSportsSignal) return null;

  const leagueBadge = findBadgeFromValues(SPORTS_LEAGUE_BADGES, explicitSportsValues, meta.text);
  if (leagueBadge) return leagueBadge;

  const sportBadge = findBadgeFromValues(SPORT_BADGES, [sport, league], meta.text);
  if (sportBadge) return sportBadge;

  return category === 'world-cup'
    ? { key: 'league:world-cup', label: 'WORLD', eyebrow: 'Copa', theme: 'soccer' }
    : null;
}

function cryptoSymbolFromMarket(market, meta) {
  const candidates = [
    market?.symbol,
    meta.resolver?.symbol,
    meta.resolverConfig?.symbol,
    meta.resolverConfig?.asset,
    meta.resolverConfig?.coinId,
    meta.resolverConfig?.coinbaseProductId,
    meta.resolverConfig?.pair,
    meta.tokenMeta?.symbol,
    meta.tokenMeta?.coinId,
    meta.cryptoMeta?.asset,
    meta.cryptoMeta?.symbol,
    meta.cryptoMeta?.coinbaseProductId,
    market?.sourceEventId,
    market?.source_event_id,
  ];
  for (const value of candidates) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    const compact = compactString(raw);
    const normalized = normalizeSlug(raw);
    const badge = findBadgeFromValues(CRYPTO_BADGES, [raw, compact, normalized], '');
    if (badge) return badge;
    const first = normalized.split('-')[0];
    if (first) {
      const firstBadge = findBadgeFromValues(CRYPTO_BADGES, [first], '');
      if (firstBadge) return firstBadge;
    }
  }
  return null;
}

function cryptoBadgeDescriptor(market, meta) {
  const category = normalizeSlug(market?.category);
  const cryptoSignal = category === 'crypto'
    || market?.crypto5min === true
    || Boolean(meta.cryptoMeta?.asset)
    || Boolean(meta.tokenMeta?.coinId)
    || textIncludesPhrase(meta.text, 'chainlink')
    || textIncludesPhrase(meta.text, 'coinbase')
    || textIncludesPhrase(meta.text, 'coingecko')
    || textIncludesPhrase(meta.text, 'crypto');
  if (!cryptoSignal) return null;

  const coinBadge = cryptoSymbolFromMarket(market, meta);
  if (coinBadge) return coinBadge;

  return null;
}

function entertainmentBadgeDescriptor(market, meta) {
  const category = normalizeSlug(market?.category);
  const hasEntertainmentSignal = category === 'musica'
    || textIncludesPhrase(meta.text, 'musica')
    || textIncludesPhrase(meta.text, 'music')
    || textIncludesPhrase(meta.text, 'cine')
    || textIncludesPhrase(meta.text, 'netflix')
    || textIncludesPhrase(meta.text, 'youtube')
    || textIncludesPhrase(meta.text, 'tv')
    || textIncludesPhrase(meta.text, 'reality')
    || textIncludesPhrase(meta.text, 'streaming')
    || textIncludesPhrase(meta.text, 'box office')
    || textIncludesPhrase(meta.text, 'taquilla');
  if (!hasEntertainmentSignal) return null;

  return findBadgeFromValues(ENTERTAINMENT_BADGES, [
    market?.source,
    market?.sourceEventId,
    market?.source_event_id,
    meta.resolverConfig?.source,
    meta.resolverConfig?.kind,
    meta.sourceData?.kind,
    meta.sourceData?.topic,
    meta.sourceData?.showLabel,
    meta.sourceData?.platform,
    ...meta.tags,
  ], meta.text);
}

function financeBadgeDescriptor(market, meta) {
  const category = normalizeSlug(market?.category);
  const hasFinanceSignal = category === 'finanzas'
    || textIncludesPhrase(meta.text, 'finanzas')
    || textIncludesPhrase(meta.text, 'finnhub')
    || textIncludesPhrase(meta.text, 'banxico')
    || textIncludesPhrase(meta.text, 'frankfurter')
    || textIncludesPhrase(meta.text, 'fed')
    || textIncludesPhrase(meta.text, 'stock');
  if (!hasFinanceSignal) return null;

  return findBadgeFromValues(FINANCE_BADGES, [
    market?.source,
    market?.sourceEventId,
    market?.source_event_id,
    meta.resolverConfig?.source,
    meta.resolverConfig?.symbol,
    meta.sourceData?.topic,
    ...meta.tags,
  ], meta.text);
}

function specialBadgeDescriptor(market, meta, badges = SPECIAL_BADGES) {
  return findBadgeFromValues(badges, [
    market?.source,
    market?.sourceEventId,
    market?.source_event_id,
    market?.category,
    meta.resolver?.type,
    meta.resolver?.source,
    meta.resolver?.metric,
    meta.resolverConfig?.source,
    meta.resolverConfig?.airport,
    meta.resolverConfig?.airportCode,
    meta.resolverConfig?.metric,
    ...meta.tags,
  ], meta.text);
}

function marketBadgeDescriptor(market = {}) {
  const meta = marketMetadata(market);
  const descriptor = specialBadgeDescriptor(market, meta, PRIORITY_SPECIAL_BADGES)
    || sportBadgeDescriptor(market, meta)
    || cryptoBadgeDescriptor(market, meta)
    || entertainmentBadgeDescriptor(market, meta)
    || financeBadgeDescriptor(market, meta)
    || specialBadgeDescriptor(market, meta, FALLBACK_SPECIAL_BADGES);
  return withDescriptorKey(null, descriptor);
}

function escapeSvgText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fontSizeForLabel(label) {
  const len = String(label || '').length;
  if (len <= 3) return 38;
  if (len <= 5) return 32;
  if (len <= 7) return 26;
  if (len <= 10) return 21;
  return 18;
}

function themeForBadge(themeKey) {
  return BADGE_THEMES[themeKey] || BADGE_THEMES.finance;
}

function marketBadgeDataUri(descriptor) {
  if (!descriptor?.key) return null;
  const cacheKey = JSON.stringify([
    descriptor.key,
    descriptor.label,
    descriptor.eyebrow,
    descriptor.theme,
    descriptor.glyph,
  ]);
  const cached = BADGE_CACHE.get(cacheKey);
  if (cached) return cached;

  const theme = themeForBadge(descriptor.theme);
  const label = escapeSvgText(String(descriptor.label || '').toUpperCase());
  const eyebrow = escapeSvgText(descriptor.eyebrow || '');
  const size = fontSizeForLabel(label);
  const playGlyph = descriptor.glyph === 'play'
    ? `<path d="M67 57v46l39-23z" fill="${theme.accent2}" opacity=".96"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="${label}">
<defs><linearGradient id="g" x1="18" y1="12" x2="142" y2="148" gradientUnits="userSpaceOnUse"><stop stop-color="${theme.bg2}"/><stop offset="1" stop-color="${theme.bg}"/></linearGradient></defs>
<rect width="160" height="160" rx="24" fill="url(#g)"/>
<circle cx="123" cy="33" r="34" fill="${theme.accent}" opacity=".22"/>
<circle cx="36" cy="128" r="42" fill="${theme.accent2}" opacity=".16"/>
<path d="M22 116c31-34 76-38 116-15" fill="none" stroke="${theme.accent}" stroke-width="9" stroke-linecap="round" opacity=".58"/>
<rect x="34" y="47" width="92" height="68" rx="18" fill="${theme.bg}" opacity=".42" stroke="${theme.accent2}" stroke-opacity=".32"/>
${playGlyph}
<text x="80" y="30" text-anchor="middle" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="13" font-weight="800" fill="${theme.muted}">${eyebrow}</text>
<text x="80" y="85" text-anchor="middle" dominant-baseline="middle" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${size}" font-weight="900" fill="${theme.text}">${label}</text>
<text x="80" y="127" text-anchor="middle" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="11" font-weight="800" fill="${theme.muted}">PRONOS</text>
</svg>`;
  const uri = `${BADGE_DATA_URI_PREFIX}${encodeURIComponent(svg)}`;
  BADGE_CACHE.set(cacheKey, uri);
  return uri;
}

export function marketPlaceholderKey(market = {}) {
  const badge = marketBadgeDescriptor(market);
  if (badge?.key) return badge.key;
  const category = String(market?.category || 'general').trim().toLowerCase();
  return MARKET_CATEGORY_IMAGE_PLACEHOLDERS[category] ? category : 'general';
}

export function marketPlaceholderImageSrc(market = {}) {
  const badge = marketBadgeDescriptor(market);
  const personalized = marketBadgeDataUri(badge);
  if (personalized) return personalized;
  return MARKET_CATEGORY_IMAGE_PLACEHOLDERS[marketPlaceholderKey(market)]
    || MARKET_CATEGORY_IMAGE_PLACEHOLDERS.general;
}

export function marketImageSrc(market = {}) {
  return cleanMarketImageRef(market?.imageUrl || market?.image_url || market?.image)
    || marketPlaceholderImageSrc(market);
}
