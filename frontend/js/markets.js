// ─── MARKETS DATA ────────────────────────────────────────────────────────────
// Mercados mock (sin backend). Para agregar mercados, edita este array.
// El mercado on-chain (México vs SA) se maneja directamente en app.js.
//
// Categorías: 'musica' | 'mexico' | 'politica' | 'deportes'

const MARKETS = [
  // ── MÚSICA & FARÁNDULA ──────────────────────────────────────────────────
  {
    id: 'bad-bunny-sencillo',
    category: 'musica',
    categoryLabel: 'MÚSICA & FARÁNDULA',
    icon: '🎵',
    title: '¿Bad Bunny lanza sencillo antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 67 },
      { label: 'No', pct: 33 },
    ],
    volume: '84,000',
  },
  {
    id: 'peso-pluma-anillo',
    category: 'musica',
    categoryLabel: 'MÚSICA & FARÁNDULA',
    icon: '💍',
    title: '¿Peso Pluma da anillo antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 14 },
      { label: 'No', pct: 86 },
    ],
    volume: '57,000',
  },
  {
    id: 'nodal-divorcio',
    category: 'musica',
    categoryLabel: 'MÚSICA & FARÁNDULA',
    icon: '💔',
    title: '¿Christian Nodal se divorcia antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 22 },
      { label: 'No', pct: 78 },
    ],
    volume: '62,000',
  },

  // ── MÉXICO & CDMX ────────────────────────────────────────────────────────
  {
    id: 'sismo-cdmx',
    category: 'mexico',
    categoryLabel: 'MÉXICO & CDMX',
    icon: '🌍',
    title: '¿Sismo >5.0 en CDMX antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 71 },
      { label: 'No', pct: 29 },
    ],
    volume: '112,000',
  },
  {
    id: 'tren-maya-descarrila',
    category: 'mexico',
    categoryLabel: 'MÉXICO & CDMX',
    icon: '🚂',
    title: '¿Se descarrila el Tren Maya antes del 2027?',
    deadline: '31 Dic 2026',
    options: [
      { label: 'Sí', pct: 38 },
      { label: 'No', pct: 62 },
    ],
    volume: '38,000',
  },
  {
    id: 'dolar-22-mxn',
    category: 'mexico',
    categoryLabel: 'MÉXICO & CDMX',
    icon: '💵',
    title: '¿El dólar llega a $22 MXN antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 31 },
      { label: 'No', pct: 69 },
    ],
    volume: '168,000',
  },

  // ── POLÍTICA INTERNACIONAL ───────────────────────────────────────────────
  {
    id: 'trump-visita-mexico',
    category: 'politica',
    categoryLabel: 'POLÍTICA INTERNACIONAL',
    icon: '🇺🇸',
    title: '¿Trump visita México antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 5 },
      { label: 'No', pct: 95 },
    ],
    volume: '134,000',
  },
  {
    id: 'venezuela-elecciones',
    category: 'politica',
    categoryLabel: 'POLÍTICA INTERNACIONAL',
    icon: '🗳️',
    title: '¿Venezuela celebra elecciones libres antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 3 },
      { label: 'No', pct: 97 },
    ],
    volume: '42,000',
  },
  {
    id: 'cuba-embargo',
    category: 'politica',
    categoryLabel: 'POLÍTICA INTERNACIONAL',
    icon: '🇨🇺',
    title: '¿Se levanta el embargo de Cuba antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 3 },
      { label: 'No', pct: 97 },
    ],
    volume: '29,000',
  },

  // ── DEPORTES ─────────────────────────────────────────────────────────────
  {
    id: 'checo-puntos',
    category: 'deportes',
    categoryLabel: 'DEPORTES',
    icon: '🏎️',
    title: '¿Checo Pérez suma puntos antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 61 },
      { label: 'No', pct: 39 },
    ],
    volume: '146,000',
  },
  {
    id: 'mundial-mexico-gana',
    category: 'deportes',
    categoryLabel: 'DEPORTES',
    icon: '⚽',
    title: '¿México gana su primer partido del Mundial 2026?',
    deadline: '15 Jun 2026',
    options: [
      { label: 'Sí', pct: 54 },
      { label: 'No', pct: 46 },
    ],
    volume: '468,000',
  },
  {
    id: 'sga-mvp',
    category: 'deportes',
    categoryLabel: 'DEPORTES',
    icon: '🏀',
    title: '¿SGA gana el MVP de la NBA 2025-26?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 71 },
      { label: 'No', pct: 29 },
    ],
    volume: '364,000',
  },

  // ── CRYPTO ───────────────────────────────────────────────────────────────
  {
    id: 'bitcoin-120k',
    category: 'crypto',
    categoryLabel: 'CRYPTO',
    icon: '₿',
    title: '¿Bitcoin supera $120k USD antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 12 },
      { label: 'No', pct: 88 },
    ],
    volume: '298,000',
  },
  {
    id: 'eth-4k',
    category: 'crypto',
    categoryLabel: 'CRYPTO',
    icon: '⟠',
    title: '¿Ethereum supera $4,000 antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 28 },
      { label: 'No', pct: 72 },
    ],
    volume: '192,000',
  },
  {
    id: 'sol-300',
    category: 'crypto',
    categoryLabel: 'CRYPTO',
    icon: '◎',
    title: '¿Solana supera $300 antes del 30 jun?',
    deadline: '30 Jun 2026',
    options: [
      { label: 'Sí', pct: 35 },
      { label: 'No', pct: 65 },
    ],
    volume: '122,000',
  },
];
