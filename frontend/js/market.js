// ─── market.js ───────────────────────────────────────────────────────────────
// Market detail page logic for /market?id=<market-id>

(function () {
  'use strict';

  // ── Resolve market from query param ──────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const marketId = params.get('id');

  if (!marketId) {
    location.href = '/#market';
    return;
  }

  const market = (typeof MARKETS !== 'undefined' ? MARKETS : []).find(m => m.id === marketId);

  if (!market) {
    document.getElementById('marketContent').innerHTML = `
      <div class="not-found">
        <div class="not-found-icon">🔍</div>
        <div class="not-found-title">Mercado no encontrado</div>
        <div class="not-found-sub">El mercado "<strong>${escapeHtml(marketId)}</strong>" no existe.<br>
          <a href="/#market" style="color:var(--green);text-decoration:underline;margin-top:8px;display:inline-block">Ver todos los mercados</a>
        </div>
      </div>`;
    return;
  }

  // ── Chart helpers (copied from app.js hmcGenWalk logic) ──────────────────

  function genWalk(start, end, n, noise, smoothing) {
    smoothing = smoothing === undefined ? 0.75 : smoothing;
    var pts = [];
    var v = start;
    for (var i = 0; i < n; i++) {
      var t      = i / Math.max(n - 1, 1);
      var target = start + (end - start) * t;
      var spike  = Math.random() < 0.08 ? (Math.random() - 0.5) * noise * 3 : 0;
      v = v * smoothing + target * (1 - smoothing) + (Math.random() - 0.5) * noise + spike;
      pts.push(Math.max(1, Math.min(99, v)));
    }
    return pts;
  }

  function normalize(seriesArr) {
    var n   = seriesArr[0].length;
    var res = seriesArr.map(function (s) { return s.slice(); });
    for (var i = 0; i < n; i++) {
      var total = res.reduce(function (sum, s) { return sum + s[i]; }, 0);
      res.forEach(function (s) { s[i] = (s[i] / total) * 100; });
    }
    return res;
  }

  function buildHistory(options, days, noiseMult, smoothing) {
    noiseMult = noiseMult === undefined ? 1 : noiseMult;
    smoothing = smoothing === undefined ? 0.75 : smoothing;
    // build plausible start values offset from current pct
    var raw = options.map(function (o) {
      var startOffset = (Math.random() - 0.5) * 30;
      var start = Math.max(5, Math.min(95, o.pct + startOffset));
      return genWalk(start, o.pct, days, 3 * noiseMult, smoothing);
    });
    return normalize(raw);
  }

  // Pre-build chart histories for each time period
  var HISTORIES = {
    '1H':  buildHistory(market.options,  30, 0.5, 0.88),
    '6H':  buildHistory(market.options,  48, 0.8, 0.84),
    '1D':  buildHistory(market.options,  60, 1.2, 0.80),
    '1W':  buildHistory(market.options,  90, 2.5, 0.70),
    '1M':  buildHistory(market.options, 130, 4.5, 0.60),
    'ALL': buildHistory(market.options, 200, 7.0, 0.50),
  };

  var activePeriod = '1W';
  var activeTab    = 'reglas';

  // ── SVG chart renderer ────────────────────────────────────────────────────

  var W = 420, H = 180;
  var ns = 'http://www.w3.org/2000/svg';

  function pointsToPath(data) {
    var n = data.length;
    var pts = data.map(function (v, i) {
      return {
        x: (i / (n - 1)) * W,
        y: H - (v / 100) * H,
      };
    });

    var d = 'M ' + pts[0].x.toFixed(2) + ' ' + pts[0].y.toFixed(2);
    for (var i = 1; i < pts.length; i++) {
      var prev = pts[i - 1];
      var cur  = pts[i];
      var cpx  = (prev.x + cur.x) / 2;
      d += ' C ' + cpx.toFixed(2) + ' ' + prev.y.toFixed(2) +
           ', '  + cpx.toFixed(2) + ' ' + cur.y.toFixed(2) +
           ', '  + cur.x.toFixed(2) + ' ' + cur.y.toFixed(2);
    }
    return d;
  }

  function renderChart(period) {
    var svg   = document.getElementById('mktChart');
    var defs  = document.getElementById('mktDefs');
    var paths = document.getElementById('mktPaths');
    if (!svg) return;

    defs.innerHTML  = '';
    paths.innerHTML = '';

    var data = HISTORIES[period];
    var mainData = data[0];

    // gradient for Yes fill
    var grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', 'mkt-grad');
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
    [{offset:'0%', opacity:'0.28'}, {offset:'80%', opacity:'0.04'}, {offset:'100%', opacity:'0'}].forEach(function (s) {
      var stop = document.createElementNS(ns, 'stop');
      stop.setAttribute('offset', s.offset);
      stop.setAttribute('stop-color', '#00E87A');
      stop.setAttribute('stop-opacity', s.opacity);
      grad.appendChild(stop);
    });
    defs.appendChild(grad);

    // Grid lines
    [0.1, 0.37, 0.63, 0.90].forEach(function (y) {
      var line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '0'); line.setAttribute('y1', (H * y).toFixed(1));
      line.setAttribute('x2', String(W)); line.setAttribute('y2', (H * y).toFixed(1));
      line.setAttribute('stroke', 'rgba(255,255,255,0.04)');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-dasharray', '4,4');
      paths.appendChild(line);
    });

    // Fill area under main series
    var linePath = pointsToPath(mainData);
    var lastX = W;
    var lastY = H - (mainData[mainData.length - 1] / 100) * H;
    var fill = document.createElementNS(ns, 'path');
    fill.setAttribute('d', linePath + ' L ' + lastX.toFixed(2) + ' ' + H + ' L 0 ' + H + ' Z');
    fill.setAttribute('fill', 'url(#mkt-grad)');
    paths.appendChild(fill);

    // Main line (Yes / first option — green)
    var yesLine = document.createElementNS(ns, 'path');
    yesLine.setAttribute('d', linePath);
    yesLine.setAttribute('fill', 'none');
    yesLine.setAttribute('stroke', '#00E87A');
    yesLine.setAttribute('stroke-width', '2');
    yesLine.setAttribute('stroke-linecap', 'round');
    paths.appendChild(yesLine);

    // Secondary lines (other options — muted)
    var secondaryColors = ['#FF4545', '#F5C842', '#4d8bff', '#c47aff'];
    for (var si = 1; si < data.length; si++) {
      var secLine = document.createElementNS(ns, 'path');
      secLine.setAttribute('d', pointsToPath(data[si]));
      secLine.setAttribute('fill', 'none');
      secLine.setAttribute('stroke', secondaryColors[(si - 1) % secondaryColors.length]);
      secLine.setAttribute('stroke-width', '1.5');
      secLine.setAttribute('stroke-linecap', 'round');
      secLine.setAttribute('opacity', '0.5');
      paths.appendChild(secLine);
    }

    // Current value dot on main line
    var dotX = W;
    var dotY = H - (mainData[mainData.length - 1] / 100) * H;
    var dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', dotX.toFixed(2));
    dot.setAttribute('cy', dotY.toFixed(2));
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', '#00E87A');
    dot.setAttribute('stroke', '#080808');
    dot.setAttribute('stroke-width', '2');
    paths.appendChild(dot);

    // X-axis date labels
    renderXLabels(period, mainData.length);
  }

  function renderXLabels(period, n) {
    var wrap = document.getElementById('mktXLabels');
    if (!wrap) return;
    var now    = new Date();
    var labels = [];
    var count  = 5;

    var msAgo;
    switch (period) {
      case '1H':  msAgo = 60 * 60 * 1000;               break;
      case '6H':  msAgo = 6 * 60 * 60 * 1000;           break;
      case '1D':  msAgo = 24 * 60 * 60 * 1000;          break;
      case '1W':  msAgo = 7 * 24 * 60 * 60 * 1000;      break;
      case '1M':  msAgo = 30 * 24 * 60 * 60 * 1000;     break;
      case 'ALL': msAgo = 180 * 24 * 60 * 60 * 1000;    break;
      default:    msAgo = 7 * 24 * 60 * 60 * 1000;
    }

    var start = new Date(now.getTime() - msAgo);
    for (var i = 0; i < count; i++) {
      var t = new Date(start.getTime() + (msAgo * i / (count - 1)));
      var label;
      if (period === '1H' || period === '6H') {
        label = t.getHours().toString().padStart(2,'0') + ':' + t.getMinutes().toString().padStart(2,'0');
      } else if (period === '1D') {
        label = t.getHours().toString().padStart(2,'0') + 'h';
      } else {
        var months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        label = t.getDate() + ' ' + months[t.getMonth()];
      }
      labels.push(label);
    }

    wrap.innerHTML = labels.map(function (l) {
      return '<span>' + l + '</span>';
    }).join('');
  }

  // ── Mock activity feed ────────────────────────────────────────────────────

  var USERNAMES = [
    'puma_mx','crypto_taco','luisito_d','la_mota99','beto_base',
    'xochitl_w','checo_fan1','el_mago88','wendy_sol','bit_king_',
    'pronos_pro','narco_bets','javi_eth','pirate_mx','gaby_chain',
  ];

  function fakeActivity() {
    var items = [];
    var now = Date.now();
    var firstOpt  = market.options[0];
    var secondOpt = market.options[1] || { label: 'No', pct: 100 - firstOpt.pct };

    for (var i = 0; i < 10; i++) {
      var user    = USERNAMES[Math.floor(Math.random() * USERNAMES.length)];
      var isBuy   = Math.random() > 0.3;
      var isYes   = Math.random() < (firstOpt.pct / 100);
      var outcome = isYes ? firstOpt.label : secondOpt.label;
      var cents   = (Math.random() * 0.4 + (isYes ? firstOpt.pct - 5 : secondOpt.pct - 5)).toFixed(0);
      cents = Math.max(1, Math.min(99, parseInt(cents, 10)));
      var amount  = (Math.random() * 95 + 5).toFixed(0);
      var secsAgo = Math.floor(Math.random() * 3600 * 6);
      items.push({ user, isBuy, outcome, isYes, cents, amount, secsAgo });
    }
    // sort newest first
    items.sort(function (a, b) { return a.secsAgo - b.secsAgo; });
    return items;
  }

  function timeAgo(secs) {
    if (secs < 60)     return 'hace ' + secs + 's';
    if (secs < 3600)   return 'hace ' + Math.floor(secs / 60) + 'min';
    return 'hace ' + Math.floor(secs / 3600) + 'h';
  }

  function avatarInitial(username) {
    return username[0].toUpperCase();
  }

  function avatarBg(username) {
    var colors = ['#1a3a2a','#3a1a1a','#1a1a3a','#2a2a1a','#2a1a2a'];
    var idx = username.charCodeAt(0) % colors.length;
    return colors[idx];
  }

  // ── Mock context & rules ──────────────────────────────────────────────────

  function buildRules() {
    var opt0 = market.options[0].label;
    var opt1 = (market.options[1] || {}).label || 'No';
    return [
      'Este mercado se resuelve cuando se confirme oficialmente el resultado antes del cierre (' + market.deadline + ').',
      'La fuente principal de resolución será un proveedor de datos verificado. En caso de disputa, se tomará la segunda fuente oficial.',
      'Si el evento es cancelado o pospuesto más allá de la fecha límite, el mercado se resuelve como <strong>' + opt1 + '</strong>.',
      'Las apuestas se pueden realizar en USDC hasta 1 hora antes del cierre del mercado.',
      'La liquidación se realiza automáticamente vía smart contract en Base una vez confirmada la resolución.',
      'Comisión del 2% sobre ganancias netas. Sin comisión si pierdes.',
    ];
  }

  function buildContext() {
    var title = market.title;
    var cat   = market.categoryLabel;
    return `
      <div class="ai-badge">✦ Contexto generado por IA</div>
      <p>El mercado "<em>${escapeHtml(title)}</em>" forma parte de la categoría ${escapeHtml(cat)} dentro de la plataforma Pronos. Este tipo de pregunta binaria permite a los participantes tomar una posición basada en su análisis de la situación actual.</p>
      <p>Las probabilidades actuales reflejan el consenso del mercado: la opción más popular actualmente cotiza a <strong style="color:var(--green)">${market.options[0].pct}¢</strong>, lo que implica una probabilidad de mercado de ${market.options[0].pct}% de que ocurra antes del ${escapeHtml(market.deadline)}.</p>
      <p>El volumen acumulado de <strong>$${escapeHtml(market.volume)} USDC</strong> indica un interés moderado-alto en este evento. Los movimientos de precio en las últimas horas sugieren que el mercado está incorporando nueva información relevante.</p>
    `;
  }

  // ── Render page ───────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildOutcomeButtons() {
    var isMulti = market.options.length > 2;
    var cls = isMulti ? 'outcome-row multi' : 'outcome-row';
    return '<div class="' + cls + '">' +
      market.options.map(function (o, i) {
        var btnCls = isMulti ? 'outcome-btn' : (i === 0 ? 'outcome-btn yes' : 'outcome-btn no');
        var hint   = i === 0 ? market.options[0].pct + '¢ por acción' : o.pct + '¢ por acción';
        return `<button class="${btnCls}" onclick="handleOutcomeBet('${escapeHtml(o.label)}', ${o.pct})">
          <span class="outcome-btn-pct">${o.pct}%</span>
          <span class="outcome-btn-label">${escapeHtml(o.label)}</span>
          <span class="outcome-btn-hint">${o.pct}¢</span>
        </button>`;
      }).join('') +
    '</div>';
  }

  function buildBetPanelOutcomes() {
    return market.options.map(function (o) {
      return `<div class="bet-panel-opt" onclick="handleOutcomeBet('${escapeHtml(o.label)}', ${o.pct})">
        <span class="bet-panel-opt-label">${escapeHtml(o.label)}</span>
        <span class="bet-panel-opt-pct">${o.pct}¢</span>
      </div>`;
    }).join('');
  }

  function buildRelated() {
    var others = MARKETS.filter(function (m) {
      return m.id !== market.id && m.category === market.category;
    }).slice(0, 3);

    // If not enough in same category, pad with any other markets
    if (others.length < 3) {
      var extra = MARKETS.filter(function (m) {
        return m.id !== market.id && m.category !== market.category;
      }).slice(0, 3 - others.length);
      others = others.concat(extra);
    }

    if (!others.length) return '<p style="font-size:13px;color:var(--text-muted)">No hay mercados relacionados.</p>';

    return others.map(function (m) {
      var pct0    = m.options[0].pct;
      var pctCls  = pct0 >= 50 ? 'yes-color' : 'no-color';
      return `<a class="related-item" href="/market?id=${escapeHtml(m.id)}">
        <span class="related-item-icon">${m.icon}</span>
        <span class="related-item-body">
          <span class="related-item-title">${escapeHtml(m.title)}</span>
        </span>
        <span class="related-item-pct ${pctCls}">${pct0}%</span>
      </a>`;
    }).join('');
  }

  function buildActivityFeed() {
    var feed = fakeActivity();
    return feed.map(function (item) {
      var actionCls  = item.isBuy ? 'action-buy' : 'action-sell';
      var actionWord = item.isBuy ? 'compró' : 'vendió';
      var outcomeCls = item.isYes ? 'outcome-yes' : 'outcome-no';
      var bg = avatarBg(item.user);
      return `<div class="activity-item">
        <div class="activity-left">
          <div class="activity-avatar" style="background:${bg}">${avatarInitial(item.user)}</div>
          <span class="activity-text">
            <span class="username">${escapeHtml(item.user)}</span>
            &nbsp;<span class="${actionCls}">${actionWord}</span>
            &nbsp;$${item.amount} USDC
            &nbsp;<span class="${outcomeCls}">${escapeHtml(item.outcome)}</span>
            &nbsp;a ${item.cents}¢
          </span>
        </div>
        <span class="activity-time">${timeAgo(item.secsAgo)}</span>
      </div>`;
    }).join('');
  }

  function renderPage() {
    var mainPct = market.options[0].pct;
    var rules   = buildRules();

    var html = `
      <!-- MARKET HEADER -->
      <div class="mkt-header">
        <div class="mkt-header-top">
          <span class="mkt-icon">${market.icon}</span>
          <span class="mkt-cat-label">${escapeHtml(market.categoryLabel)}</span>
        </div>
        <div class="mkt-title">${escapeHtml(market.title)}</div>
        <div class="mkt-pills">
          <span class="mkt-pill">
            <span class="dot-live"></span>
            En vivo
          </span>
          <span class="mkt-pill">
            📅 Cierre: ${escapeHtml(market.deadline)}
          </span>
          <span class="mkt-pill">
            💧 Vol: $${escapeHtml(market.volume)} USDC
          </span>
        </div>
      </div>

      <!-- TWO-COLUMN LAYOUT -->
      <div class="market-layout">

        <!-- LEFT COLUMN -->
        <div class="market-main">

          <!-- CHART SECTION -->
          <div class="chart-section">
            <div class="chart-headline" id="mktHeadlinePct">${mainPct}%</div>
            <div class="chart-headline-sub">probabilidad · ${escapeHtml(market.options[0].label)}</div>

            <div class="chart-time-btns" id="chartTimeBtns">
              ${['1H','6H','1D','1W','1M','ALL'].map(function (p) {
                return `<button class="chart-time-btn${p === activePeriod ? ' active' : ''}" data-period="${p}">${p}</button>`;
              }).join('')}
            </div>

            <div class="chart-wrap">
              <svg class="chart-svg" id="mktChart" viewBox="0 0 420 180" preserveAspectRatio="none">
                <defs id="mktDefs"></defs>
                <g id="mktPaths"></g>
              </svg>
            </div>
            <div class="chart-x-labels" id="mktXLabels"></div>
          </div>

          <!-- OUTCOME BUTTONS -->
          ${buildOutcomeButtons()}

          <!-- TABS -->
          <div class="tabs-section">
            <div class="tabs-nav">
              <button class="tab-btn active" data-tab="reglas">Reglas</button>
              <button class="tab-btn" data-tab="contexto">Contexto</button>
              <button class="tab-btn" data-tab="actividad">Actividad</button>
            </div>

            <div class="tab-pane active" id="tab-reglas">
              <div class="rules-block">
                ${rules.map(function (r, i) {
                  return `<div class="rule-item">
                    <span class="rule-num">0${i+1}</span>
                    <span class="rule-text">${r}</span>
                  </div>`;
                }).join('')}
              </div>
            </div>

            <div class="tab-pane" id="tab-contexto">
              <div class="context-block">${buildContext()}</div>
            </div>

            <div class="tab-pane" id="tab-actividad">
              <div class="activity-feed" id="activityFeed">
                ${buildActivityFeed()}
              </div>
            </div>
          </div>

        </div>

        <!-- RIGHT SIDEBAR -->
        <div class="market-sidebar">

          <!-- BET PANEL -->
          <div class="bet-panel">
            <div class="bet-panel-title">Hacer predicción</div>
            <div class="bet-panel-outcomes">
              ${buildBetPanelOutcomes()}
            </div>
            <button class="bet-panel-cta" onclick="handleConnectWallet()">
              Conectar wallet para apostar
            </button>
            <div class="bet-panel-note">⚡ En Base · USDC · 2% comisión</div>
          </div>

          <!-- RELATED MARKETS -->
          <div class="related-section">
            <div class="related-title">Mercados relacionados</div>
            <div class="related-list">
              ${buildRelated()}
            </div>
          </div>

        </div>
      </div>
    `;

    document.getElementById('marketContent').innerHTML = html;
    document.title = market.title + ' — PRONOS';

    // Wire up chart time buttons
    document.getElementById('chartTimeBtns').addEventListener('click', function (e) {
      var btn = e.target.closest('.chart-time-btn');
      if (!btn) return;
      document.querySelectorAll('.chart-time-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activePeriod = btn.dataset.period;
      renderChart(activePeriod);
    });

    // Wire up tab buttons
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        var pane = document.getElementById('tab-' + btn.dataset.tab);
        if (pane) pane.classList.add('active');
      });
    });

    // Initial chart render
    renderChart(activePeriod);
  }

  // ── Global handlers ───────────────────────────────────────────────────────

  window.handleOutcomeBet = function (outcome, pct) {
    alert('Conecta tu wallet para apostar en: ' + outcome + ' (' + pct + '¢)');
  };

  window.handleConnectWallet = function () {
    alert('Conectar wallet — próximamente disponible en Base.');
  };

  // ── Boot ──────────────────────────────────────────────────────────────────
  renderPage();

})();
