const SOURCE = 'gilberto-mora-transfer-2026';
const SOURCE_EVENT_ID = 'gilberto-mora-europe-destination-2026-10-31';
const CLOSE_ISO = '2026-11-01T05:59:59.000Z';

const FOX_SPORTS_URL = 'https://www.foxsports.com.mx/2026/10/01/liverpool-prepara-oferta-millonaria-fichaje-gilberto-mora-tijuana-40-millones-libras-mexico/';
const INFORMADOR_URL = 'https://www.informador.mx/deportes/liverpool-va-por-gilberto-mora-y-pelea-con-dos-clubes-su-fichaje-20261001-0136.html';
const AS_URL = 'https://as.com/futbol/internacional/mensaje-de-gilberto-mora-a-real-madrid-y-barcelona-f202609-n/';
const LIVERPOOL_MEDIA_WATCH_URL = 'https://www.liverpoolfc.com/news/liverpool-showing-serious-interest-mexican-sensation';

const DESTINATIONS = [
  { slug: 'liverpool', name: 'Liverpool', country: 'England', kind: 'listed-european-club' },
  { slug: 'real-madrid', name: 'Real Madrid', country: 'Spain', kind: 'listed-european-club' },
  { slug: 'barcelona', name: 'Barcelona', country: 'Spain', kind: 'listed-european-club' },
  { slug: 'borussia-dortmund', name: 'Borussia Dortmund', country: 'Germany', kind: 'listed-european-club' },
  { slug: 'benfica', name: 'Benfica', country: 'Portugal', kind: 'listed-european-club' },
  { slug: 'paris-saint-germain', name: 'Paris Saint-Germain', country: 'France', kind: 'listed-european-club' },
  { slug: 'bayern-munich', name: 'Bayern Munich', country: 'Germany', kind: 'listed-european-club' },
  { slug: 'other-european-club', name: 'Otro club europeo', country: 'Europe', kind: 'other-european-club' },
  { slug: 'stays-in-mexico', name: 'Sigue en México después del 31 de octubre', country: 'Mexico', kind: 'no-european-move' },
];

const PROBABILITIES = [
  0.24,
  0.11,
  0.10,
  0.09,
  0.08,
  0.07,
  0.05,
  0.06,
  0.20,
];

const EVIDENCE = [
  {
    title: 'FOX Sports Mexico report on Liverpool and European interest',
    url: FOX_SPORTS_URL,
    note: 'Reports Liverpool interest and mentions Real Madrid, Barcelona, and PSG as competing suitors, while noting no official formal offer information.',
  },
  {
    title: 'El Informador report on Mora suitors',
    url: INFORMADOR_URL,
    note: 'Lists Liverpool plus Dortmund, Benfica, Real Madrid, Barcelona, PSG, Bayern Munich and other European clubs as reported suitors.',
  },
  {
    title: 'AS report on Real Madrid and Barcelona monitoring',
    url: AS_URL,
    note: 'Reports Real Madrid and Barcelona are monitoring Mora after his Mexico breakthrough.',
  },
  {
    title: 'Liverpool FC Media Watch item',
    url: LIVERPOOL_MEDIA_WATCH_URL,
    note: 'Media Watch summary says the report is reproduced from media and does not represent Liverpool FC position.',
  },
];

const RESOLUTION_CRITERIA_ES = [
  'Se resuelve con el club europeo que anuncie oficialmente el fichaje, cesion, preacuerdo vinculante o acuerdo de transferencia de Gilberto Mora antes del corte del mercado.',
  'Si un club listado anuncia un acuerdo oficial, gana ese club aunque la incorporacion o registro deportivo ocurra despues.',
  'Si el acuerdo oficial es con un club europeo no listado, gana "Otro club europeo".',
  'Si para el corte no existe anuncio oficial ni registro confirmado de fichaje europeo y Mora permanece registrado o contratado por un club mexicano, gana "Sigue en Mexico despues del 31 de octubre".',
  'Rumores, reportes sin anuncio oficial del club, o contactos preliminares no cuentan para resolver.',
  'Si hay informacion oficial contradictoria o un destino no europeo fuera de Mexico, el mercado pasa a revision manual.',
].join(' ');

const RESOLUTION_CRITERIA_EN = [
  'Resolves to the European club that officially announces a signing, loan, binding pre-agreement, or transfer agreement for Gilberto Mora before the market cutoff.',
  'If a listed club announces an official agreement, that club wins even if the player joins or registers later.',
  'If the official agreement is with an unlisted European club, "Other European club" wins.',
  'If there is no official European signing announcement or confirmed registration by the cutoff and Mora remains registered or contracted with a Mexican club, "Stays in Mexico after October 31" wins.',
  'Rumors, unofficial reports, and preliminary contacts do not count for resolution.',
  'Conflicting official information or a non-European destination outside Mexico sends the market to manual review.',
].join(' ');

function probabilityPct(values) {
  return values.map(value => Math.round(value * 1000) / 10);
}

export async function generateGilbertoMoraTransfer2026Markets() {
  const outcomes = DESTINATIONS.map(destination => destination.name);

  return [{
    source: SOURCE,
    source_event_id: SOURCE_EVENT_ID,
    sport: 'soccer',
    league: 'transfers',
    question: '¿Qué club anunciará el fichaje de Gilberto Mora antes del 1 de noviembre de 2026?',
    category: 'deportes',
    icon: '⚽',
    outcomes,
    seed_liquidity: 1000,
    start_time: null,
    end_time: CLOSE_ISO,
    amm_mode: 'parallel',
    resolver_type: 'manual',
    resolver_config: {
      source: 'manual',
      shape: 'parallel',
      competition: 'soccer-transfer',
      player: {
        name: 'Gilberto Mora',
        currentClub: 'Club Tijuana',
        country: 'Mexico',
      },
      cutoffUtc: CLOSE_ISO,
      cutoffLocal: {
        date: '2026-10-31',
        timezone: 'America/Mexico_City',
      },
      criteria: RESOLUTION_CRITERIA_ES,
      criteriaEn: RESOLUTION_CRITERIA_EN,
      evidence: EVIDENCE,
      legs: DESTINATIONS,
    },
    featured: true,
    tournament_featured: true,
    source_data: {
      kind: 'soccer_transfer_destination',
      player: {
        name: 'Gilberto Mora',
        currentClub: 'Club Tijuana',
        nationality: 'Mexico',
      },
      generatedAt: new Date().toISOString(),
      closeLocal: {
        date: '2026-10-31',
        timezone: 'America/Mexico_City',
        rationale: 'Cierre al final del dia local de Mexico para resolver si existe anuncio oficial de fichaje europeo antes de noviembre.',
      },
      tournament: {
        key: 'october-2026',
        label: 'Torneo octubre 2026',
      },
      destinations: DESTINATIONS,
      currentFieldSource: 'reported-european-transfer-interest',
      resolutionCriteria: RESOLUTION_CRITERIA_ES,
      resolutionCriteriaEn: RESOLUTION_CRITERIA_EN,
      evidence: EVIDENCE,
      sourceUrls: EVIDENCE.map(item => item.url),
      translations: {
        es: {
          question: '¿Qué club anunciará el fichaje de Gilberto Mora antes del 1 de noviembre de 2026?',
          outcomes,
        },
        en: {
          question: 'Which club will announce the signing of Gilberto Mora before November 1, 2026?',
          outcomes: [
            'Liverpool',
            'Real Madrid',
            'Barcelona',
            'Borussia Dortmund',
            'Benfica',
            'Paris Saint-Germain',
            'Bayern Munich',
            'Other European club',
            'Stays in Mexico after October 31',
          ],
        },
      },
      categorization: {
        categoryTags: ['deportes', 'mexico'],
        geoTags: ['mexico', 'world'],
        topicTags: ['deportes'],
      },
      suggestedPricing: {
        source: 'admin-config',
        probabilities: PROBABILITIES,
        probabilityPct: probabilityPct(PROBABILITIES),
        rationale: 'Liverpool is ordered first and has the highest listed-club prior based on current reporting; Mexico remains material because reports still describe timing and official-offer uncertainty.',
        evidence: EVIDENCE,
      },
    },
  }];
}

export const _internal = {
  CLOSE_ISO,
  DESTINATIONS,
  EVIDENCE,
  PROBABILITIES,
  RESOLUTION_CRITERIA_ES,
  RESOLUTION_CRITERIA_EN,
  SOURCE,
  SOURCE_EVENT_ID,
};
