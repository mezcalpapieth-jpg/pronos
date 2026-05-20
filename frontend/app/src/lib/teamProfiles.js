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

const SOCCER_ESPN_LEAGUE_PATH = {
  'Premier League': 'soccer/eng.1',
  'La Liga': 'soccer/esp.1',
  'Serie A': 'soccer/ita.1',
  Bundesliga: 'soccer/ger.1',
  'Liga MX': 'soccer/mex.1',
  'Ligue 1': 'soccer/fra.1',
  MLS: 'soccer/usa.1',
};

function makeSoccerTeam([slug, name, league, country, aliases = [], extra = {}]) {
  const espnTeamId = extra.espnTeamId || null;
  return {
    slug,
    name,
    sport: 'soccer',
    league,
    country,
    aliases,
    espnTeamId,
    espnLeaguePath: extra.espnLeaguePath || SOCCER_ESPN_LEAGUE_PATH[league] || null,
    espnLogoKind: 'soccer',
    logoUrl: extra.logoUrl || espnLogo('soccer', espnTeamId),
    ...extra,
  };
}

const SOCCER_TEAMS = [
  // Premier League
  ['arsenal', 'Arsenal', 'Premier League', 'Inglaterra', ['Arsenal FC', 'Arsenal London'], { competitions: ['uefa-cl'], footballDataId: 57, espnTeamId: 359, logoUrl: espnLogo('soccer', 359) }],
  ['aston-villa', 'Aston Villa', 'Premier League', 'Inglaterra', ['Aston Villa FC', 'Villa', 'AVL'], { competitions: ['uefa-europa-league'], footballDataId: 58, espnTeamId: 362, logoUrl: espnLogo('soccer', 362) }],
  ['bournemouth', 'Bournemouth', 'Premier League', 'Inglaterra', ['AFC Bournemouth', 'Cherries']],
  ['brentford', 'Brentford', 'Premier League', 'Inglaterra', ['Brentford FC']],
  ['brighton', 'Brighton & Hove Albion', 'Premier League', 'Inglaterra', ['Brighton', 'Brighton and Hove Albion', 'BHA']],
  ['burnley', 'Burnley', 'Premier League', 'Inglaterra', ['Burnley FC']],
  ['chelsea', 'Chelsea', 'Premier League', 'Inglaterra', ['Chelsea FC'], { footballDataId: 61, espnTeamId: 363, logoUrl: espnLogo('soccer', 363) }],
  ['crystal-palace', 'Crystal Palace', 'Premier League', 'Inglaterra', ['Crystal Palace FC', 'Palace', 'CRY'], { competitions: ['uefa-conference-league'], footballDataId: 354, espnTeamId: 384, logoUrl: espnLogo('soccer', 384) }],
  ['everton', 'Everton', 'Premier League', 'Inglaterra', ['Everton FC']],
  ['fulham', 'Fulham', 'Premier League', 'Inglaterra', ['Fulham FC']],
  ['leeds-united', 'Leeds United', 'Premier League', 'Inglaterra', ['Leeds', 'Leeds United FC']],
  ['liverpool', 'Liverpool', 'Premier League', 'Inglaterra', ['Liverpool FC']],
  ['manchester-city', 'Manchester City', 'Premier League', 'Inglaterra', ['Man City', 'Manchester City FC'], { footballDataId: 65, espnTeamId: 382, logoUrl: espnLogo('soccer', 382) }],
  ['manchester-united', 'Manchester United', 'Premier League', 'Inglaterra', ['Man United', 'Man Utd', 'Manchester United FC'], { footballDataId: 66, espnTeamId: 360, logoUrl: espnLogo('soccer', 360) }],
  ['newcastle-united', 'Newcastle United', 'Premier League', 'Inglaterra', ['Newcastle', 'NUFC']],
  ['nottingham-forest', 'Nottingham Forest', 'Premier League', 'Inglaterra', ['Forest', 'Nottingham Forest FC']],
  ['sunderland', 'Sunderland', 'Premier League', 'Inglaterra', ['Sunderland AFC']],
  ['tottenham-hotspur', 'Tottenham Hotspur', 'Premier League', 'Inglaterra', ['Tottenham', 'Spurs', 'Tottenham Hotspur FC']],
  ['west-ham-united', 'West Ham United', 'Premier League', 'Inglaterra', ['West Ham', 'West Ham United FC']],
  ['wolverhampton-wanderers', 'Wolverhampton Wanderers', 'Premier League', 'Inglaterra', ['Wolves', 'Wolverhampton']],

  // La Liga
  ['athletic-club', 'Athletic Club', 'La Liga', 'España', ['Athletic Bilbao']],
  ['atletico-madrid', 'Atlético Madrid', 'La Liga', 'España', ['Atletico Madrid', 'Atlético de Madrid'], { footballDataId: 78, espnTeamId: 1068, logoUrl: espnLogo('soccer', 1068) }],
  ['osasuna', 'Osasuna', 'La Liga', 'España', ['CA Osasuna']],
  ['celta-vigo', 'Celta Vigo', 'La Liga', 'España', ['Celta', 'RC Celta', 'Celta de Vigo']],
  ['deportivo-alaves', 'Deportivo Alavés', 'La Liga', 'España', ['Alaves', 'Alavés']],
  ['elche', 'Elche', 'La Liga', 'España', ['Elche CF']],
  ['barcelona', 'Barcelona', 'La Liga', 'España', ['FC Barcelona', 'Barça', 'Barca'], { footballDataId: 81, espnTeamId: 83, logoUrl: espnLogo('soccer', 83) }],
  ['getafe', 'Getafe', 'La Liga', 'España', ['Getafe CF']],
  ['girona', 'Girona', 'La Liga', 'España', ['Girona FC']],
  ['levante', 'Levante', 'La Liga', 'España', ['Levante UD']],
  ['mallorca', 'Mallorca', 'La Liga', 'España', ['RCD Mallorca']],
  ['rayo-vallecano', 'Rayo Vallecano', 'La Liga', 'España', ['Rayo Vallecano de Madrid', 'Rayo', 'RAY'], { competitions: ['uefa-conference-league'], footballDataId: 87, espnTeamId: 101, logoUrl: espnLogo('soccer', 101) }],
  ['real-betis', 'Real Betis', 'La Liga', 'España', ['Betis', 'Real Betis Balompié', 'Real Betis Balompie']],
  ['real-madrid', 'Real Madrid', 'La Liga', 'España', ['Real Madrid CF'], { footballDataId: 86, espnTeamId: 86, logoUrl: espnLogo('soccer', 86) }],
  ['real-oviedo', 'Real Oviedo', 'La Liga', 'España', ['Oviedo']],
  ['real-sociedad', 'Real Sociedad', 'La Liga', 'España', ['La Real']],
  ['sevilla', 'Sevilla', 'La Liga', 'España', ['Sevilla FC']],
  ['valencia', 'Valencia', 'La Liga', 'España', ['Valencia CF']],
  ['villarreal', 'Villarreal', 'La Liga', 'España', ['Villarreal CF']],
  ['espanyol', 'Espanyol', 'La Liga', 'España', ['RCD Espanyol']],

  // Serie A
  ['atalanta', 'Atalanta', 'Serie A', 'Italia', ['Atalanta BC']],
  ['bologna', 'Bologna', 'Serie A', 'Italia', ['Bologna FC']],
  ['cagliari', 'Cagliari', 'Serie A', 'Italia', ['Cagliari Calcio']],
  ['como', 'Como', 'Serie A', 'Italia', ['Como 1907']],
  ['cremonese', 'Cremonese', 'Serie A', 'Italia', ['US Cremonese']],
  ['fiorentina', 'Fiorentina', 'Serie A', 'Italia', ['ACF Fiorentina']],
  ['genoa', 'Genoa', 'Serie A', 'Italia', ['Genoa CFC']],
  ['hellas-verona', 'Hellas Verona', 'Serie A', 'Italia', ['Verona']],
  ['inter-milan', 'Inter Milan', 'Serie A', 'Italia', ['Inter', 'Internazionale', 'FC Internazionale Milano']],
  ['juventus', 'Juventus', 'Serie A', 'Italia', ['Juventus FC', 'Juve'], { footballDataId: 109, espnTeamId: 111, logoUrl: espnLogo('soccer', 111) }],
  ['lazio', 'Lazio', 'Serie A', 'Italia', ['SS Lazio']],
  ['lecce', 'Lecce', 'Serie A', 'Italia', ['US Lecce']],
  ['ac-milan', 'AC Milan', 'Serie A', 'Italia', ['Milan', 'AC Milan'], { footballDataId: 98, espnTeamId: 103, logoUrl: espnLogo('soccer', 103) }],
  ['napoli', 'Napoli', 'Serie A', 'Italia', ['SSC Napoli']],
  ['parma', 'Parma', 'Serie A', 'Italia', ['Parma Calcio']],
  ['pisa', 'Pisa', 'Serie A', 'Italia', ['Pisa SC']],
  ['roma', 'Roma', 'Serie A', 'Italia', ['AS Roma']],
  ['sassuolo', 'Sassuolo', 'Serie A', 'Italia', ['US Sassuolo']],
  ['torino', 'Torino', 'Serie A', 'Italia', ['Torino FC']],
  ['udinese', 'Udinese', 'Serie A', 'Italia', ['Udinese Calcio']],

  // Bundesliga
  ['augsburg', 'Augsburg', 'Bundesliga', 'Alemania', ['FC Augsburg']],
  ['bayer-leverkusen', 'Bayer Leverkusen', 'Bundesliga', 'Alemania', ['Leverkusen', 'Bayer 04 Leverkusen'], { footballDataId: 3, espnTeamId: 131, logoUrl: espnLogo('soccer', 131) }],
  ['bayern-munich', 'Bayern Munich', 'Bundesliga', 'Alemania', ['Bayern München', 'FC Bayern München', 'Bayern'], { footballDataId: 5, espnTeamId: 132, logoUrl: espnLogo('soccer', 132) }],
  ['borussia-dortmund', 'Borussia Dortmund', 'Bundesliga', 'Alemania', ['Dortmund', 'BVB'], { footballDataId: 4, espnTeamId: 124, logoUrl: espnLogo('soccer', 124) }],
  ['borussia-monchengladbach', 'Borussia Mönchengladbach', 'Bundesliga', 'Alemania', ['Borussia Monchengladbach', 'Gladbach']],
  ['eintracht-frankfurt', 'Eintracht Frankfurt', 'Bundesliga', 'Alemania', ['Frankfurt']],
  ['freiburg', 'Freiburg', 'Bundesliga', 'Alemania', ['SC Freiburg', 'Sport-Club Freiburg', 'Freiburg FC', 'SCF'], { competitions: ['uefa-europa-league'], footballDataId: 17, espnTeamId: 126, logoUrl: espnLogo('soccer', 126) }],
  ['hamburg', 'Hamburg', 'Bundesliga', 'Alemania', ['Hamburger SV', 'HSV']],
  ['heidenheim', 'Heidenheim', 'Bundesliga', 'Alemania', ['1. FC Heidenheim', 'FC Heidenheim']],
  ['hoffenheim', 'Hoffenheim', 'Bundesliga', 'Alemania', ['TSG Hoffenheim']],
  ['koln', 'Köln', 'Bundesliga', 'Alemania', ['Koln', 'FC Köln', '1. FC Koln', '1. FC Köln']],
  ['mainz', 'Mainz', 'Bundesliga', 'Alemania', ['Mainz 05', '1. FSV Mainz 05']],
  ['rb-leipzig', 'RB Leipzig', 'Bundesliga', 'Alemania', ['Leipzig', 'RasenBallsport Leipzig']],
  ['st-pauli', 'St. Pauli', 'Bundesliga', 'Alemania', ['FC St. Pauli', 'St Pauli']],
  ['stuttgart', 'Stuttgart', 'Bundesliga', 'Alemania', ['VfB Stuttgart']],
  ['union-berlin', 'Union Berlin', 'Bundesliga', 'Alemania', ['1. FC Union Berlin']],
  ['werder-bremen', 'Werder Bremen', 'Bundesliga', 'Alemania', ['SV Werder Bremen', 'Bremen']],
  ['wolfsburg', 'Wolfsburg', 'Bundesliga', 'Alemania', ['VfL Wolfsburg']],

  // Liga MX
  ['america', 'América', 'Liga MX', 'México', ['America', 'Club América', 'Club America'], { espnTeamId: 227 }],
  ['atlas', 'Atlas', 'Liga MX', 'México', ['Atlas FC'], { espnTeamId: 216 }],
  ['atletico-san-luis', 'Atlético San Luis', 'Liga MX', 'México', ['Atletico San Luis', 'Atlético de San Luis'], { espnTeamId: 15720 }],
  ['cruz-azul', 'Cruz Azul', 'Liga MX', 'México', ['Cruz Azul FC'], { espnTeamId: 218 }],
  ['guadalajara', 'Guadalajara', 'Liga MX', 'México', ['Chivas', 'Chivas Guadalajara', 'CD Guadalajara'], { espnTeamId: 219 }],
  ['juarez', 'Juárez', 'Liga MX', 'México', ['Juarez', 'FC Juárez', 'FC Juarez'], { espnTeamId: 17851 }],
  ['leon', 'León', 'Liga MX', 'México', ['Leon', 'Club León', 'Club Leon'], { espnTeamId: 228 }],
  ['mazatlan', 'Mazatlán', 'Liga MX', 'México', ['Mazatlan', 'Mazatlán FC', 'Mazatlan FC'], { espnTeamId: 20702 }],
  ['monterrey', 'Monterrey', 'Liga MX', 'México', ['Rayados', 'CF Monterrey'], { espnTeamId: 220 }],
  ['necaxa', 'Necaxa', 'Liga MX', 'México', ['Club Necaxa'], { espnTeamId: 229 }],
  ['pachuca', 'Pachuca', 'Liga MX', 'México', ['CF Pachuca'], { espnTeamId: 234 }],
  ['puebla', 'Puebla', 'Liga MX', 'México', ['Club Puebla'], { espnTeamId: 231 }],
  ['pumas-unam', 'Pumas UNAM', 'Liga MX', 'México', ['Pumas', 'UNAM'], { espnTeamId: 233 }],
  ['queretaro', 'Querétaro', 'Liga MX', 'México', ['Queretaro', 'Querétaro FC', 'Queretaro FC'], { espnTeamId: 222 }],
  ['santos-laguna', 'Santos Laguna', 'Liga MX', 'México', ['Santos'], { espnTeamId: 225 }],
  ['tigres-uanl', 'Tigres UANL', 'Liga MX', 'México', ['Tigres', 'UANL'], { espnTeamId: 232 }],
  ['tijuana', 'Tijuana', 'Liga MX', 'México', ['Club Tijuana', 'Xolos'], { espnTeamId: 10125 }],
  ['toluca', 'Toluca', 'Liga MX', 'México', ['Deportivo Toluca'], { espnTeamId: 223 }],

  // Extra teams used by imported continental markets.
  ['psg', 'PSG', 'Ligue 1', 'Francia', ['Paris Saint-Germain', 'Paris Saint Germain', 'Paris SG'], { competitions: ['uefa-cl'], footballDataId: 524, espnTeamId: 160, logoUrl: espnLogo('soccer', 160) }],
].map(makeSoccerTeam);

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

function makeMexicanBaseballTeam([slug, name, league, aliases = []]) {
  return {
    slug,
    name,
    sport: 'baseball',
    league,
    country: 'México',
    aliases,
  };
}

const LMB_TEAMS = [
  ['acereros-de-monclova', 'Acereros de Monclova', 'LMB', ['Acereros']],
  ['algodoneros-union-laguna', 'Algodoneros Unión Laguna', 'LMB', ['Algodoneros Union Laguna', 'Algodoneros de Unión Laguna', 'Algodoneros de Union Laguna']],
  ['bravos-de-leon', 'Bravos de León', 'LMB', ['Bravos de Leon']],
  ['caliente-de-durango', 'Caliente de Durango', 'LMB', ['Caliente Durango']],
  ['charros-de-jalisco-lmb', 'Charros de Jalisco', 'LMB', ['Charros LMB']],
  ['conspiradores-de-queretaro', 'Conspiradores de Querétaro', 'LMB', ['Conspiradores de Queretaro']],
  ['diablos-rojos-del-mexico', 'Diablos Rojos del México', 'LMB', ['Diablos Rojos', 'Diablos Rojos del Mexico']],
  ['dorados-de-chihuahua', 'Dorados de Chihuahua', 'LMB', ['Dorados']],
  ['el-aguila-de-veracruz', 'El Águila de Veracruz', 'LMB', ['El Aguila de Veracruz', 'Águila de Veracruz', 'Aguila de Veracruz']],
  ['guerreros-de-oaxaca', 'Guerreros de Oaxaca', 'LMB', ['Guerreros']],
  ['leones-de-yucatan', 'Leones de Yucatán', 'LMB', ['Leones de Yucatan']],
  ['olmecas-de-tabasco', 'Olmecas de Tabasco', 'LMB', ['Olmecas']],
  ['pericos-de-puebla', 'Pericos de Puebla', 'LMB', ['Pericos']],
  ['piratas-de-campeche', 'Piratas de Campeche', 'LMB', ['Piratas']],
  ['rieleros-de-aguascalientes', 'Rieleros de Aguascalientes', 'LMB', ['Rieleros']],
  ['saraperos-de-saltillo', 'Saraperos de Saltillo', 'LMB', ['Saraperos']],
  ['sultanes-de-monterrey-lmb', 'Sultanes de Monterrey', 'LMB', ['Sultanes LMB']],
  ['tecolotes-de-los-dos-laredos', 'Tecolotes de los Dos Laredos', 'LMB', ['Tecolotes Dos Laredos', 'Tecos']],
  ['tigres-de-quintana-roo', 'Tigres de Quintana Roo', 'LMB', ['Tigres QR']],
  ['toros-de-tijuana', 'Toros de Tijuana', 'LMB', ['Toros']],
].map(makeMexicanBaseballTeam);

const LMP_TEAMS = [
  ['aguilas-de-mexicali', 'Águilas de Mexicali', 'LMP', ['Aguilas de Mexicali', 'Águilas']],
  ['algodoneros-de-guasave', 'Algodoneros de Guasave', 'LMP', ['Algodoneros Guasave']],
  ['caneros-de-los-mochis', 'Cañeros de Los Mochis', 'LMP', ['Caneros de Los Mochis', 'Cañeros']],
  ['charros-de-jalisco-lmp', 'Charros de Jalisco', 'LMP', ['Charros LMP']],
  ['jaguares-de-nayarit', 'Jaguares de Nayarit', 'LMP', ['Jaguares']],
  ['mayos-de-navojoa', 'Mayos de Navojoa', 'LMP', ['Mayos']],
  ['naranjeros-de-hermosillo', 'Naranjeros de Hermosillo', 'LMP', ['Naranjeros']],
  ['tomateros-de-culiacan', 'Tomateros de Culiacán', 'LMP', ['Tomateros de Culiacan', 'Tomateros']],
  ['venados-de-mazatlan', 'Venados de Mazatlán', 'LMP', ['Venados de Mazatlan', 'Venados']],
  ['yaquis-de-ciudad-obregon', 'Yaquis de Ciudad Obregón', 'LMP', ['Yaquis de Obregón', 'Yaquis de Obregon', 'Yaquis']],
].map(makeMexicanBaseballTeam);

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
  ...LMB_TEAMS,
  ...LMP_TEAMS,
  ...NFL_TEAMS,
];

export function marketSportToTeamSport(sport) {
  const key = normalizeKey(sport);
  if (key === 'nba') return 'basketball';
  if (key === 'mlb' || key === 'lmb' || key === 'lmp') return 'baseball';
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
  const sportKey = normalizeKey(sport);
  const profileSport = marketSportToTeamSport(sport);
  if (!profileSport || !label) return null;
  const key = normalizeKey(label);
  const requestedLeague = sportKey === 'lmb' || sportKey === 'lmp' || sportKey === 'mlb'
    ? sportKey
    : null;
  const matches = (team) => {
    if (team.sport !== profileSport) return false;
    if (requestedLeague && normalizeKey(team.league) !== requestedLeague) return false;
    const names = [team.name, team.slug, ...(team.aliases || [])];
    return names.some(name => normalizeKey(name) === key);
  };
  return TEAM_PROFILES.find(matches) || null;
}

export function teamProfilePath(team) {
  if (!team?.sport || !team?.slug) return '/teams';
  return `/teams/${team.sport}/${team.slug}`;
}
