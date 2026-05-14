// ─── MOCK DATA ───────────────────────────────────────────────────────────────

const MOCK_USER = {
  handle:         'MexFan2026',
  joined:         'Mar 2026',
  views:          '1.2K',
  positionsValue: 1236.40,
  biggestWin:     312.00,
  predictions:    14,
  pnlAllTime:     887.22,
};

const MOCK_POSITIONS = [
  {
    id: 1, emoji: '🇲🇽',
    market:  '¿México gana el partido inaugural del Mundial 2026?',
    outcome: 'Sí',  pos: true,
    avg: 38.5, current: 51.0, shares: 850.0,
    status: 'active',
  },
  {
    id: 2, emoji: '🎵',
    market:  '¿Bad Bunny lanza sencillo antes del 30 jun 2026?',
    outcome: 'Sí',  pos: true,
    avg: 67.0, current: 72.0, shares: 370.0,
    status: 'active',
  },
  {
    id: 3, emoji: '🤝',
    market:  '¿Habrá empate en el partido inaugural México vs Sudáfrica?',
    outcome: 'No',  pos: false,
    avg: 54.0, current: 49.0, shares: 550.0,
    status: 'active',
  },
  {
    id: 4, emoji: '🌎',
    market:  '¿México llega a cuartos de final del Mundial 2026?',
    outcome: 'Sí',  pos: true,
    avg: 42.0, current: 44.5, shares: 600.0,
    status: 'active',
  },
  {
    id: 5, emoji: '🥊',
    market:  '¿Canelo Álvarez pelea antes del 30 sep 2026?',
    outcome: 'Sí',  pos: true,
    avg: 71.0, current: 100.0, shares: 312.0,
    status: 'closed', won: true,
  },
  {
    id: 6, emoji: '🎸',
    market:  '¿Maná anuncia gira de reunión en 2026?',
    outcome: 'No',  pos: false,
    avg: 58.0, current: 100.0, shares: 200.0,
    status: 'closed', won: true,
  },
  {
    id: 7, emoji: '🏆',
    market:  '¿Brasil gana la Copa América 2025?',
    outcome: 'Sí',  pos: true,
    avg: 45.0, current: 0.0, shares: 250.0,
    status: 'closed', won: false,
  },
  {
    id: 8, emoji: '🎤',
    market:  '¿J Balvin lanza álbum nuevo en Q1 2026?',
    outcome: 'No',  pos: false,
    avg: 62.0, current: 0.0, shares: 200.0,
    status: 'closed', won: false,
  },
];

const MOCK_ACTIVITY = [
  { type: 'bet',   emoji: '🇲🇽', desc: 'Apostaste en ¿México gana el partido inaugural?',          sub: '850 shares · Sí',          amount: '-$327.25', sign: 'neg', date: 'Hace 2 días' },
  { type: 'bet',   emoji: '🎵',  desc: 'Apostaste en ¿Bad Bunny lanza sencillo?',                   sub: '370 shares · Sí',          amount: '-$247.90', sign: 'neg', date: 'Hace 4 días' },
  { type: 'claim', emoji: '🥊',  desc: 'Cobraste ganancias — ¿Canelo pelea antes del 30 sep?',      sub: 'Resultado: Sí · 312 shares', amount: '+$312.00', sign: 'pos', date: 'Hace 5 días' },
  { type: 'bet',   emoji: '🤝',  desc: 'Apostaste en ¿Habrá empate en el partido inaugural?',       sub: '550 shares · No',          amount: '-$297.00', sign: 'neg', date: 'Hace 6 días' },
  { type: 'claim', emoji: '🎸',  desc: 'Cobraste ganancias — ¿Maná anuncia gira?',                  sub: 'Resultado: No · 200 shares', amount: '+$200.00', sign: 'pos', date: 'Hace 8 días' },
  { type: 'bet',   emoji: '🌎',  desc: 'Apostaste en ¿México llega a cuartos del Mundial?',         sub: '600 shares · Sí',          amount: '-$252.00', sign: 'neg', date: 'Hace 10 días' },
  { type: 'loss',  emoji: '🏆',  desc: 'Posición cerrada — ¿Brasil gana Copa América 2025?',        sub: 'Resultado: No · 250 shares', amount: '-$112.50', sign: 'neg', date: 'Hace 15 días' },
  { type: 'loss',  emoji: '🎤',  desc: 'Posición cerrada — ¿J Balvin lanza álbum en Q1 2026?',      sub: 'Resultado: Sí · 200 shares', amount: '-$124.00', sign: 'neg', date: 'Hace 20 días' },
];

// Chart y-values (0–100 scale) per time period
const CHART_DATA = {
  '1D':  [82, 81, 83, 85, 83, 86, 85, 88, 87, 89, 88, 90, 91],
  '1W':  [70, 68, 73, 76, 74, 78, 76, 81, 79, 84, 86, 88, 91],
  '1M':  [46, 49, 45, 53, 51, 57, 54, 60, 57, 63, 60, 66, 63, 69, 67, 72, 70, 75, 73, 79, 77, 83, 86, 88, 91],
  'ALL': [8,7,10,8,12,10,14,11,16,13,18,14,20,16,23,17,26,19,28,21,30,23,32,24,35,26,37,28,39,30,41,32,44,34,46,36,49,39,52,43,55,47,58,50,61,53,64,56,67,59,70,62,73,65,75,68,78,72,81,75,84,79,87,83,91],
};

const PNL_BY_PERIOD = {
  '1D':  { val:  142.80, pos: true },
  '1W':  { val:  312.50, pos: true },
  '1M':  { val:  654.30, pos: true },
  'ALL': { val:  887.22, pos: true },
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let activeTab    = 'positions';
let activeFilter = 'active';
let chartPeriod  = 'ALL';
let searchQuery  = '';

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderUserCard();
  drawChart(chartPeriod);
  renderPositions();
  renderActivity();
  initEventListeners();
  initNav();

  // Duplicate ticker items for seamless loop
  const track = document.getElementById('tickerTrack');
  if (track) track.innerHTML += track.innerHTML;
});

// ─── USER CARD ────────────────────────────────────────────────────────────────
function renderUserCard() {
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('pfStatPositions').textContent   = '$' + fmt(MOCK_USER.positionsValue);
  document.getElementById('pfStatBiggestWin').textContent  = '$' + fmt(MOCK_USER.biggestWin);
  document.getElementById('pfStatPredictions').textContent = MOCK_USER.predictions.toString();
}

// ─── CHART ────────────────────────────────────────────────────────────────────
function drawChart(period) {
  chartPeriod = period;

  // Toggle active button
  document.querySelectorAll('.pf-time-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });

  // Update P&L display
  const pnl     = PNL_BY_PERIOD[period];
  const valEl   = document.getElementById('pfPnlVal');
  const periodEl = document.getElementById('pfPnlPeriod');

  valEl.textContent = (pnl.pos ? '+' : '-') + '$' +
    pnl.val.toLocaleString('en-US', { minimumFractionDigits: 2 });
  valEl.className   = 'pf-pnl-val ' + (pnl.pos ? 'pos' : 'neg');

  const labels = { '1D': 'Último día', '1W': 'Última semana', '1M': 'Último mes', 'ALL': 'Desde el inicio' };
  periodEl.textContent = labels[period];

  // Draw SVG
  const data  = CHART_DATA[period];
  const W = 400, H = 100, PAD = 6;
  const min   = Math.min(...data);
  const max   = Math.max(...data);
  const range = (max - min) || 1;

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const color = pnl.pos ? '#00E87A' : '#FF4545';
  const svg   = document.getElementById('pfChartSvg');
  if (!svg) return;

  svg.innerHTML = `
    <defs>
      <linearGradient id="pfGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${color}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon
      points="0,${H} ${pts.join(' ')} ${W},${H}"
      fill="url(#pfGrad)"
    />
    <polyline
      points="${pts.join(' ')}"
      fill="none"
      stroke="${color}"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />`;
}

// ─── POSITIONS ────────────────────────────────────────────────────────────────
function calcPos(p) {
  const value   = (p.current / 100) * p.shares;
  const cost    = (p.avg / 100)     * p.shares;
  const pnl     = value - cost;
  const pnlPct  = cost > 0 ? (pnl / cost) * 100 : 0;
  return { value, cost, pnl, pnlPct };
}

function renderPositions() {
  const tbody = document.getElementById('pfTableBody');

  let list = MOCK_POSITIONS.filter(p => p.status === activeFilter);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(p => p.market.toLowerCase().includes(q));
  }

  if (list.length === 0) {
    tbody.innerHTML = `
      <div class="pf-empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <p>No hay posiciones ${activeFilter === 'active' ? 'activas' : 'cerradas'}${searchQuery ? ' que coincidan con "' + searchQuery + '"' : ''}</p>
      </div>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const { value, pnl, pnlPct } = calcPos(p);
    const pnlSign    = pnl >= 0 ? 'pos' : 'neg';
    const pnlStr     = (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(2);
    const pnlPctStr  = (pnlPct >= 0 ? '+' : '') + Math.abs(pnlPct).toFixed(2) + '%';
    const isClosed   = p.status === 'closed';
    const displayVal = (isClosed && !p.won) ? '$0.00' : '$' + value.toFixed(2);
    const currentStr = isClosed ? (p.won ? '100¢' : '0¢') : p.current.toFixed(1) + '¢';

    return `
      <div class="pf-row${isClosed ? ' pf-row-closed' : ''}">
        <div class="pf-market-cell">
          <div class="pf-market-thumb">${p.emoji}</div>
          <div class="pf-market-info">
            <div class="pf-market-title">${p.market}</div>
            <div class="pf-outcome-row">
              <span class="pf-outcome-tag ${p.pos ? 'pos' : 'neg'}">${p.outcome} ${p.avg.toFixed(1)}¢</span>
              <span class="pf-shares">${p.shares.toLocaleString()} shares</span>
            </div>
          </div>
        </div>
        <div class="pf-price">${p.avg.toFixed(1)}¢</div>
        <div class="pf-price">${currentStr}</div>
        <div class="pf-value-cell">
          <div class="pf-value-main">${displayVal}</div>
          <div class="pf-value-delta ${pnlSign}">${pnlStr} (${pnlPctStr})</div>
        </div>
        <div class="pf-link-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </div>
      </div>`;
  }).join('');
}

// ─── ACTIVITY ─────────────────────────────────────────────────────────────────
function renderActivity() {
  const list = document.getElementById('pfActivityList');
  const icon = { bet: '🎯', claim: '💰', loss: '❌' };

  list.innerHTML = MOCK_ACTIVITY.map(a => `
    <div class="pf-activity-row">
      <div class="pf-activity-icon ${a.type}">${icon[a.type]}</div>
      <div class="pf-activity-desc">
        <div class="pf-activity-title">${a.desc}</div>
        <div class="pf-activity-sub">${a.sub} · ${a.date}</div>
      </div>
      <div class="pf-activity-amount ${a.sign}">${a.amount}</div>
    </div>`).join('');
}

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
function initEventListeners() {
  // Tabs
  document.querySelectorAll('.pf-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.pf-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('pfPositionsView').style.display = activeTab === 'positions' ? '' : 'none';
      document.getElementById('pfActivityView').style.display  = activeTab === 'activity'  ? '' : 'none';
    });
  });

  // Active / Closed toggle
  document.querySelectorAll('.pf-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      document.querySelectorAll('.pf-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderPositions();
    });
  });

  // Search
  document.getElementById('pfSearch').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderPositions();
  });

  // Chart time buttons
  document.querySelectorAll('.pf-time-btn').forEach(btn => {
    btn.addEventListener('click', () => drawChart(btn.dataset.period));
  });
}

// ─── NAV SCROLL ───────────────────────────────────────────────────────────────
function initNav() {
  const nav = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 10);
  });
}

// ─── WALLET CONNECT ───────────────────────────────────────────────────────────
window.connectWallet = async function () {
  if (!window.ethereum) {
    showToast('Instala MetaMask o Coinbase Wallet');
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const addr = accounts[0];
    document.getElementById('navWalletArea').innerHTML = `
      <button class="btn-wallet-connected" onclick="window.connectWallet()">
        <div class="wallet-dot"></div>${addr.slice(0, 6)}...${addr.slice(-4)}
      </button>`;
  } catch (e) {
    showToast('Error al conectar wallet');
  }
};

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
