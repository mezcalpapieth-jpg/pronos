export const NATIONAL_TEAM_LEAGUE_CODES = new Set([
  'uefa.nations',
  'uefa.euro',
  'fifa.worldq.conmebol',
  'conmebol.america',
  'concacaf.nations.league',
  'concacaf.gold',
  'fifa.friendly',
]);

const NATIONAL_TEAM_ES = new Map([
  ['albania', 'Albania'],
  ['andorra', 'Andorra'],
  ['armenia', 'Armenia'],
  ['austria', 'Austria'],
  ['azerbaijan', 'Azerbaiyán'],
  ['belarus', 'Bielorrusia'],
  ['belgium', 'Bélgica'],
  ['bosnia and herzegovina', 'Bosnia y Herzegovina'],
  ['bulgaria', 'Bulgaria'],
  ['croatia', 'Croacia'],
  ['cyprus', 'Chipre'],
  ['czech republic', 'República Checa'],
  ['czechia', 'Chequia'],
  ['denmark', 'Dinamarca'],
  ['england', 'Inglaterra'],
  ['estonia', 'Estonia'],
  ['faroe islands', 'Islas Feroe'],
  ['finland', 'Finlandia'],
  ['france', 'Francia'],
  ['georgia', 'Georgia'],
  ['germany', 'Alemania'],
  ['gibraltar', 'Gibraltar'],
  ['greece', 'Grecia'],
  ['hungary', 'Hungría'],
  ['iceland', 'Islandia'],
  ['ireland', 'Irlanda'],
  ['israel', 'Israel'],
  ['italy', 'Italia'],
  ['kazakhstan', 'Kazajistán'],
  ['kosovo', 'Kosovo'],
  ['latvia', 'Letonia'],
  ['liechtenstein', 'Liechtenstein'],
  ['lithuania', 'Lituania'],
  ['luxembourg', 'Luxemburgo'],
  ['malta', 'Malta'],
  ['moldova', 'Moldavia'],
  ['montenegro', 'Montenegro'],
  ['netherlands', 'Países Bajos'],
  ['north macedonia', 'Macedonia del Norte'],
  ['northern ireland', 'Irlanda del Norte'],
  ['norway', 'Noruega'],
  ['poland', 'Polonia'],
  ['portugal', 'Portugal'],
  ['republic of ireland', 'Irlanda'],
  ['romania', 'Rumania'],
  ['russia', 'Rusia'],
  ['san marino', 'San Marino'],
  ['scotland', 'Escocia'],
  ['serbia', 'Serbia'],
  ['slovakia', 'Eslovaquia'],
  ['slovenia', 'Eslovenia'],
  ['spain', 'España'],
  ['sweden', 'Suecia'],
  ['switzerland', 'Suiza'],
  ['turkey', 'Turquía'],
  ['turkiye', 'Turquía'],
  ['ukraine', 'Ucrania'],
  ['wales', 'Gales'],
  ['argentina', 'Argentina'],
  ['bolivia', 'Bolivia'],
  ['brazil', 'Brasil'],
  ['chile', 'Chile'],
  ['colombia', 'Colombia'],
  ['ecuador', 'Ecuador'],
  ['paraguay', 'Paraguay'],
  ['peru', 'Perú'],
  ['uruguay', 'Uruguay'],
  ['venezuela', 'Venezuela'],
  ['canada', 'Canadá'],
  ['costa rica', 'Costa Rica'],
  ['cuba', 'Cuba'],
  ['dominican republic', 'República Dominicana'],
  ['el salvador', 'El Salvador'],
  ['guatemala', 'Guatemala'],
  ['haiti', 'Haití'],
  ['honduras', 'Honduras'],
  ['jamaica', 'Jamaica'],
  ['mexico', 'México'],
  ['panama', 'Panamá'],
  ['trinidad and tobago', 'Trinidad y Tobago'],
  ['united states', 'Estados Unidos'],
  ['usa', 'Estados Unidos'],
]);

function normalizeTeamNameKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function spanishNationalTeamName(name) {
  const key = normalizeTeamNameKey(name);
  return NATIONAL_TEAM_ES.get(key) || String(name || '').trim();
}

export function nationalTeamMarketTranslations({ leagueCode, homeName, awayName, winnerOnly = false } = {}) {
  if (!NATIONAL_TEAM_LEAGUE_CODES.has(leagueCode)) return null;
  const home = String(homeName || '').trim();
  const away = String(awayName || '').trim();
  if (!home || !away) return null;

  const homeEs = spanishNationalTeamName(home);
  const awayEs = spanishNationalTeamName(away);
  return {
    es: {
      question: `${homeEs} vs ${awayEs}`,
      outcomes: winnerOnly ? [homeEs, awayEs] : [homeEs, 'Empate', awayEs],
    },
    en: {
      question: `${home} vs ${away}`,
      outcomes: winnerOnly ? [home, away] : [home, 'Draw', away],
    },
  };
}
