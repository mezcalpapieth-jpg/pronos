// Curated read-only preview. Prices and availability reflect the recorded snapshot.
const POLY_CAPTURED_AT = '2026-11-17T21:41:49Z';
const HIP_CAPTURED_AT = '2026-11-17T21:39:08Z';
const HIP_PRICE_CAPTURED_AT = '2026-11-17T21:45:38Z';
const LIGA_MX = 'https://ligamx.net/cancha/partidos';
const OUTCOME_MARKET = 'https://outcome.xyz/markets/sports/q653';
const OUTCOME_RULES = 'https://app.totalis.trade/question/653/coventry-city-v-crystal-palace';
const HIP_TEMPLATES = 'https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot#retrieve-outcome-templates';
const TRADE_XYZ_EVENTS = 'https://app.trade.xyz/events';
const SKEW_MARKETS = 'https://app.skew.trade/';
const TRADING_CUTOFF = { label: 'Cierre de negociación', value: 'Sin horario verificado en la fuente' };
const HIP_FACTS = [{ label: 'Colateral', value: 'USDC' }];

const binaryOutcomes = (yes, no) => [
  { label: 'Sí', value: yes },
  { label: 'No', value: no },
];

function ligaMxMarket({ id, slug, title, officialTitle, team, sourceId, kickoff, deadline, outcomes }) {
  const sourceUrl = `https://polymarket.com/sports/mex/${slug}?marketSlug=${slug}-${team}`;
  return {
    id,
    title,
    officialTitle,
    category: 'Deportes',
    venue: 'polymarket',
    network: 'Polygon',
    sourceUrl,
    rulesUrl: sourceUrl,
    resolutionSourceUrl: LIGA_MX,
    sourceId,
    statusLabel: 'Aceptaba órdenes al capturarse',
    capturedAt: POLY_CAPTURED_AT,
    facts: [{ label: 'Orden mínima publicada', value: '5 acciones' }],
    outcomes,
    schedule: [
      { label: 'Inicio del partido', at: kickoff },
      { label: 'Límite previsto en caso de partido sin resultado', at: deadline },
      TRADING_CUTOFF,
    ],
    rules: [
      {
        title: 'Resultado del partido',
        text: 'Sí si el equipo indicado gana en los 90 minutos reglamentarios más el tiempo añadido. Cualquier otro resultado da No.',
      },
      {
        title: 'Cancelación o abandono',
        text: 'Una conclusión ya determinada se conserva. Si se cancela el partido, no empieza a tiempo o queda sin resultado oficial al vencer el plazo, el contrato resuelve No. Cuenta el resultado que la liga adjudique o ratifique, o el de un partido reanudado o repetido, si se oficializa antes del plazo.',
      },
      {
        title: 'Fuentes y correcciones',
        text: 'Liga MX es la fuente principal. A las dos horas de terminado el partido, si la liga sigue sin publicar un resultado, se puede usar Flashscore, luego Sofascore y después un consenso de fuentes fiables. Si faltan datos aceptables a las 24 horas, resuelve No. Las correcciones posteriores a la resolución no se aplican.',
      },
      {
        title: 'Identificación de los equipos',
        text: 'Se aceptan variantes del nombre cuando el equipo se puede identificar inequívocamente. Si la identidad es ambigua, se aplican las reglas de cancelación.',
      },
    ],
  };
}

function outcomeMatch({ id, title, officialTitle, sourceId, condition, outcomes }) {
  return {
    id,
    title,
    officialTitle,
    category: 'Deportes',
    venue: 'outcome',
    network: 'HyperCore · HIP-4',
    sourceUrl: OUTCOME_MARKET,
    rulesUrl: OUTCOME_RULES,
    resolutionSourceUrl: 'https://www.premierleague.com/',
    sourceId: `out:${sourceId} · pregunta 653`,
    statusLabel: 'Listado en HyperCore al capturarse',
    capturedAt: HIP_CAPTURED_AT,
    facts: [
      ...HIP_FACTS,
      { label: 'Referencia de precio', value: 'Punto medio del libro de HyperCore' },
    ],
    priceCapturedAt: HIP_PRICE_CAPTURED_AT,
    outcomes,
    schedule: [
      { label: 'Inicio del partido según el contrato', at: '2026-11-21T15:00:00Z' },
      { label: 'Límite de resolución', at: '2027-02-21T15:00:00Z' },
      TRADING_CUTOFF,
    ],
    rules: [
      { title: 'Cuándo paga Sí', text: condition },
      {
        title: 'Tiempo reglamentario',
        text: 'Cuenta el resultado de los 90 minutos más el tiempo añadido en la jornada 11 de la Premier League 2026/27. Quedan fuera el tiempo extra y los penales de desempate. Solo uno de los tres contratos de la pregunta puede resolver Sí.',
      },
      {
        title: 'Partido interrumpido o reprogramado',
        text: 'Sigue contando un partido aplazado, reanudado o repetido entre los mismos equipos en la misma jornada. Si no se completó el tiempo reglamentario, se acepta un resultado por decisión administrativa de la liga, como una descalificación o un abandono.',
      },
      {
        title: 'Fuente y confirmación',
        text: 'Se usa el resultado oficial de la Premier League. Si al vencer el plazo no existe una publicación oficial, se usa un consenso claro de fuentes independientes y fiables disponibles para entonces. El resultado oficial se fija una hora después de su primera publicación, o al vencer el plazo si ocurre antes o se usa el consenso. Las correcciones posteriores quedan fuera.',
      },
    ],
  };
}

// The precise comparator is from the deployed binaryPrice template, not the
// text rendered by some contract indexers.
function hipPriceMarket({ id, title, category, venue, contract, price, observation, at, resolutionSourceUrl }) {
  const venueUrl = venue === 'skew' ? SKEW_MARKETS : TRADE_XYZ_EVENTS;
  return {
    id,
    title,
    category,
    venue,
    network: 'HyperCore · HIP-4',
    sourceUrl: `https://hip4markets.com/predictions/${contract}`,
    sourceIsOfficial: false,
    venueUrl,
    rulesUrl: HIP_TEMPLATES,
    rulesLabel: 'Ver plantilla de resolución de Hyperliquid',
    resolutionSourceUrl,
    sourceId: `${venue === 'skew' ? 'skew' : 'txyz'}:${contract}`,
    statusLabel: 'Listado en HyperCore al capturarse',
    capturedAt: HIP_CAPTURED_AT,
    facts: HIP_FACTS,
    outcomes: binaryOutcomes(),
    schedule: [
      { label: 'Fin de la ventana de referencia', at },
      TRADING_CUTOFF,
    ],
    rules: [
      {
        title: 'Umbral de resolución',
        text: `Sí si el precio de referencia supera US$${price}. Un precio igual o inferior resuelve No.`,
      },
      {
        title: 'Cálculo del precio de referencia',
        text: `Se usa el promedio ponderado por tiempo (TWAP) de ${observation}. La ventana termina a la hora indicada.`,
      },
      {
        title: 'Retiro del mercado subyacente',
        text: 'Si el perpetuo subyacente se retira antes de que se liquide este contrato, se usa el precio de liquidación del perpetuo al momento del retiro.',
      },
    ],
  };
}

const MARKETS = [
  ligaMxMarket({
    id: 'puebla-atletico-san-luis',
    slug: 'mex-pue-asl-2026-11-20',
    title: '¿Gana Puebla ante Atlético San Luis?',
    officialTitle: 'Will Club Puebla win on 2026-11-20?',
    team: 'pue',
    sourceId: '6805659',
    kickoff: '2026-11-21T01:00:00Z',
    deadline: '2026-11-23T04:59:00Z',
    outcomes: binaryOutcomes('US$0.39', 'US$0.61'),
  }),
  ligaMxMarket({
    id: 'tigres-america',
    slug: 'mex-tig-ame-2026-11-21',
    title: '¿Gana Tigres ante América?',
    officialTitle: 'Will Tigres de la UANL win on 2026-11-21?',
    team: 'tig',
    sourceId: '6875243',
    kickoff: '2026-11-22T03:00:00Z',
    deadline: '2026-11-24T04:59:00Z',
    outcomes: binaryOutcomes('US$0.29', 'US$0.71'),
  }),
  outcomeMatch({
    id: 'coventry-crystal-palace-gana',
    title: '¿Gana Crystal Palace ante Coventry City?',
    officialTitle: 'Coventry City v Crystal Palace · Crystal Palace',
    sourceId: 37286,
    condition: 'Sí si Crystal Palace es el único ganador según el resultado válido del partido. Si gana Coventry, hay empate o no se establece un resultado válido a tiempo, resuelve No.',
    outcomes: binaryOutcomes('0.334 USDC', '0.666 USDC'),
  }),
  outcomeMatch({
    id: 'coventry-crystal-palace-empata',
    title: '¿Empatan Coventry City y Crystal Palace?',
    officialTitle: 'Coventry City v Crystal Palace · Draw',
    sourceId: 37285,
    condition: 'Sí si el resultado válido es un empate. También resuelve Sí si el partido queda sin ganador, se anula, el único ganador no figura en el mercado o no se obtiene un resultado válido a tiempo.',
    outcomes: binaryOutcomes('0.269 USDC', '0.731 USDC'),
  }),
  hipPriceMarket({
    id: 'oro-4400-noviembre',
    title: '¿Supera el oro los US$4,400 al cierre de noviembre?',
    category: 'Finanzas',
    venue: 'trade-xyz',
    contract: 23733,
    price: '4,400',
    observation: 'las velas de un minuto de xyz:GOLD durante 300 segundos',
    at: '2026-11-30T21:00:00Z',
    resolutionSourceUrl: 'https://docs.trade.xyz/events/resolution/',
  }),
  hipPriceMarket({
    id: 'oro-3600-noviembre',
    title: '¿Supera el oro los US$3,600 al cierre de noviembre?',
    category: 'Finanzas',
    venue: 'trade-xyz',
    contract: 23757,
    price: '3,600',
    observation: 'las velas de un minuto de xyz:GOLD durante 300 segundos',
    at: '2026-11-30T21:00:00Z',
    resolutionSourceUrl: 'https://docs.trade.xyz/events/resolution/',
  }),
  hipPriceMarket({
    id: 'bitcoin-67000-20-nov',
    title: '¿Supera Bitcoin los US$67,000 el 20 de noviembre?',
    category: 'Cripto',
    venue: 'skew',
    contract: 34366,
    price: '67,000',
    observation: 'la fuente BTC/USD de Pyth durante 90 segundos',
    at: '2026-11-20T08:00:00Z',
  }),
  hipPriceMarket({
    id: 'ether-2113-20-nov',
    title: '¿Supera Ether los US$2,113 el 20 de noviembre?',
    category: 'Cripto',
    venue: 'skew',
    contract: 34378,
    price: '2,113',
    observation: 'la fuente ETH/USD de Pyth durante 90 segundos',
    at: '2026-11-20T08:00:00Z',
  }),
  {
    id: 'anthropic-ipo-1750',
    title: '¿Supera Anthropic los US$1.75 billones en su primer día en bolsa?',
    category: 'Finanzas',
    venue: 'skew',
    network: 'HyperCore · HIP-4',
    sourceUrl: 'https://hip4markets.com/predictions/19822',
    sourceIsOfficial: false,
    venueUrl: SKEW_MARKETS,
    rulesUrl: HIP_TEMPLATES,
    rulesLabel: 'Ver plantilla de resolución de Hyperliquid',
    sourceId: 'skew:19822',
    statusLabel: 'Listado en HyperCore al capturarse',
    capturedAt: HIP_CAPTURED_AT,
    facts: HIP_FACTS,
    outcomes: binaryOutcomes(),
    schedule: [
      { label: 'Límite para completar la primera sesión bursátil', at: '2027-05-01T03:59:00Z' },
      { label: 'Límite de publicación de evidencia', value: '7 días después del cierre de esa sesión o del límite anterior, lo que ocurra primero' },
      TRADING_CUTOFF,
    ],
    rules: [
      {
        title: 'Valor al cierre',
        text: 'Sí si la capitalización de Anthropic supera US$1.75 billones al cierre de su primera sesión regular. Si queda en el umbral o por debajo, resuelve No.',
      },
      {
        title: 'Oferta elegible',
        text: 'Debe ser la primera oferta pública de acciones ordinarias para cotizar en una bolsa regulada. Quedan fuera el listado directo, una operación mediante SPAC y una fusión inversa.',
      },
      {
        title: 'Cálculo y fuentes',
        text: 'Se multiplica el precio de cierre oficial de la bolsa por las acciones ordinarias en circulación tras la oferta, excluida la sobreasignación, según el prospecto final. Para convertir a dólares se usa la tasa del FMI, del BCE o del banco central correspondiente, en ese orden.',
      },
      {
        title: 'Falta de evidencia o de oferta elegible',
        text: 'Resuelve 50/50 si la oferta no reúne los requisitos, Anthropic no se puede identificar inequívocamente, no cierra una primera sesión regular a tiempo o falta un dato esencial al vencer el plazo de evidencia. La resolución ocurre después de ese plazo.',
      },
    ],
  },
];

export function getExternalMarkets() {
  return MARKETS;
}
