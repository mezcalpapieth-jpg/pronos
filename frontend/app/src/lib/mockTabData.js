// ─── MOCK TAB DATA GENERATOR ──────────────────────────────────────────────────
const NAMES = [
  'TigreNegro','Chilango888','Mxndegen','CriptoLupe','PesoPlaya',
  'BaseMXN','TradeBro','AnonMX77','0xAzteca','Defi_Rey',
  'PredictorMX','VolatilVerde','Hodlero','ChainMaestro','GweiGuru',
  'MercadoMax','CryptoConcho','OnChainOscar','PronosHero','BlockBeto',
  'LiquidoLuis','SmartBetSam','DegenerateD','ArbGod','NftNana',
];

const seeded = (seed) => {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
};
const item = (arr, r) => arr[Math.floor(r() * arr.length)];
const int  = (mn, mx, r) => Math.floor(r() * (mx - mn + 1)) + mn;
const flt  = (mn, mx, r) => r() * (mx - mn) + mn;

export function generateMockData(market) {
  const seed = market.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const r = seeded(seed);
  const opt0 = market.options?.[0]?.label ?? 'Sí';
  const opt1 = market.options?.[1]?.label ?? 'No';

  /* RULES */
  const rules = {
    resolution: `Este mercado se resolverá como "${opt0}" si el evento ocurre antes de la fecha de cierre según fuentes de noticias creíbles. De lo contrario, se resolverá como "${opt1}".`,
    additional: [
      'La resolución se basará en consenso de al menos 3 fuentes de noticias reconocidas.',
      'En caso de ambigüedad, el equipo de Pronos determinará la resolución con base en evidencia disponible.',
      'Los mercados pueden cerrarse anticipadamente si el resultado es definitivo antes de la fecha límite.',
    ],
    closes: market.deadline ?? null,
  };

  /* CONTEXT */
  const ctxMap = {
    deportes: `El mercado refleja la opinión colectiva de los traders sobre este evento deportivo. Los datos se actualizan en tiempo real con cada operación. Los participantes de mayor posición suelen tener información adicional sobre lesiones, historial reciente y condiciones del encuentro.`,
    musica:   `Este mercado captura el sentimiento del ecosistema de predicciones sobre entretenimiento. Las probabilidades reflejan información pública, rumores verificados y patrones históricos del artista. La actividad reciente muestra movimiento hacia el lado ${opt0} conforme se acerca la fecha límite.`,
    mexico:   `Mercado de predicción sobre eventos en México. Las probabilidades son determinadas por la oferta y demanda, incorporando información de fuentes oficiales, medios de comunicación y análisis político. Históricamente este tipo de mercado correlaciona bien con resultados reales.`,
    politica: `Los mercados políticos en Pronos son indicadores adelantados con alta correlación histórica. Los traders incorporan encuestas, análisis de gabinetes y señales de mercado global. El volumen indica fuerte convicción de los participantes.`,
    crypto:   `Mercado de predicción sobre activos digitales. Los precios de resolución se determinarán usando el precio de cierre en exchanges de referencia. Los traders consideran datos on-chain, flujos de exchanges y movimientos de ballenas para sus posiciones.`,
  };
  const context = ctxMap[market.category] || ctxMap['mexico'];

  /* COMMENTS */
  const tmpls = [
    (a,b) => `El lado ${a} tiene mucha más información que el mercado. Cuidado con el ${b}.`,
    (a)   => `Llevo 3 semanas en ${a} y no me muevo. El volumen lo confirma.`,
    (a,b) => `¿Alguien más vio el movimiento de anoche? De 60/40 a 70/30 en ${a}. Algo saben.`,
    (a)   => `Entrada en ${a} a buen precio. Stop loss mental en 45%. A esperar.`,
    (a,b) => `Los holders grandes están en ${b}. Yo prefiero seguir el dinero inteligente.`,
    (a)   => `Este mercado debería estar mucho más cargado en ${a}. Todavía hay valor.`,
    ()    => `¿Cuándo resuelve exactamente? ¿Al cierre del evento o al día siguiente?`,
    (a,b) => `${a} vs ${b} — el spread está raro. Posible oportunidad de arbitraje.`,
    (a)   => `Compré más ${a} hoy. El precio era demasiado bueno para dejarlo pasar.`,
    ()    => `Primera vez en Pronos. ¿Cómo funciona la liquidación exactamente?`,
  ];
  const comments = Array.from({ length: int(6,12,r) }, (_,i) => {
    const rc = seeded(seed + i*137);
    return {
      id: i, user: item(NAMES,rc), holding: int(500,80000,rc),
      time: (() => { const m = int(5,480,rc); return m<60?`${m}m`:`${Math.floor(m/60)}h`; })(),
      text: tmpls[int(0,tmpls.length-1,rc)](opt0,opt1),
      likes: int(0,24,rc), replies: int(0,8,rc), side: rc()>0.5?'yes':'no',
    };
  });

  /* TOP HOLDERS */
  const yesHolders = Array.from({length:12},(_,i)=>{const rh=seeded(seed+i*31+1000);return{user:item(NAMES,rh),shares:int(40000,800000,rh)};}).sort((a,b)=>b.shares-a.shares);
  const noHolders  = Array.from({length:12},(_,i)=>{const rh=seeded(seed+i*53+2000);return{user:item(NAMES,rh),shares:int(40000,800000,rh)};}).sort((a,b)=>b.shares-a.shares);

  /* POSITIONS */
  const yesPositions = Array.from({length:12},(_,i)=>{const rp=seeded(seed+i*71+3000);return{user:item(NAMES,rp),avg:flt(0.04,0.35,rp).toFixed(1)+'¢',pnl:flt(800,55000,rp)};}).sort((a,b)=>b.pnl-a.pnl);
  const noPositions  = Array.from({length:12},(_,i)=>{const rp=seeded(seed+i*89+4000);return{user:item(NAMES,rp),avg:flt(0.55,0.92,rp).toFixed(1)+'¢',pnl:flt(200,40000,rp)};}).sort((a,b)=>b.pnl-a.pnl);

  /* ACTIVITY */
  const activity = Array.from({length:20},(_,i)=>{
    const ra=seeded(seed+i*17+5000);
    const sell=ra()>0.45; const side=ra()>0.5?opt0:opt1;
    const mins=int(1,720,ra);
    return{id:i,user:item(NAMES,ra),action:sell?'Vendió':'Compró',side,amount:int(50,8000,ra),price:flt(0.05,0.95,ra).toFixed(2),time:mins<60?`${mins}m`:`${Math.floor(mins/60)}h`,isYes:side===opt0};
  });

  return { rules, context, comments, yesHolders, noHolders, yesPositions, noPositions, activity };
}
