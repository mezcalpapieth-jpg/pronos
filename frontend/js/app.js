// ─── CONFIG ─────────────────────────────────────────────────────────────────
const PRONOS_BET_ADDRESS = '0x9a03F59DD857856d930b12f5da63c586d824804D';
const USDC_ADDRESS       = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const RPC_URL            = 'https://sepolia.base.org';
const BASE_SEPOLIA_ID    = 84532;

const PRONOS_ABI = [
  'function bettingOpen() view returns (bool)',
  'function resolved() view returns (bool)',
  'function result() view returns (uint8)',
  'function totalPool() view returns (uint256)',
  'function getOdds() view returns (uint256 mexicoPct, uint256 drawPct, uint256 saPct)',
  'function getMarketState() view returns (bool bettingOpen, bool resolved, uint8 result, uint256 totalPool, uint256 mexicoPool, uint256 drawPool, uint256 saPool)',
  'function getUserBets(address user) view returns (tuple(uint8 outcome, uint256 amount, bool claimed)[])',
  'function estimatePayout(uint8 _outcome, uint256 _amount) view returns (uint256)',
  'function placeBet(uint8 _outcome, uint256 _amount) external',
  'function claimWinnings() external',
];

const USDC_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

const OUTCOME_LABELS = { 1: '🇲🇽 México gana', 2: '🤝 Empate', 3: '🇿🇦 Sudáfrica gana' };

// ─── STATE ──────────────────────────────────────────────────────────────────
const provider  = new ethers.providers.JsonRpcProvider(RPC_URL);
const readContract = new ethers.Contract(PRONOS_BET_ADDRESS, PRONOS_ABI, provider);
let   signer       = null;
let   userAddress  = null;
let   selectedOutcome = 1;
let   marketState  = null;

// ─── CONTRACT READS ──────────────────────────────────────────────────────────
async function fetchMarketState() {
  try {
    const s = await readContract.getMarketState();
    const odds = await readContract.getOdds();

    marketState = {
      bettingOpen: s.bettingOpen,
      resolved:    s.resolved,
      result:      s.result,
      totalPool:   s.totalPool,
      mxPct:       odds.mexicoPct,
      drPct:       odds.drawPct,
      saPct:       odds.saPct,
    };

    updateUI(marketState);
    if (userAddress) await fetchUserPositions();
  } catch (err) {
    console.warn('Contract read error:', err.message);
  }
}

function updateUI(s) {
  const mxP = Number(s.mxPct) / 100;
  const drP = Number(s.drPct) / 100;
  const saP = Number(s.saPct) / 100;
  const pool = formatUSDC(s.totalPool);
  const fmt  = n => n.toFixed(1) + '%';

  ['hero-mx-pct','market-mx-pct','bar-mx-pct'].forEach(id => setId(id, fmt(mxP)));
  ['hero-draw-pct','market-draw-pct','bar-draw-pct'].forEach(id => setId(id, fmt(drP)));
  ['hero-sa-pct','market-sa-pct','bar-sa-pct'].forEach(id => setId(id, fmt(saP)));

  setStyle('bar-mx-fill',   'width', mxP + '%');
  setStyle('bar-draw-fill', 'width', drP + '%');
  setStyle('bar-sa-fill',   'width', saP + '%');

  setId('heroVolCounter',  pool);
  setId('heroTotalPool',   pool);
  setId('marketVol',       pool + ' USDC');
  setId('ticker-mx',       fmt(mxP));
  setId('ticker-draw',     fmt(drP));
  setId('ticker-sa',       fmt(saP));
  setId('ticker-pool',     '$' + pool);

  const badge = document.getElementById('marketBadge');
  if (s.resolved) {
    if (badge) { badge.textContent = 'Resuelto'; badge.className = 'mc-badge upcoming'; }
    setId('ticker-result', OUTCOME_LABELS[s.result] || '—');
    const banner = document.getElementById('resolvedBanner');
    if (banner) banner.style.display = 'flex';
    setId('resolvedResult', '🏆 Resultado: ' + (OUTCOME_LABELS[s.result] || '—'));
    ['btn-mx','btn-draw','btn-sa'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
    const bb = document.getElementById('marketBetBtn'); if (bb) bb.disabled = true;
  } else if (!s.bettingOpen) {
    if (badge) { badge.textContent = 'Apuestas cerradas'; badge.className = 'mc-badge upcoming'; }
  }
}

async function fetchUserPositions() {
  if (!userAddress) return;
  try {
    const bets = await readContract.getUserBets(userAddress);
    const posEl     = document.getElementById('userPositions');
    const contentEl = document.getElementById('userPositionsContent');
    if (!bets || bets.length === 0) { if (posEl) posEl.style.display = 'none'; return; }
    if (posEl) posEl.style.display = 'block';

    let html = '', hasWinnable = false;
    for (const bet of bets) {
      const outcome  = Number(bet.outcome);
      const amount   = formatUSDC(bet.amount);
      const claimed  = bet.claimed;
      const isWinner = marketState && marketState.resolved && Number(marketState.result) === outcome;
      if (isWinner && !claimed) hasWinnable = true;
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-family:var(--font-mono);font-size:12px;color:var(--text-primary)">${OUTCOME_LABELS[outcome]}</div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-top:2px">Apostado: $${amount} USDC</div>
        </div>
        <div style="font-family:var(--font-mono);font-size:11px;text-align:right">
          ${claimed ? '<span style="color:var(--text-muted)">Cobrado ✓</span>'
            : isWinner ? '<span style="color:var(--green)">¡Ganador! 🏆</span>'
            : marketState && marketState.resolved ? '<span style="color:var(--red)">Perdido</span>'
            : '<span style="color:var(--gold)">En juego</span>'}
        </div>
      </div>`;
    }
    if (contentEl) contentEl.innerHTML = html;
    const claimBtn = document.getElementById('claimBtn');
    if (hasWinnable && claimBtn) claimBtn.style.display = 'block';
  } catch (err) {
    console.warn('Failed to fetch user bets:', err.message);
  }
}

// ─── WALLET CONNECTION ───────────────────────────────────────────────────────
window.connectWallet = async function() {
  if (!window.ethereum) {
    showToast('Instala MetaMask o Coinbase Wallet para continuar', true);
    setTimeout(() => window.open('https://metamask.io', '_blank'), 1500);
    return;
  }

  try {
    await window.ethereum.request({ method: 'eth_requestAccounts' });

    // Switch to Base Sepolia
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + BASE_SEPOLIA_ID.toString(16) }],
      });
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: '0x' + BASE_SEPOLIA_ID.toString(16), chainName: 'Base Sepolia',
            rpcUrls: [RPC_URL], nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            blockExplorerUrls: ['https://sepolia.basescan.org'] }],
        });
      }
    }

    const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
    await web3Provider.send('eth_requestAccounts', []);
    signer      = web3Provider.getSigner();
    userAddress = await signer.getAddress();

    updateWalletUI(userAddress);
    await fetchUserPositions();
    showToast('Wallet conectada: ' + shortAddr(userAddress));

  } catch (err) {
    console.error(err);
    if (err.code !== 4001) showToast('Error al conectar wallet', true);
  }
};

function updateWalletUI(address) {
  const navArea = document.getElementById('navWalletArea');
  if (navArea) navArea.innerHTML = `
    <button class="btn-wallet-connected" onclick="window.connectWallet()">
      <div class="wallet-dot"></div>${shortAddr(address)}
    </button>`;
  const heroBtn = document.getElementById('heroConnectBtn');
  if (heroBtn) { heroBtn.textContent = 'Apostar ahora'; heroBtn.onclick = () => openBetModal(1); }
  if (typeof renderPortfolio === 'function') renderPortfolio();
}

// ─── BET MODAL ───────────────────────────────────────────────────────────────
window.openBetModal = function(outcome) {
  if (!userAddress) { window.connectWallet(); return; }
  if (marketState && !marketState.bettingOpen) { showToast('Las apuestas están cerradas', true); return; }
  selectedOutcome = outcome;
  setId('betOutcomeTag', OUTCOME_LABELS[outcome]);
  const inp = document.getElementById('betAmount'); if (inp) inp.value = '';
  setId('betSummaryAmount', '—'); setId('betEstPayout', '—');
  const modal = document.getElementById('betModal'); if (modal) modal.classList.add('show');
};

window.closeBetModal = function() {
  const modal = document.getElementById('betModal'); if (modal) modal.classList.remove('show');
};

window.handleBetOverlayClick = function(e) {
  if (e.target === document.getElementById('betModal')) closeBetModal();
};

window.setAmount = function(amt) {
  const inp = document.getElementById('betAmount'); if (inp) inp.value = amt;
  updatePayoutEstimate();
};

window.updatePayoutEstimate = async function() {
  const raw = parseFloat(document.getElementById('betAmount').value);
  if (!raw || raw <= 0) { setId('betSummaryAmount','—'); setId('betEstPayout','—'); return; }
  setId('betSummaryAmount', '$' + raw.toFixed(2) + ' USDC');
  try {
    const amtRaw = ethers.utils.parseUnits(raw.toString(), 6);
    const est    = await readContract.estimatePayout(selectedOutcome, amtRaw);
    setId('betEstPayout', '~$' + formatUSDC(est) + ' USDC');
  } catch { setId('betEstPayout', 'Disponible tras el deploy'); }
};

window.submitBet = async function() {
  const raw = parseFloat(document.getElementById('betAmount').value);
  if (!raw || raw < 1) { showToast('Monto mínimo: 1 USDC', true); return; }
  if (!signer) { showToast('Conecta tu wallet primero', true); return; }

  const btn = document.getElementById('betSubmitBtn');
  btn.disabled = true; btn.textContent = 'Aprobando USDC...';

  try {
    const amtRaw      = ethers.utils.parseUnits(raw.toString(), 6);
    const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
    const pronoContract = new ethers.Contract(PRONOS_BET_ADDRESS, PRONOS_ABI, signer);

    const allowance = await usdcContract.allowance(userAddress, PRONOS_BET_ADDRESS);
    if (allowance.lt(amtRaw)) {
      showToast('Aprobando USDC... (firma en tu wallet)');
      const approveTx = await usdcContract.approve(PRONOS_BET_ADDRESS, amtRaw);
      await approveTx.wait();
    }

    btn.textContent = 'Confirmando apuesta...';
    showToast('Enviando apuesta... (firma en tu wallet)');
    const betTx = await pronoContract.placeBet(selectedOutcome, amtRaw);
    btn.textContent = 'Esperando confirmación...';
    await betTx.wait();

    closeBetModal();
    showToast('✅ ¡Apuesta confirmada! ' + OUTCOME_LABELS[selectedOutcome]);
    await fetchMarketState();
  } catch (err) {
    console.error(err);
    showToast(err.reason || err.message || 'Error al apostar', true);
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar apuesta';
  }
};

// ─── CLAIM ───────────────────────────────────────────────────────────────────
window.claimWinnings = async function() {
  if (!signer) { showToast('Conecta tu wallet primero', true); return; }
  const btn = document.getElementById('claimBtn');
  btn.disabled = true; btn.textContent = 'Cobrando...';
  try {
    const pronoContract = new ethers.Contract(PRONOS_BET_ADDRESS, PRONOS_ABI, signer);
    showToast('Firmando transacción...');
    const tx = await pronoContract.claimWinnings();
    await tx.wait();
    showToast('✅ ¡USDC cobrado! Revisa tu wallet');
    await fetchMarketState();
  } catch (err) {
    console.error(err);
    showToast(err.reason || 'Error al cobrar', true);
  } finally {
    btn.disabled = false; btn.textContent = 'Cobrar ganancias';
  }
};

// ─── UTILITIES ───────────────────────────────────────────────────────────────
function formatUSDC(raw) { return (Number(raw) / 1e6).toFixed(2); }
function shortAddr(a)    { return a.slice(0,6) + '...' + a.slice(-4); }
function setId(id, val)  { const el = document.getElementById(id); if (el) el.textContent = val; }
function setStyle(id, p, v) { const el = document.getElementById(id); if (el) el.style[p] = v; }

window.showToast = function(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4000);
};

// ─── TICKER DUPLICATION ──────────────────────────────────────────────────────
(function() {
  const track = document.getElementById('tickerTrack');
  if (track) Array.from(track.children).forEach(c => track.appendChild(c.cloneNode(true)));
})();

// ─── NAV SCROLL ──────────────────────────────────────────────────────────────
window.addEventListener('scroll', function() {
  const nav = document.getElementById('nav');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 10);
});

// ─── SMOOTH SCROLL ───────────────────────────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const t = document.querySelector(a.getAttribute('href'));
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});

// ─── ESCAPE KEY ──────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBetModal(); });

// ─── AUTO-RECONNECT ──────────────────────────────────────────────────────────
if (window.ethereum) {
  window.ethereum.request({ method: 'eth_accounts' }).then(async accounts => {
    if (accounts.length > 0) {
      const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
      signer      = web3Provider.getSigner();
      userAddress = accounts[0];
      updateWalletUI(accounts[0]);
    }
  });
  window.ethereum.on('accountsChanged', accounts => {
    if (accounts.length > 0) { userAddress = accounts[0]; updateWalletUI(accounts[0]); fetchMarketState(); }
    else location.reload();
  });
}

// ─── INIT ────────────────────────────────────────────────────────────────────
fetchMarketState();
setInterval(fetchMarketState, 30000);

// ─── MOCK MARKETS RENDERING ──────────────────────────────────────────────────
let activeFilter = 'todos';

function renderMockMarkets(filter) {
  activeFilter = filter;
  const grid = document.getElementById('mockMarketsGrid');
  const onchainWrap = document.getElementById('onchainMarketWrap');
  if (!grid) return;

  // Show/hide on-chain card based on filter
  const showOnchain = filter === 'todos' || filter === 'deportes';
  if (onchainWrap) onchainWrap.style.display = showOnchain ? '' : 'none';

  const filtered = filter === 'todos'
    ? MARKETS
    : MARKETS.filter(m => m.category === filter);

  grid.innerHTML = filtered.map(m => `
    <div class="mock-card" title="${m.title}">
      <div class="mock-card-header">
        <span class="mock-card-cat">${m.icon} ${m.categoryLabel}</span>
      </div>
      <div class="mock-card-body">
        <div class="mock-card-title">${m.title}</div>
        <div class="mock-card-opts">
          ${m.options.map((o, i) => `
            <div class="mock-opt ${i === 0 ? 'yes' : 'no'}">
              <span class="mock-opt-pct">${o.pct}%</span>
              <span class="mock-opt-label">${o.label}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="mock-card-footer">
        <span class="mock-card-vol">Vol: <span>$${m.volume} USDC</span></span>
        <span class="mock-card-deadline">Cierre: ${m.deadline}</span>
      </div>
    </div>
  `).join('');
}

function initCategoryFilters() {
  const btns = document.querySelectorAll('#marketFilters .filter-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderMockMarkets(btn.dataset.filter);
    });
  });
  renderMockMarkets('todos');
}

// ─── PORTFOLIO MOCK DATA ─────────────────────────────────────────────────────
const PORTFOLIO_MOCK = [
  {
    market: '¿Bad Bunny lanza sencillo antes del 30 jun?',
    outcome: 'SÍ',
    amount: '25.00',
    potentialPayout: '37.31',
    status: 'active',
  },
  {
    market: '¿Bitcoin supera $120k USD antes del 30 jun?',
    outcome: 'SÍ',
    amount: '50.00',
    potentialPayout: '416.67',
    status: 'active',
  },
  {
    market: '¿Checo Pérez suma puntos antes del 30 jun?',
    outcome: 'SÍ',
    amount: '10.00',
    potentialPayout: '16.39',
    status: 'active',
  },
];

function renderPortfolio() {
  const empty     = document.getElementById('portfolioEmpty');
  const positions = document.getElementById('portfolioPositions');
  const list      = document.getElementById('portfolioList');
  if (!empty || !positions || !list) return;

  if (!userAddress) {
    empty.style.display = '';
    positions.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  positions.style.display = '';

  const totalBet = PORTFOLIO_MOCK.reduce((s, r) => s + parseFloat(r.amount), 0);
  const totalPot = PORTFOLIO_MOCK.reduce((s, r) => s + parseFloat(r.potentialPayout), 0);

  const pfTotalBet    = document.getElementById('pfTotalBet');
  const pfActiveBets  = document.getElementById('pfActiveBets');
  const pfPotentialWin = document.getElementById('pfPotentialWin');
  if (pfTotalBet)    pfTotalBet.textContent    = '$' + totalBet.toFixed(2) + ' USDC';
  if (pfActiveBets)  pfActiveBets.textContent  = PORTFOLIO_MOCK.length;
  if (pfPotentialWin) pfPotentialWin.textContent = '$' + totalPot.toFixed(2) + ' USDC';

  list.innerHTML = PORTFOLIO_MOCK.map(r => `
    <div class="portfolio-row">
      <div class="portfolio-row-market">${r.market}</div>
      <div class="portfolio-row-outcome">${r.outcome}</div>
      <div class="portfolio-row-amount">${r.amount} USDC</div>
      <div class="portfolio-row-payout">→ ${r.potentialPayout} USDC</div>
      <div class="portfolio-row-status active">ACTIVA</div>
    </div>
  `).join('');
}

// ─── INIT EXTRAS ─────────────────────────────────────────────────────────────
initCategoryFilters();
renderPortfolio();

// ─── HERO MARKET CAROUSEL ────────────────────────────────────────────────────

const HMC_COLORS = {
  green:  '#00E87A',
  gold:   '#F5C842',
  red:    '#FF4545',
  blue:   '#4d8bff',
  purple: '#c47aff',
};

// Random walk from start→end over n steps
function hmcGenWalk(start, end, n, noise) {
  const pts = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    const t      = i / Math.max(n - 1, 1);
    const target = start + (end - start) * t;
    v = v * 0.75 + target * 0.25 + (Math.random() - 0.5) * noise;
    pts.push(Math.max(1, Math.min(99, v)));
  }
  return pts;
}

// Normalize so all series sum to 100 at every time step
function hmcNormalize(seriesArr) {
  const n   = seriesArr[0].length;
  const res = seriesArr.map(s => [...s]);
  for (let i = 0; i < n; i++) {
    const total = res.reduce((sum, s) => sum + s[i], 0);
    res.forEach(s => { s[i] = (s[i] / total) * 100; });
  }
  return res;
}

function hmcBuildHistory(outcomes, days) {
  const raw = outcomes.map(o => hmcGenWalk(o.start, o.pct, days, o.noise || 3));
  return hmcNormalize(raw);
}

const HERO_MARKETS = [
  {
    id: 0,
    cat: '⚽ Deportes · Mundial 2026',
    question: '¿México gana el partido inaugural del Mundial 2026?',
    volume: '$23,412',
    outcomes: [
      { label: '🇲🇽 México',    color: 'green',  pct: 62, start: 51, noise: 3.5 },
      { label: 'Empate',        color: 'gold',   pct: 21, start: 27, noise: 2   },
      { label: '🇿🇦 Sudáfrica', color: 'red',    pct: 17, start: 22, noise: 2   },
    ],
  },
  {
    id: 1,
    cat: '🏀 NBA · MVP 2025–26',
    question: '¿SGA gana el MVP de la NBA esta temporada?',
    volume: '$411,200',
    outcomes: [
      { label: '✅ Sí', color: 'green', pct: 68, start: 54, noise: 4 },
      { label: '❌ No', color: 'red',   pct: 32, start: 46, noise: 4 },
    ],
  },
  {
    id: 2,
    cat: '₿ Crypto · Bitcoin',
    question: '¿Bitcoin supera los $150,000 USD antes de dic 2026?',
    volume: '$1,240,000',
    outcomes: [
      { label: '✅ Sí', color: 'green', pct: 54, start: 40, noise: 5 },
      { label: '❌ No', color: 'red',   pct: 46, start: 60, noise: 5 },
    ],
  },
  {
    id: 3,
    cat: '🌎 Política · México 2027',
    question: '¿Cuál partido gana más escaños en las elecciones MX 2027?',
    volume: '$87,300',
    outcomes: [
      { label: 'MORENA', color: 'green',  pct: 58, start: 63, noise: 2.5 },
      { label: 'PAN',    color: 'blue',   pct: 28, start: 23, noise: 2   },
      { label: 'PRI',    color: 'red',    pct: 14, start: 14, noise: 1.5 },
    ],
  },
  {
    id: 4,
    cat: '🎵 Música · Grammy 2027',
    question: '¿Quién gana el Grammy al Álbum del Año 2027?',
    volume: '$34,800',
    outcomes: [
      { label: 'Kendrick', color: 'purple', pct: 42, start: 34, noise: 4 },
      { label: 'Sabrina',  color: 'gold',   pct: 31, start: 31, noise: 3 },
      { label: 'Otro',     color: 'red',    pct: 27, start: 35, noise: 3 },
    ],
  },
];

// Pre-build all period histories once
const HMC_HISTORIES = HERO_MARKETS.map(m => ({
  '1D':  hmcBuildHistory(m.outcomes, 24),
  '1W':  hmcBuildHistory(m.outcomes, 7),
  '1M':  hmcBuildHistory(m.outcomes, 30),
  'ALL': hmcBuildHistory(m.outcomes, 90),
}));

let hmcIdx    = 0;
let hmcPeriod = '1M';
let hmcTimer  = null;

// data[] → smooth SVG cubic-bezier path string
function hmcPointsToPath(data, W, H) {
  const n      = data.length;
  const PAD    = 10;
  const innerH = H - PAD * 2;
  const pts    = data.map((v, i) => [
    (i / (n - 1)) * W,
    PAD + innerH - (v / 100) * innerH,
  ]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < n; i++) {
    const cx = (pts[i][0] - pts[i - 1][0]) / 3;
    d += ` C${(pts[i-1][0]+cx).toFixed(1)},${pts[i-1][1].toFixed(1)},` +
         `${(pts[i][0]-cx).toFixed(1)},${pts[i][1].toFixed(1)},` +
         `${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)}`;
  }
  return d;
}

function hmcRender(idx) {
  const m   = HERO_MARKETS[idx];
  const ser = HMC_HISTORIES[idx][hmcPeriod];
  const W   = 420, H = 120;

  document.getElementById('hmcCat').textContent      = m.cat;
  document.getElementById('hmcQuestion').textContent = m.question;
  document.getElementById('hmcVol').textContent      = m.volume + ' USDC';

  // ── Chart ──────────────────────────────────────────
  const ns    = 'http://www.w3.org/2000/svg';
  const defs  = document.getElementById('hmcDefs');
  const paths = document.getElementById('hmcChartPaths');
  defs.innerHTML  = '';
  paths.innerHTML = '';

  const mainColor = HMC_COLORS[m.outcomes[0].color];
  const gradId    = 'hmc-g-' + idx;

  // gradient fill def for main series
  const grad = document.createElementNS(ns, 'linearGradient');
  grad.setAttribute('id', gradId);
  grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
  [['0%', '0.18'], ['100%', '0']].forEach(([offset, opacity]) => {
    const stop = document.createElementNS(ns, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', mainColor);
    stop.setAttribute('stop-opacity', opacity);
    grad.appendChild(stop);
  });
  defs.appendChild(grad);

  ser.forEach((data, si) => {
    const color    = HMC_COLORS[m.outcomes[si].color];
    const linePath = hmcPointsToPath(data, W, H);

    // gradient fill under main series
    if (si === 0) {
      const fill = document.createElementNS(ns, 'path');
      fill.setAttribute('d', linePath + ` L${W},${H} L0,${H} Z`);
      fill.setAttribute('fill', `url(#${gradId})`);
      fill.setAttribute('stroke', 'none');
      paths.appendChild(fill);
    }

    // line
    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', linePath);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', si === 0 ? '2' : '1.5');
    line.setAttribute('stroke-opacity', si === 0 ? '1' : '0.7');
    paths.appendChild(line);

    // end-point dot
    const n = data.length;
    const PAD = 10, innerH = H - PAD * 2;
    const ey = PAD + innerH - (data[n - 1] / 100) * innerH;
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', W); dot.setAttribute('cy', ey.toFixed(1));
    dot.setAttribute('r', '3.5');
    dot.setAttribute('fill', color);
    dot.setAttribute('stroke', 'var(--surface1)');
    dot.setAttribute('stroke-width', '1.5');
    paths.appendChild(dot);
  });

  // ── Legend ──────────────────────────────────────────
  document.getElementById('hmcLegend').innerHTML = m.outcomes.map((o, si) => {
    const pct = ser[si][ser[si].length - 1].toFixed(0);
    const col = HMC_COLORS[o.color];
    return `<div class="hmc-legend-item">
      <div class="hmc-legend-line" style="background:${col}"></div>
      <span>${o.label}</span>
      <span class="hmc-legend-pct" style="color:${col}">${pct}%</span>
    </div>`;
  }).join('');

  // ── Outcome buttons ──────────────────────────────────
  document.getElementById('hmcOutcomes').innerHTML = m.outcomes.map((o, si) => {
    const pct = ser[si][ser[si].length - 1].toFixed(0);
    return `<button class="hmc-outcome-btn" data-color="${o.color}" onclick="hmcBet(${idx},${si})">
      <span class="hmc-outcome-pct">${pct}%</span>
      <span class="hmc-outcome-label">${o.label}</span>
    </button>`;
  }).join('');

  // ── Dots ────────────────────────────────────────────
  document.getElementById('hmcDots').innerHTML = HERO_MARKETS.map((_, i) =>
    `<div class="hmc-dot${i === idx ? ' active' : ''}" onclick="hmcGo(${i})"></div>`
  ).join('');

  hmcIdx = idx;
}

function heroCarouselNext() { hmcGo((hmcIdx + 1) % HERO_MARKETS.length); }
function heroCarouselPrev() { hmcGo((hmcIdx - 1 + HERO_MARKETS.length) % HERO_MARKETS.length); }
function hmcGo(i)           { hmcRender(i); hmcResetTimer(); }

function hmcBet(marketIdx, outcomeIdx) {
  if (marketIdx === 0) {
    openBetModal(outcomeIdx + 1);
  } else {
    showToast('🔜 Mercado próximamente disponible');
  }
}

function hmcResetTimer() {
  if (hmcTimer) clearInterval(hmcTimer);
  hmcTimer = setInterval(() => hmcRender((hmcIdx + 1) % HERO_MARKETS.length), 8000);
}

// Time selector
document.getElementById('hmcTimesel').addEventListener('click', e => {
  const btn = e.target.closest('.hmc-time-btn');
  if (!btn) return;
  document.querySelectorAll('.hmc-time-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  hmcPeriod = btn.dataset.period;
  hmcRender(hmcIdx);
});

// Boot
hmcRender(0);
hmcResetTimer();
