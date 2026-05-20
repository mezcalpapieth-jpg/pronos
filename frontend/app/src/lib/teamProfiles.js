function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value) {
  return normalizeKey(value).replace(/\s+/g, '-');
}

function espnLogo(kind, id) {
  if (!kind || !id) return null;
  return `https://a.espncdn.com/i/teamlogos/${kind}/500/${id}.png`;
}

const SOCCER_TEAMS = [
  {
    slug: 'arsenal',
    name: 'Arsenal',
    sport: 'soccer',
    league: 'Premier League',
    country: 'Inglaterra',
    aliases: ['Arsenal FC', 'Arsenal London'],
    footballDataId: 57,
    espnTeamId: 359,
    logoUrl: espnLogo('soccer', 359),
  },
  {
    slug: 'psg',
    name: 'PSG',
    sport: 'soccer',
    league: 'Ligue 1',
    country: 'Francia',
    aliases: ['Paris Saint-Germain', 'Paris Saint Germain', 'Paris SG'],
    footballDataId: 524,
    espnTeamId: 160,
    logoUrl: espnLogo('soccer', 160),
  },
  {
    slug: 'real-madrid',
    name: 'Real Madrid',
    sport: 'soccer',
    league: 'La Liga',
    country: 'España',
    aliases: ['Real Madrid CF'],
    footballDataId: 86,
    espnTeamId: 86,
    logoUrl: espnLogo('soccer', 86),
  },
  {
    slug: 'barcelona',
    name: 'Barcelona',
    sport: 'soccer',
    league: 'La Liga',
    country: 'España',
    aliases: ['FC Barcelona', 'Barça', 'Barca'],
    footballDataId: 81,
    espnTeamId: 83,
    logoUrl: espnLogo('soccer', 83),
  },
  {
    slug: 'atletico-madrid',
    name: 'Atlético Madrid',
    sport: 'soccer',
    league: 'La Liga',
    country: 'España',
    aliases: ['Atletico Madrid', 'Atlético de Madrid'],
    footballDataId: 78,
    espnTeamId: 1068,
    logoUrl: espnLogo('soccer', 1068),
  },
  {
    slug: 'chelsea',
    name: 'Chelsea',
    sport: 'soccer',
    league: 'Premier League',
    country: 'Inglaterra',
    aliases: ['Chelsea FC'],
    footballDataId: 61,
    espnTeamId: 363,
    logoUrl: espnLogo('soccer', 363),
  },
  {
    slug: 'aston-villa',
    name: 'Aston Villa',
    sport: 'soccer',
    league: 'Premier League',
    country: 'Inglaterra',
    aliases: ['Aston Villa FC', 'Villa', 'AVL'],
    footballDataId: 58,
    espnTeamId: 362,
    logoUrl: espnLogo('soccer', 362),
  },
  {
    slug: 'crystal-palace',
    name: 'Crystal Palace',
    sport: 'soccer',
    league: 'Premier League',
    country: 'Inglaterra',
    aliases: ['Crystal Palace FC', 'Palace', 'CRY'],
    footballDataId: 354,
    espnTeamId: 384,
    logoUrl: espnLogo('soccer', 384),
  },
  {
    slug: 'manchester-city',
    name: 'Manchester City',
    sport: 'soccer',
    league: 'Premier League',
    country: 'Inglaterra',
    aliases: ['Man City', 'Manchester City FC'],
    footballDataId: 65,
    espnTeamId: 382,
    logoUrl: espnLogo('soccer', 382),
  },
  {
    slug: 'manchester-united',
    name: 'Manchester United',
    sport: 'soccer',
    league: 'Premier League',
    country: 'Inglaterra',
    aliases: ['Man United', 'Man Utd', 'Manchester United FC'],
    footballDataId: 66,
    espnTeamId: 360,
    logoUrl: espnLogo('soccer', 360),
  },
  {
    slug: 'bayern-munich',
    name: 'Bayern Munich',
    sport: 'soccer',
    league: 'Bundesliga',
    country: 'Alemania',
    aliases: ['Bayern München', 'FC Bayern München', 'Bayern'],
    footballDataId: 5,
    espnTeamId: 132,
    logoUrl: espnLogo('soccer', 132),
  },
  {
    slug: 'borussia-dortmund',
    name: 'Borussia Dortmund',
    sport: 'soccer',
    league: 'Bundesliga',
    country: 'Alemania',
    aliases: ['Dortmund', 'BVB'],
    footballDataId: 4,
    espnTeamId: 124,
    logoUrl: espnLogo('soccer', 124),
  },
  {
    slug: 'bayer-leverkusen',
    name: 'Bayer Leverkusen',
    sport: 'soccer',
    league: 'Bundesliga',
    country: 'Alemania',
    aliases: ['Leverkusen', 'Bayer 04 Leverkusen'],
    footballDataId: 3,
    espnTeamId: 131,
    logoUrl: espnLogo('soccer', 131),
  },
  {
    slug: 'freiburg',
    name: 'Freiburg',
    sport: 'soccer',
    league: 'Bundesliga',
    country: 'Alemania',
    aliases: ['SC Freiburg', 'Sport-Club Freiburg', 'Freiburg FC', 'SCF'],
    footballDataId: 17,
    espnTeamId: 126,
    logoUrl: espnLogo('soccer', 126),
  },
  {
    slug: 'juventus',
    name: 'Juventus',
    sport: 'soccer',
    league: 'Serie A',
    country: 'Italia',
    aliases: ['Juventus FC', 'Juve'],
    footballDataId: 109,
    espnTeamId: 111,
    logoUrl: espnLogo('soccer', 111),
  },
  {
    slug: 'ac-milan',
    name: 'AC Milan',
    sport: 'soccer',
    league: 'Serie A',
    country: 'Italia',
    aliases: ['Milan', 'AC Milan'],
    footballDataId: 98,
    espnTeamId: 103,
    logoUrl: espnLogo('soccer', 103),
  },
  {
    slug: 'rayo-vallecano',
    name: 'Rayo Vallecano',
    sport: 'soccer',
    league: 'La Liga',
    country: 'España',
    aliases: ['Rayo Vallecano de Madrid', 'Rayo', 'RAY'],
    footballDataId: 87,
    espnTeamId: 101,
    logoUrl: espnLogo('soccer', 101),
  },
];

const NBA_TEAMS = [
  ['atlanta-hawks', 'Atlanta Hawks', 1, ['Hawks']],
  ['boston-celtics', 'Boston Celtics', 2, ['Celtics']],
  ['brooklyn-nets', 'Brooklyn Nets', 17, ['Nets']],
  ['charlotte-hornets', 'Charlotte Hornets', 30, ['Hornets']],
  ['chicago-bulls', 'Chicago Bulls', 4, ['Bulls']],
  ['cleveland-cavaliers', 'Cleveland Cavaliers', 5, ['Cavaliers', 'Cavs']],
  ['dallas-mavericks', 'Dallas Mavericks', 6, ['Mavericks', 'Mavs']],
  ['denver-nuggets', 'Denver Nuggets', 7, ['Nuggets']],
  ['detroit-pistons', 'Detroit Pistons', 8, ['Pistons']],
  ['golden-state-warriors', 'Golden State Warriors', 9, ['Warriors']],
  ['houston-rockets', 'Houston Rockets', 10, ['Rockets']],
  ['indiana-pacers', 'Indiana Pacers', 11, ['Pacers']],
  ['los-angeles-clippers', 'LA Clippers', 12, ['Los Angeles Clippers', 'Clippers']],
  ['los-angeles-lakers', 'Los Angeles Lakers', 13, ['Lakers']],
  ['memphis-grizzlies', 'Memphis Grizzlies', 29, ['Grizzlies']],
  ['miami-heat', 'Miami Heat', 14, ['Heat']],
  ['milwaukee-bucks', 'Milwaukee Bucks', 15, ['Bucks']],
  ['minnesota-timberwolves', 'Minnesota Timberwolves', 16, ['Timberwolves', 'Wolves']],
  ['new-orleans-pelicans', 'New Orleans Pelicans', 3, ['Pelicans']],
  ['new-york-knicks', 'New York Knicks', 18, ['Knicks']],
  ['oklahoma-city-thunder', 'Oklahoma City Thunder', 25, ['Thunder', 'OKC Thunder']],
  ['orlando-magic', 'Orlando Magic', 19, ['Magic']],
  ['philadelphia-76ers', 'Philadelphia 76ers', 20, ['76ers', 'Sixers']],
  ['phoenix-suns', 'Phoenix Suns', 21, ['Suns']],
  ['portland-trail-blazers', 'Portland Trail Blazers', 22, ['Trail Blazers', 'Blazers']],
  ['sacramento-kings', 'Sacramento Kings', 23, ['Kings']],
  ['san-antonio-spurs', 'San Antonio Spurs', 24, ['Spurs']],
  ['toronto-raptors', 'Toronto Raptors', 28, ['Raptors']],
  ['utah-jazz', 'Utah Jazz', 26, ['Jazz']],
  ['washington-wizards', 'Washington Wizards', 27, ['Wizards']],
].map(([slug, name, espnTeamId, aliases]) => ({
  slug,
  name,
  sport: 'basketball',
  league: 'NBA',
  country: 'Estados Unidos',
  aliases,
  espnTeamId,
  espnLeaguePath: 'basketball/nba',
  espnLogoKind: 'nba',
  logoUrl: espnLogo('nba', espnTeamId),
}));

const MLB_TEAMS = [
  ['arizona-diamondbacks', 'Arizona Diamondbacks', 29, ['Diamondbacks', 'D-backs']],
  ['atlanta-braves', 'Atlanta Braves', 15, ['Braves']],
  ['baltimore-orioles', 'Baltimore Orioles', 1, ['Orioles']],
  ['boston-red-sox', 'Boston Red Sox', 2, ['Red Sox']],
  ['chicago-cubs', 'Chicago Cubs', 16, ['Cubs']],
  ['chicago-white-sox', 'Chicago White Sox', 4, ['White Sox']],
  ['cincinnati-reds', 'Cincinnati Reds', 17, ['Reds']],
  ['cleveland-guardians', 'Cleveland Guardians', 5, ['Guardians']],
  ['colorado-rockies', 'Colorado Rockies', 27, ['Rockies']],
  ['detroit-tigers', 'Detroit Tigers', 6, ['Tigers']],
  ['houston-astros', 'Houston Astros', 18, ['Astros']],
  ['kansas-city-royals', 'Kansas City Royals', 7, ['Royals']],
  ['los-angeles-angels', 'Los Angeles Angels', 3, ['Angels']],
  ['los-angeles-dodgers', 'Los Angeles Dodgers', 19, ['Dodgers', 'LA Dodgers']],
  ['miami-marlins', 'Miami Marlins', 28, ['Marlins']],
  ['milwaukee-brewers', 'Milwaukee Brewers', 8, ['Brewers']],
  ['minnesota-twins', 'Minnesota Twins', 9, ['Twins']],
  ['new-york-mets', 'New York Mets', 21, ['Mets']],
  ['new-york-yankees', 'New York Yankees', 10, ['Yankees']],
  ['philadelphia-phillies', 'Philadelphia Phillies', 22, ['Phillies']],
  ['pittsburgh-pirates', 'Pittsburgh Pirates', 23, ['Pirates']],
  ['san-diego-padres', 'San Diego Padres', 25, ['Padres']],
  ['san-francisco-giants', 'San Francisco Giants', 26, ['Giants']],
  ['seattle-mariners', 'Seattle Mariners', 12, ['Mariners']],
  ['st-louis-cardinals', 'St. Louis Cardinals', 24, ['Cardinals', 'Saint Louis Cardinals']],
  ['tampa-bay-rays', 'Tampa Bay Rays', 30, ['Rays']],
  ['texas-rangers', 'Texas Rangers', 13, ['Rangers']],
  ['toronto-blue-jays', 'Toronto Blue Jays', 14, ['Blue Jays']],
  ['washington-nationals', 'Washington Nationals', 20, ['Nationals']],
].map(([slug, name, espnTeamId, aliases]) => ({
  slug,
  name,
  sport: 'baseball',
  league: 'MLB',
  country: 'Estados Unidos',
  aliases,
  espnTeamId,
  espnLeaguePath: 'baseball/mlb',
  espnLogoKind: 'mlb',
  logoUrl: espnLogo('mlb', espnTeamId),
}));

const NFL_TEAMS = [
  ['arizona-cardinals', 'Arizona Cardinals', 22, ['Cardinals']],
  ['atlanta-falcons', 'Atlanta Falcons', 1, ['Falcons']],
  ['baltimore-ravens', 'Baltimore Ravens', 33, ['Ravens']],
  ['buffalo-bills', 'Buffalo Bills', 2, ['Bills']],
  ['carolina-panthers', 'Carolina Panthers', 29, ['Panthers']],
  ['chicago-bears', 'Chicago Bears', 3, ['Bears']],
  ['cincinnati-bengals', 'Cincinnati Bengals', 4, ['Bengals']],
  ['cleveland-browns', 'Cleveland Browns', 5, ['Browns']],
  ['dallas-cowboys', 'Dallas Cowboys', 6, ['Cowboys']],
  ['denver-broncos', 'Denver Broncos', 7, ['Broncos']],
  ['detroit-lions', 'Detroit Lions', 8, ['Lions']],
  ['green-bay-packers', 'Green Bay Packers', 9, ['Packers']],
  ['houston-texans', 'Houston Texans', 34, ['Texans']],
  ['indianapolis-colts', 'Indianapolis Colts', 11, ['Colts']],
  ['jacksonville-jaguars', 'Jacksonville Jaguars', 30, ['Jaguars']],
  ['kansas-city-chiefs', 'Kansas City Chiefs', 12, ['Chiefs']],
  ['las-vegas-raiders', 'Las Vegas Raiders', 13, ['Raiders']],
  ['los-angeles-chargers', 'Los Angeles Chargers', 24, ['Chargers']],
  ['los-angeles-rams', 'Los Angeles Rams', 14, ['Rams']],
  ['miami-dolphins', 'Miami Dolphins', 15, ['Dolphins']],
  ['minnesota-vikings', 'Minnesota Vikings', 16, ['Vikings']],
  ['new-england-patriots', 'New England Patriots', 17, ['Patriots']],
  ['new-orleans-saints', 'New Orleans Saints', 18, ['Saints']],
  ['new-york-giants', 'New York Giants', 19, ['Giants']],
  ['new-york-jets', 'New York Jets', 20, ['Jets']],
  ['philadelphia-eagles', 'Philadelphia Eagles', 21, ['Eagles']],
  ['pittsburgh-steelers', 'Pittsburgh Steelers', 23, ['Steelers']],
  ['san-francisco-49ers', 'San Francisco 49ers', 25, ['49ers', 'Niners']],
  ['seattle-seahawks', 'Seattle Seahawks', 26, ['Seahawks']],
  ['tampa-bay-buccaneers', 'Tampa Bay Buccaneers', 27, ['Buccaneers', 'Bucs']],
  ['tennessee-titans', 'Tennessee Titans', 10, ['Titans']],
  ['washington-commanders', 'Washington Commanders', 28, ['Commanders']],
].map(([slug, name, espnTeamId, aliases]) => ({
  slug,
  name,
  sport: 'nfl',
  league: 'NFL',
  country: 'Estados Unidos',
  aliases,
  espnTeamId,
  espnLeaguePath: 'football/nfl',
  espnLogoKind: 'nfl',
  logoUrl: espnLogo('nfl', espnTeamId),
}));

export const TEAM_PROFILES = [
  ...SOCCER_TEAMS,
  ...NBA_TEAMS,
  ...MLB_TEAMS,
  ...NFL_TEAMS,
];

export function marketSportToTeamSport(sport) {
  const key = normalizeKey(sport);
  if (key === 'nba') return 'basketball';
  if (key === 'mlb') return 'baseball';
  if (key === 'soccer' || key === 'futbol' || key === 'football soccer') return 'soccer';
  if (key === 'nfl' || key === 'football') return 'nfl';
  if (key === 'baseball' || key === 'basketball') return key;
  return key || null;
}

export function findTeamProfile(sport, teamSlug) {
  const profileSport = marketSportToTeamSport(sport);
  const slug = slugify(teamSlug);
  return TEAM_PROFILES.find(team => (
    team.sport === profileSport && team.slug === slug
  )) || null;
}

export function findTeamByName(sport, label) {
  const profileSport = marketSportToTeamSport(sport);
  if (!profileSport || !label) return null;
  const key = normalizeKey(label);
  return TEAM_PROFILES.find(team => {
    if (team.sport !== profileSport) return false;
    const names = [team.name, team.slug, ...(team.aliases || [])];
    return names.some(name => normalizeKey(name) === key);
  }) || null;
}

export function teamProfilePath(team) {
  if (!team?.sport || !team?.slug) return '/teams';
  return `/teams/${team.sport}/${team.slug}`;
}
