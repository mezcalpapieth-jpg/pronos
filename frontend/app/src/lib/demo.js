/**
 * Demo mode — a deterministic, offline click-through of the MVP.
 *
 * Built for live presentations: no Privy login, no RPC calls, no CLOB orders,
 * no API calls. Every number below is fake and lives in sessionStorage, so a
 * reload keeps the demo where you left it and closing the tab wipes it.
 *
 * Enter with  /mvp?demo=1   ·   leave with  /mvp?demo=0
 * The flag is sticky for the tab so in-app navigation stays in demo mode.
 */

const FLAG_KEY  = 'pronos-demo-mode';
const STATE_KEY = 'pronos-demo-state';

function ss(fn, fallback = null) {
  try { return fn(window.sessionStorage); } catch (_) { return fallback; }
}

function readFlag() {
  const param = new URLSearchParams(window.location.search).get('demo');
  if (param === '1') { ss(s => s.setItem(FLAG_KEY, '1')); return true; }
  if (param === '0') { ss(s => s.removeItem(FLAG_KEY)); return false; }
  return ss(s => s.getItem(FLAG_KEY), null) === '1';
}

export const IS_DEMO = readFlag();

export const DEMO_WALLET   = '0x7A3F9c2E4b81D5aa06Ef31b7C48D9e5A2f0B6C14';
// Kept short on purpose: the nav pill plus the USDC balance overflows a
// 390px-wide screen with a longer name.
export const DEMO_USERNAME = 'demo';
export const DEMO_CHAIN_ID = 137; // Polygon — matches what the nav expects

const INITIAL_BALANCE = 1000;

/* ── Seed data ──────────────────────────────────────────────────────────────
 * Positions and history the demo account "already had" before the show, so
 * the portfolio never opens empty. Market titles match lib/markets.js.
 */

const SEED_POSITIONS = [
  {
    id: 'demo-seed-ligamx',
    marketId: 'demo-liga-mx-final',
    marketTitle: '¿Quién gana la final del Apertura?',
    outcome: 'América',
    currentPrice: 0.41,
    initialValue: 120,
    currentValue: 138.4,
  },
  {
    id: 'demo-seed-btc',
    marketId: 'demo-btc-150k',
    marketTitle: '¿Bitcoin supera los $150,000 USD antes de fin de año?',
    outcome: 'Sí',
    currentPrice: 0.51,
    initialValue: 80,
    currentValue: 71.2,
  },
  {
    id: 'demo-seed-banxico',
    marketId: 'demo-banxico-tasa',
    marketTitle: '¿Banxico baja la tasa en su próxima reunión?',
    outcome: 'Sí',
    currentPrice: 0.73,
    initialValue: 50,
    currentValue: 57.5,
  },
];

// Dates are relative to today so the history never looks stale on stage.
function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

const SEED_HISTORY = [
  {
    marketId: 'marco-verde-vs-alexander-moreno-mar-2026',
    question: '¿Marco Verde gana vs Alexander Moreno?',
    outcomeStatus: 'won',
    winningOutcomeLabel: 'Sí — Marco Verde',
    totalInvested: 60,
    totalReceived: 92.4,
    netPnl: 32.4,
    transactions: [
      { id: 'd1', side: 'buy',    outcomeLabel: 'Sí — Marco Verde', priceAtTrade: 0.65, shares: 92.31, collateral: 60,   createdAt: daysAgo(21) },
      { id: 'd2', side: 'redeem', outcomeLabel: 'Sí — Marco Verde', priceAtTrade: 1,    shares: 92.31, collateral: 92.4, createdAt: daysAgo(14) },
    ],
  },
  {
    marketId: 'demo-dolar-peso',
    question: '¿El dólar cierra el año arriba de $20 MXN?',
    outcomeStatus: 'exited',
    winningOutcomeLabel: null,
    totalInvested: 40,
    totalReceived: 48.15,
    netPnl: 8.15,
    transactions: [
      { id: 'd3', side: 'buy',  outcomeLabel: 'No', priceAtTrade: 0.62, shares: 64.52, collateral: 40,    createdAt: daysAgo(11) },
      { id: 'd4', side: 'sell', outcomeLabel: 'No', priceAtTrade: 0.75, shares: 64.52, collateral: 48.15, createdAt: daysAgo(4) },
    ],
  },
  {
    marketId: 'demo-hist-btc-trimestre',
    question: '¿Bitcoin cerró el trimestre pasado arriba de $130,000 USD?',
    outcomeStatus: 'lost',
    winningOutcomeLabel: 'No',
    totalInvested: 25,
    totalReceived: 0,
    netPnl: -25,
    transactions: [
      { id: 'd5', side: 'buy', outcomeLabel: 'Sí', priceAtTrade: 0.31, shares: 80.65, collateral: 25, createdAt: daysAgo(30) },
    ],
  },
  {
    marketId: 'demo-sismo-cdmx',
    question: '¿Sismo mayor a 5.0 en CDMX en los próximos 90 días?',
    outcomeStatus: 'pending',
    winningOutcomeLabel: null,
    totalInvested: 30,
    totalReceived: 0,
    netPnl: 0,
    transactions: [
      { id: 'd6', side: 'buy', outcomeLabel: 'Sí', priceAtTrade: 0.71, shares: 42.25, collateral: 30, createdAt: daysAgo(6) },
    ],
  },
];

function seedState() {
  return {
    balance: INITIAL_BALANCE,
    positions: SEED_POSITIONS.map(p => ({ ...p })),
    history: SEED_HISTORY.map(h => ({ ...h, transactions: h.transactions.map(tx => ({ ...tx })) })),
  };
}

/* ── State ──────────────────────────────────────────────────────────────── */

let state = null;

function load() {
  if (state) return state;
  const raw = ss(s => s.getItem(STATE_KEY));
  if (raw) {
    try { state = JSON.parse(raw); return state; } catch (_) {}
  }
  state = seedState();
  save();
  return state;
}

function save() {
  ss(s => s.setItem(STATE_KEY, JSON.stringify(state)));
  window.dispatchEvent(new CustomEvent('pronos-demo-change'));
}

export function getDemoBalance() {
  return load().balance;
}

export function getDemoPositions() {
  // `source: 'demo'` keeps Portfolio's on-chain exit flow switched off.
  return load().positions.map(p => ({ ...p, source: 'demo', title: p.marketTitle }));
}

export function getDemoHistory() {
  const history = load().history;
  const count = (status) => history.filter(h => h.outcomeStatus === status).length;
  return {
    history: [...history].reverse(),
    summary: {
      marketsTotal:   history.length,
      marketsWon:     count('won'),
      marketsLost:    count('lost'),
      marketsPending: count('pending') + count('open'),
      marketsExited:  count('exited'),
      totalPnl:       history.reduce((sum, h) => sum + Number(h.netPnl || 0), 0),
    },
  };
}

/**
 * Record a demo bet: debit the balance, open (or top up) a position, and log
 * the transaction in the history tab.
 *
 * Pricing mirrors the real thing closely enough to narrate on stage: a 2% fee
 * comes off the top, the rest buys shares at the current probability, and the
 * buy nudges the price up the way an AMM purchase would.
 */
export function placeDemoBet({ marketId, marketTitle, outcome, pct, amount }) {
  const s = load();
  const price     = Math.min(Math.max(Number(pct) / 100, 0.01), 0.99);
  const afterFee  = amount * 0.98;
  const shares    = afterFee / price;
  const postPrice = Math.min(price * 1.03, 0.99);

  s.balance = Math.max(0, s.balance - amount);

  const existing = s.positions.find(p => p.marketId === marketId && p.outcome === outcome);
  if (existing) {
    existing.initialValue += amount;
    existing.currentValue += shares * postPrice;
    existing.currentPrice = postPrice;
  } else {
    s.positions.unshift({
      id: `demo-${marketId}-${outcome}-${Date.now()}`,
      marketId,
      marketTitle,
      outcome,
      currentPrice: postPrice,
      initialValue: amount,
      currentValue: shares * postPrice,
    });
  }

  const tx = {
    id: `demo-tx-${Date.now()}`,
    side: 'buy',
    outcomeLabel: outcome,
    priceAtTrade: price,
    shares,
    collateral: amount,
    createdAt: new Date().toISOString(),
  };
  const logged = s.history.find(h => h.marketId === marketId);
  if (logged) {
    logged.transactions.push(tx);
    logged.totalInvested += amount;
  } else {
    s.history.push({
      marketId,
      question: marketTitle,
      outcomeStatus: 'open',
      winningOutcomeLabel: null,
      totalInvested: amount,
      totalReceived: 0,
      netPnl: 0,
      transactions: [tx],
    });
  }

  save();
  return { shares, fee: amount - afterFee, postPrice };
}

export function resetDemo() {
  state = seedState();
  save();
}

/** Subscribe to demo state changes (balance, positions, history). */
export function onDemoChange(handler) {
  window.addEventListener('pronos-demo-change', handler);
  return () => window.removeEventListener('pronos-demo-change', handler);
}
