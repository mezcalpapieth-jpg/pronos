// ─── MARKETS DATA ─────────────────────────────────────────────────────────────
// Curated pinned markets — always shown even when Gamma API is unavailable.
// Includes real Polymarket markets (with live clobTokenIds) + local-only markets.
//
// Categories: 'musica' | 'mexico' | 'politica' | 'deportes' | 'crypto'
//
// Every market carries both title (Spanish, default) and title_en (English)
// so the EN/ES toggle can swap consistently across all sources.
// options_en holds just {label} for each option — pct comes from the base
// options array so live prices are never stale.

const YES_NO_EN = [{label:'Yes'},{label:'No'}];

const MARKETS = [

  // ── MERCADOS MOCK (landing page) ──────────────────────────────────────────

  // Entretenimiento
  { id:'bad-bunny-sencillo',   category:'musica',   categoryLabel:'ENTRETENIMIENTO', icon:'', title:'¿Bad Bunny lanza sencillo antes del 30 jun?',           title_en:'Will Bad Bunny release a single before June 30?',            deadline:'30 Jun 2026', options:[{label:'Sí',pct:67},{label:'No',pct:33}], options_en:YES_NO_EN, volume:'1.68M', _source:'local' },
  { id:'peso-pluma-anillo',    category:'musica',   categoryLabel:'ENTRETENIMIENTO', icon:'', title:'¿Peso Pluma da anillo antes del 30 jun?',               title_en:'Will Peso Pluma get engaged before June 30?',                deadline:'30 Jun 2026', options:[{label:'Sí',pct:14},{label:'No',pct:86}], options_en:YES_NO_EN, volume:'1.14M', _source:'local' },
  { id:'nodal-divorcio',       category:'musica',   categoryLabel:'ENTRETENIMIENTO', icon:'', title:'¿Christian Nodal se divorcia antes del 30 jun?',        title_en:'Will Christian Nodal get divorced before June 30?',           deadline:'30 Jun 2026', options:[{label:'Sí',pct:22},{label:'No',pct:78}], options_en:YES_NO_EN, volume:'1.24M', _source:'local' },

  // México & CDMX
  { id:'sismo-cdmx',           category:'mexico',   categoryLabel:'MÉXICO & CDMX',      icon:'🌍', title:'¿Sismo >5.0 en CDMX antes del 30 jun?',                title_en:'Earthquake >5.0 in Mexico City before June 30?',             deadline:'30 Jun 2026', options:[{label:'Sí',pct:71},{label:'No',pct:29}], options_en:YES_NO_EN, volume:'2.24M', _source:'local' },
  { id:'tren-maya-descarrila', category:'mexico',   categoryLabel:'MÉXICO & CDMX',      icon:'🚂', title:'¿Se descarrila el Tren Maya antes del 2027?',          title_en:'Will Tren Maya derail before 2027?',                         deadline:'31 Dic 2026', options:[{label:'Sí',pct:38},{label:'No',pct:62}], options_en:YES_NO_EN, volume:'760K',  _source:'local' },
  { id:'dolar-22-mxn',         category:'mexico',   categoryLabel:'MÉXICO & CDMX',      icon:'💵', title:'¿El dólar llega a $22 MXN antes del 30 jun?',          title_en:'Will USD reach $22 MXN before June 30?',                     deadline:'30 Jun 2026', options:[{label:'Sí',pct:31},{label:'No',pct:69}], options_en:YES_NO_EN, volume:'3.36M', _source:'local' },

  // Política Internacional
  { id:'trump-visita-mexico',  category:'politica', categoryLabel:'POLÍTICA INTERNACIONAL', icon:'🇺🇸', title:'¿Trump visita México antes del 30 jun?',         title_en:'Will Trump visit Mexico before June 30?',                    deadline:'30 Jun 2026', options:[{label:'Sí',pct:5}, {label:'No',pct:95}], options_en:YES_NO_EN, volume:'2.68M', _source:'local' },
  { id:'venezuela-elecciones', category:'politica', categoryLabel:'POLÍTICA INTERNACIONAL', icon:'🗳️', title:'¿Venezuela celebra elecciones libres antes del 30 jun?', title_en:'Will Venezuela hold free elections before June 30?',   deadline:'30 Jun 2026', options:[{label:'Sí',pct:3}, {label:'No',pct:97}], options_en:YES_NO_EN, volume:'840K',  _source:'local' },
  { id:'cuba-embargo',         category:'politica', categoryLabel:'POLÍTICA INTERNACIONAL', icon:'🇨🇺', title:'¿Se levanta el embargo de Cuba antes del 30 jun?', title_en:'Will the Cuba embargo be lifted before June 30?',            deadline:'30 Jun 2026', options:[{label:'Sí',pct:3}, {label:'No',pct:97}], options_en:YES_NO_EN, volume:'580K',  _source:'local' },

  // Deportes
  { id:'checo-puntos',         category:'deportes', categoryLabel:'DEPORTES',           icon:'🏎️', title:'¿Checo Pérez suma puntos antes del 30 jun?',            title_en:'Will Checo Pérez score points before June 30?',              deadline:'30 Jun 2026', options:[{label:'Sí',pct:61},{label:'No',pct:39}], options_en:YES_NO_EN, volume:'2.92M', _source:'local' },
  { id:'mundial-mexico-gana',  category:'deportes', categoryLabel:'DEPORTES',           icon:'⚽',  title:'¿México gana su primer partido del Mundial 2026?',     title_en:'Will Mexico win their first 2026 World Cup match?',          deadline:'15 Jun 2026', options:[{label:'Sí',pct:54},{label:'No',pct:46}], options_en:YES_NO_EN, volume:'9.36M', _source:'local', trending:true },
  { id:'sga-mvp',              category:'deportes', categoryLabel:'DEPORTES',           icon:'🏀',  title:'¿SGA gana el MVP de la NBA 2025-26?',                  title_en:'Will SGA win the 2025-26 NBA MVP?',                          deadline:'30 Jun 2026', options:[{label:'Sí',pct:71},{label:'No',pct:29}], options_en:YES_NO_EN, volume:'7.28M', _source:'local', trending:true },

  // Crypto
  { id:'bitcoin-120k',         category:'crypto',   categoryLabel:'CRYPTO',             icon:'₿',   title:'¿Bitcoin supera $120k USD antes del 30 jun?',          title_en:'Will Bitcoin surpass $120K USD before June 30?',              deadline:'30 Jun 2026', options:[{label:'Sí',pct:12},{label:'No',pct:88}], options_en:YES_NO_EN, volume:'5.96M', _source:'local' },
  { id:'eth-4k',               category:'crypto',   categoryLabel:'CRYPTO',             icon:'⟠',   title:'¿Ethereum supera $4,000 antes del 30 jun?',            title_en:'Will Ethereum surpass $4,000 before June 30?',                deadline:'30 Jun 2026', options:[{label:'Sí',pct:28},{label:'No',pct:72}], options_en:YES_NO_EN, volume:'3.84M', _source:'local' },
  { id:'sol-300',              category:'crypto',   categoryLabel:'CRYPTO',             icon:'◎',   title:'¿Solana supera $300 antes del 30 jun?',                title_en:'Will Solana surpass $300 before June 30?',                    deadline:'30 Jun 2026', options:[{label:'Sí',pct:35},{label:'No',pct:65}], options_en:YES_NO_EN, volume:'2.44M', _source:'local' },

  // Hero carousel markets
  { id:'mundial-mexico-inaugural-2026', category:'deportes', categoryLabel:'DEPORTES · MUNDIAL 2026', icon:'⚽', title:'¿México gana el partido inaugural del Mundial 2026?', title_en:'Will Mexico win the 2026 World Cup opening match?', deadline:'12 Jun 2026', options:[{label:'🇲🇽 México',pct:62},{label:'Empate',pct:21},{label:'🇿🇦 Sudáfrica',pct:17}], options_en:[{label:'🇲🇽 Mexico'},{label:'Draw'},{label:'🇿🇦 South Africa'}], volume:'468K', _source:'local', trending:true },
  { id:'bitcoin-150k-dic-2026',         category:'crypto',   categoryLabel:'CRYPTO · BITCOIN',        icon:'₿',  title:'¿Bitcoin supera los $150,000 USD antes de dic 2026?', title_en:'Will Bitcoin surpass $150,000 USD before Dec 2026?', deadline:'31 Dic 2026', options:[{label:'Sí',pct:54},{label:'No',pct:46}], options_en:YES_NO_EN, volume:'24.8M', _source:'local', trending:true },
  { id:'elecciones-mx-2027',            category:'politica', categoryLabel:'POLÍTICA · MÉXICO 2027',  icon:'🌎', title:'¿Cuál partido gana más escaños en las elecciones MX 2027?', title_en:'Which party will win the most seats in Mexico\'s 2027 elections?', deadline:'1 Jul 2027', options:[{label:'MORENA',pct:58},{label:'PAN',pct:28},{label:'PRI',pct:14}], options_en:[{label:'MORENA'},{label:'PAN'},{label:'PRI'}], volume:'1.75M', _source:'local' },
  { id:'grammy-album-2027',             category:'musica',   categoryLabel:'ENTRETENIMIENTO · GRAMMY 2027', icon:'', title:'¿Quién gana el Grammy al Álbum del Año 2027?', title_en:'Who will win the 2027 Grammy Album of the Year?', deadline:'5 Feb 2027', options:[{label:'Kendrick',pct:42},{label:'Sabrina Carpenter',pct:31},{label:'Otro',pct:27}], options_en:[{label:'Kendrick'},{label:'Sabrina Carpenter'},{label:'Other'}], volume:'696K', _source:'local' },

  // ── MERCADOS CERRADOS / RESUELTOS ─────────────────────────────────────────

  {
    id: 'marco-verde-vs-alexander-moreno-mar-2026',
    category: 'deportes',
    categoryLabel: 'DEPORTES · BOX',
    icon: '🥊',
    title: '¿Marco Verde gana vs Alexander Moreno?',
    title_en: 'Will Marco Verde beat Alexander Moreno?',
    deadline: '14 Mar 2026',
    options: [
      { label: 'Sí — Marco Verde', pct: 82 },
      { label: 'No — Alexander Moreno', pct: 18 },
    ],
    options_en: [
      { label: 'Yes — Marco Verde' },
      { label: 'No — Alexander Moreno' },
    ],
    volume: '84K',
    _source: 'local',
    _resolved: true,
    _winner: 'Sí — Marco Verde',
    _winnerShort: 'Marco Verde',
    _resolvedDate: '14 Mar 2026',
    _resolvedBy: 'Decisión Unánime · 80–72',
    _description: 'Marco Verde (5-0, 4 KOs) venció a Alexander Moreno por decisión unánime en CODE Alcalde, Guadalajara. Los tres jueces marcaron 80-72 a favor del tapatío. Verde controló el combate a las 162 libras durante los 8 rounds.',
  },

];

export default MARKETS;
