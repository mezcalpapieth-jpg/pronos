// ─── MARKETS DATA ─────────────────────────────────────────────────────────────
// Curated pinned markets — always shown even when Gamma API is unavailable.
// Includes real Polymarket markets (with live clobTokenIds) + local-only markets.
//
// Categories: 'musica' | 'mexico' | 'politica' | 'deportes' | 'crypto'

const MARKETS = [

  // ── MERCADOS CERRADOS / RESUELTOS ─────────────────────────────────────────

  {
    id: 'marco-verde-vs-alexander-moreno-mar-2026',
    category: 'deportes',
    categoryLabel: 'DEPORTES · BOX',
    icon: '🥊',
    title: '¿Marco Verde gana vs Alexander Moreno?',
    deadline: '14 Mar 2026',
    options: [
      { label: 'Sí — Marco Verde', pct: 82 },
      { label: 'No — Alexander Moreno', pct: 18 },
    ],
    volume: '4.2K',
    _source: 'local',
    _resolved: true,
    _winner: 'Sí — Marco Verde',
    _winnerShort: 'Marco Verde',
    _resolvedDate: '14 Mar 2026',
    _resolvedBy: 'Decisión Unánime · 80–72',
    _description: 'Marco Verde (5-0, 4 KOs) venció a Alexander Moreno por decisión unánime en CODE Alcalde, Guadalajara. Los tres jueces marcaron 80-72 a favor del tapatío. Verde controló el combate a las 162 libras durante los 8 rounds.',
  },

  // ── REAL POLYMARKET MARKETS (live trading) ────────────────────────────────

  // Liga MX — Necaxa vs Mazatlán (3 Apr 2026)
  {
    id: 'mex-nec-maz-2026-04-03-nec',
    category: 'deportes',
    categoryLabel: 'DEPORTES',
    icon: '⚽',
    trending: true,
    title: '¿Necaxa gana vs Mazatlán? (3 Abr)',
    deadline: '3 Abr 2026',
    options: [
      { label: 'Sí', pct: 58 },
      { label: 'No', pct: 42 },
    ],
    volume: '162',
    _polyId: '1525611',
    _conditionId: '0x208cbe4bdcbbb28a8df7ddfb5ad699def622dacbd63a0c4cb96ff8e8df501139',
    _clobTokenIds: [
      '77394589314273047176568680691525543304841643154702224462193497636137007217755',
      '41667149174398288098415469186570470697177723479335914813154161094903025174568',
    ],
    _acceptingOrders: true,
    _isNegRisk: true,
    _source: 'polymarket',
  },
  {
    id: 'mex-nec-maz-2026-04-03-draw',
    category: 'deportes',
    categoryLabel: 'DEPORTES',
    icon: '⚽',
    title: '¿Empate: Necaxa vs Mazatlán? (3 Abr)',
    deadline: '3 Abr 2026',
    options: [
      { label: 'Sí', pct: 23 },
      { label: 'No', pct: 77 },
    ],
    volume: '162',
    _polyId: '1525612',
    _conditionId: '0x6d8035eeed0290f66da026af25b0de867f890a8b77a58ddf067074070ed3fe32',
    _clobTokenIds: [
      '83847016947771134795170932112300428979210353055426758677042559534496504011650',
      '50201017773113644177600806769566529858789099716179820255494770424826189630279',
    ],
    _acceptingOrders: true,
    _isNegRisk: true,
    _source: 'polymarket',
  },
  {
    id: 'mex-nec-maz-2026-04-03-maz',
    category: 'deportes',
    categoryLabel: 'DEPORTES',
    icon: '⚽',
    title: '¿Mazatlán gana vs Necaxa? (3 Abr)',
    deadline: '3 Abr 2026',
    options: [
      { label: 'Sí', pct: 20 },
      { label: 'No', pct: 80 },
    ],
    volume: '162',
    _polyId: '1525613',
    _conditionId: '0xb11839be7f61158c33de773cff3675fe8dfc5b493bc49692824d0aa805b2aa1d',
    _clobTokenIds: [
      '27037302661516870303741185014477959221601278616311836117438006929915674638424',
      '25703172273627663511159353403914391421960710522731080286402696740151800928749',
    ],
    _acceptingOrders: true,
    _isNegRisk: true,
    _source: 'polymarket',
  },

  // México política
  {
    id: 'claudia-sheinbaum-out-as-president-of-mexico-by-june-30-791',
    category: 'mexico',
    categoryLabel: 'MÉXICO & CDMX',
    icon: '🇲🇽',
    trending: true,
    title: '¿Sheinbaum deja la presidencia antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 5 },
      { label: 'No', pct: 95 },
    ],
    volume: '120K',
    _polyId: '648896',
    _conditionId: '0x5649a937907e0db6814f3fcbfa68e9f78a700d8c0e38ce652a572d97e205640d',
    _clobTokenIds: [
      '99309837432474218579509000241868648485226597214018334052948341435179812240487',
      '46743651657215767615101494273962569398575819779915611903531671068810271446978',
    ],
    _acceptingOrders: true,
    _isNegRisk: false,
    _source: 'polymarket',
  },

  // México inflación anual 2026 — banda más probable: 4.00–4.49%
  {
    id: 'will-mexicos-2026-annual-inflation-be-between-4pt00-and-4pt49',
    category: 'mexico',
    categoryLabel: 'MÉXICO & CDMX',
    icon: '📈',
    title: '¿Inflación anual de México 4.00–4.49% en 2026?',
    deadline: '8 Ene 2027',
    options: [
      { label: 'Sí', pct: 33 },
      { label: 'No', pct: 67 },
    ],
    volume: '685',
    _polyId: '1353325',
    _conditionId: '0x92db92b0c2a161440cb8500db98b5883c475e5a5e3b869990fb4276bd1f70a04',
    _clobTokenIds: [
      '79402468117150049985541869481803337023372823866628213782593630232147374951131',
      '41838913932541828561897820972772297490970389046701828827596658443777194835564',
    ],
    _acceptingOrders: true,
    _isNegRisk: true,
    _source: 'polymarket',
  },

  // FIFA World Cup 2026 — LATAM teams
  {
    id: 'will-argentina-win-the-2026-fifa-world-cup-245',
    category: 'deportes',
    categoryLabel: 'DEPORTES',
    icon: '⚽',
    trending: true,
    title: '¿Argentina gana el Mundial 2026?',
    deadline: '20 Jul 2026',
    options: [
      { label: 'Sí', pct: 10 },
      { label: 'No', pct: 90 },
    ],
    volume: '5.1M',
    _polyId: '558938',
    _conditionId: '0x0c4cd2055d6ea89354ffddc55d6dbcef9355748112ea952fc925f3db6a5c457f',
    _clobTokenIds: [
      '18812649149814341758733697580460697418474693998558159483117100240528657629879',
      '115428153746996892211798999366308897078723117634059783423375188043903703749062',
    ],
    _acceptingOrders: true,
    _isNegRisk: false,
    _source: 'polymarket',
  },
  {
    id: 'will-brazil-win-the-2026-fifa-world-cup-183',
    category: 'deportes',
    categoryLabel: 'DEPORTES',
    icon: '⚽',
    trending: true,
    title: '¿Brasil gana el Mundial 2026?',
    deadline: '20 Jul 2026',
    options: [
      { label: 'Sí', pct: 9 },
      { label: 'No', pct: 91 },
    ],
    volume: '5.8M',
    _polyId: '558937',
    _conditionId: '0x30d55d8124ee1e12dabe89201badc45669b81dff69e4ce44d961f32878ec178a',
    _clobTokenIds: [
      '27576533317283401577758999384642760405921738493660383550832555714312627457443',
      '52986718774908357330412653486471347449818893503063830313445318937088822580057',
    ],
    _acceptingOrders: true,
    _isNegRisk: false,
    _source: 'polymarket',
  },
  {
    id: 'will-mexico-win-the-2026-fifa-world-cup-529',
    category: 'deportes',
    categoryLabel: 'DEPORTES',
    icon: '⚽',
    trending: true,
    title: '¿México gana el Mundial 2026?',
    deadline: '20 Jul 2026',
    options: [
      { label: 'Sí', pct: 1 },
      { label: 'No', pct: 99 },
    ],
    volume: '6.4M',
    _polyId: '558945',
    _conditionId: '0x5ccfe1b69a582d2985db08a8481a0d74c314b1fce9b4711ae2efb2c6467fe6aa',
    _clobTokenIds: [
      '22587775301869146748237913050505932485648958481571808324285560650057390882036',
      '89041006475364789358805026139650677807087698981377208157664917554760333198878',
    ],
    _acceptingOrders: true,
    _isNegRisk: false,
    _source: 'polymarket',
  },
  {
    id: 'will-colombia-win-the-2026-fifa-world-cup-734',
    category: 'deportes',
    categoryLabel: 'DEPORTES',
    icon: '⚽',
    trending: true,
    title: '¿Colombia gana el Mundial 2026?',
    deadline: '20 Jul 2026',
    options: [
      { label: 'Sí', pct: 2 },
      { label: 'No', pct: 98 },
    ],
    volume: '6.7M',
    _polyId: '558947',
    _conditionId: '0xe99cc59f32b10d23acf196d1a0e8264ea30fca198428acadd3464b06ff60e771',
    _clobTokenIds: [
      '98803390175521456712653678280474920637934596234667490983228578374641217211132',
      '66826965351166675155887515167306086307412332225034738589879767944935462342380',
    ],
    _acceptingOrders: true,
    _isNegRisk: false,
    _source: 'polymarket',
  },
  {
    id: 'will-uruguay-win-the-2026-fifa-world-cup-932',
    category: 'deportes',
    categoryLabel: 'DEPORTES',
    icon: '⚽',
    title: '¿Uruguay gana el Mundial 2026?',
    deadline: '20 Jul 2026',
    options: [
      { label: 'Sí', pct: 1 },
      { label: 'No', pct: 99 },
    ],
    volume: '6.4M',
    _polyId: '558944',
    _conditionId: '0x7876851632c295043c66536150a304cb785abdf712ba8489d298c6e6926be106',
    _clobTokenIds: [
      '97239126062673310243763617236644392945530356142765650402171508075574679292913',
      '19291692040378529618917910599727571242305935029274321291612270922648172794670',
    ],
    _acceptingOrders: true,
    _isNegRisk: false,
    _source: 'polymarket',
  },
  {
    id: 'will-neymar-play-in-the-2026-fifa-world-cup-for-brazil',
    category: 'deportes',
    categoryLabel: 'DEPORTES',
    icon: '⚽',
    trending: true,
    title: '¿Neymar juega en el Mundial 2026?',
    deadline: '19 Jul 2026',
    options: [
      { label: 'Sí', pct: 33 },
      { label: 'No', pct: 67 },
    ],
    volume: '52K',
    _polyId: '1630444',
    _conditionId: '0xb60c044bba6f7958768691345df1e102448a5b7ef16e4a08879bb10483fb4567',
    _clobTokenIds: [
      '80207472021384297118973019586454872993681152265019994763786199494584900056700',
      '107098542201783055920424291421395338045200803098880539507226838033025467884946',
    ],
    _acceptingOrders: true,
    _isNegRisk: false,
    _source: 'polymarket',
  },

  // Brazil 2026 Presidential Election
  {
    id: 'will-luiz-incio-lula-da-silva-win-the-2026-brazilian-presidential-election',
    category: 'politica',
    categoryLabel: 'POLÍTICA INTERNACIONAL',
    icon: '🗳️',
    trending: true,
    title: '¿Lula gana la presidencia de Brasil 2026?',
    deadline: '4 Oct 2026',
    options: [
      { label: 'Sí', pct: 44 },
      { label: 'No', pct: 56 },
    ],
    volume: '4.1M',
    _polyId: '601819',
    _conditionId: '0xdf8e2dc5860027decbe6164555c3c1c9645c3bd33e16b9dc57ca87125047d4a8',
    _clobTokenIds: [
      '30630994248667897740988010928640156931882346081873066002335460180076741328029',
      '79191939610100241429039499950443680906623179487184628479206155805558220344190',
    ],
    _acceptingOrders: true,
    _isNegRisk: false,
    _source: 'polymarket',
  },

  // Venezuela leadership
  {
    id: 'will-delcy-rodrguez-be-the-leader-of-venezuela-end-of-2026',
    category: 'politica',
    categoryLabel: 'POLÍTICA INTERNACIONAL',
    icon: '🇻🇪',
    trending: true,
    title: '¿Delcy Rodríguez lidera Venezuela a fin de 2026?',
    deadline: '31 Dic 2026',
    options: [
      { label: 'Sí', pct: 64 },
      { label: 'No', pct: 36 },
    ],
    volume: '1.2M',
    _polyId: '1105742',
    _conditionId: '0xa01d48a973e40770719dab42faf1aeae5da4376d9eca46e77265c7551d1be0f7',
    _clobTokenIds: [
      '38667196958602416137463628517439560119304765709104570192447644733106171420112',
      '6638895201070039547671726076818069674458322142629985177641367819559425166288',
    ],
    _acceptingOrders: true,
    _isNegRisk: false,
    _source: 'polymarket',
  },

  // Bitcoin
  {
    id: 'will-bitcoin-dip-to-65k-in-march-2026',
    category: 'crypto',
    categoryLabel: 'CRYPTO',
    icon: '₿',
    trending: true,
    title: '¿Bitcoin baja a $65K en marzo 2026?',
    deadline: '1 Abr 2026',
    options: [
      { label: 'Sí', pct: 17 },
      { label: 'No', pct: 83 },
    ],
    volume: '7.9M',
    _polyId: '1473072',
    _conditionId: '0x36912c9832f0fd104d734b579fb9b3a1b31bbdc946a67356723407e3bdc96dbc',
    _clobTokenIds: [
      '112493481455469093769281852159558847572704253342416714876781522096078968514094',
      '64087619211543545431479218048939484178441767712621033463416084593776314629222',
    ],
    _acceptingOrders: true,
    _isNegRisk: false,
    _source: 'polymarket',
  },

];

export default MARKETS;
