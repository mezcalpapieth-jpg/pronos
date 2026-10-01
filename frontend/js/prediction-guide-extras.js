(() => {
  const MXNP = new Intl.NumberFormat('es-MX', {
    maximumFractionDigits: 0,
  });
  const DECIMAL = new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const parlayMarkets = [
    { id: 'btc', label: 'Bitcoin cierra arriba de 120K', probability: 0.58 },
    { id: 'aicm', label: 'AICM supera 35 retrasos', probability: 0.47 },
    { id: 'gold', label: 'Oro termina la semana verde', probability: 0.54 },
    { id: 'oil', label: 'WTI baja de 60 USD', probability: 0.42 },
    { id: 'futbol', label: 'America gana el clasico', probability: 0.51 },
    { id: 'clima', label: 'Llueve en CDMX el domingo', probability: 0.36 },
  ];

  const state = {
    selected: new Set(['btc', 'aicm', 'gold']),
    stake: 250,
    holdDays: 18,
    entryPrice: 62,
  };

  function money(value) {
    return `${MXNP.format(Math.round(value))} MXNP`;
  }

  function percent(value) {
    return `${Math.round(value * 100)}%`;
  }

  function injectStyles() {
    if (document.getElementById('prediction-guide-extra-styles')) return;
    const style = document.createElement('style');
    style.id = 'prediction-guide-extra-styles';
    style.textContent = `
      .guide-extra-lang {
        position: fixed;
        left: 16px;
        top: 16px;
        z-index: 60;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: rgba(17, 17, 17, 0.82);
        color: var(--gray-6);
        padding: 9px 12px;
        font-family: var(--font-dm-mono);
        font-size: 11px;
        text-decoration: none;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        backdrop-filter: blur(12px);
      }
      .guide-extra-lang:hover {
        border-color: var(--orange);
        color: var(--orange);
      }
      .guide-extra-card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: hidden;
      }
      .guide-extra-card-inner {
        padding: 24px;
      }
      .guide-extra-market-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .guide-extra-market {
        border: 1px solid var(--border);
        background: var(--gray-1);
        border-radius: 10px;
        padding: 14px;
        text-align: left;
        cursor: pointer;
        transition: border-color 150ms ease, background 150ms ease, transform 150ms ease;
      }
      .guide-extra-market:hover {
        border-color: var(--border-hover);
      }
      .guide-extra-market.is-selected {
        border-color: color-mix(in oklab, var(--orange) 45%, transparent);
        background: var(--orange-dim);
      }
      .guide-extra-market:active {
        transform: scale(0.99);
      }
      .guide-extra-label {
        color: var(--gray-6);
        font-size: 13px;
        line-height: 1.25;
        margin-bottom: 8px;
      }
      .guide-extra-prob {
        color: var(--orange);
        font-family: var(--font-dm-mono);
        font-size: 12px;
      }
      .guide-extra-summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-top: 18px;
      }
      .guide-extra-stat {
        background: var(--surface-elevated);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 14px;
      }
      .guide-extra-stat span {
        display: block;
        color: var(--gray-4);
        font-family: var(--font-dm-mono);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 6px;
      }
      .guide-extra-stat strong {
        display: block;
        color: var(--foreground);
        font-family: var(--font-dm-mono);
        font-size: 18px;
        line-height: 1.1;
      }
      .guide-extra-controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        margin-top: 18px;
      }
      .guide-extra-control {
        background: var(--surface-elevated);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 14px;
      }
      .guide-extra-control label {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: var(--gray-4);
        font-family: var(--font-dm-mono);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 10px;
      }
      .guide-extra-control input {
        width: 100%;
        accent-color: var(--orange);
      }
      .guide-extra-meter {
        height: 12px;
        background: var(--gray-1);
        border-radius: 999px;
        overflow: hidden;
        margin-top: 16px;
      }
      .guide-extra-meter span {
        display: block;
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, var(--orange), var(--orange-light));
        border-radius: inherit;
        transition: width 180ms ease;
      }
      .guide-extra-note {
        color: var(--gray-4);
        border-left: 2px solid var(--orange);
        padding-left: 16px;
        margin-top: 18px;
        font-family: var(--font-dm-mono);
        font-size: 12px;
        line-height: 1.6;
      }
      @media (max-width: 720px) {
        .guide-extra-lang {
          left: 12px;
          top: 12px;
          font-size: 10px;
        }
        .guide-extra-market-grid,
        .guide-extra-summary,
        .guide-extra-controls {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function addLanguageSwitch() {
    if (document.querySelector('.guide-extra-lang')) return;
    const link = document.createElement('a');
    link.className = 'guide-extra-lang';
    link.href = '/what-are-prediction-markets';
    link.textContent = 'English';
    document.body.prepend(link);
  }

  function updateHeroCounters() {
    const spans = document.querySelectorAll('span');
    spans.forEach((span) => {
      const text = (span.textContent || '').trim();
      if (text === '5 capitulos' || text === '5 capítulos') span.textContent = '7 capítulos';
      if (text === '4 simuladores') span.textContent = '6 simuladores';
    });
  }

  function chapterHeader(number, title, subtitle) {
    return `
      <div class="mb-10">
        <span class="font-mono text-xs uppercase tracking-[0.2em] text-orange mb-3 block">Cap ${String(number).padStart(2, '0')}</span>
        <h2 class="font-display text-4xl md:text-6xl uppercase leading-none mb-4">${title}</h2>
        <p class="text-gray-5 text-base md:text-lg max-w-2xl leading-relaxed">${subtitle}</p>
      </div>
    `;
  }

  function createSection(id, number, title, subtitle, body) {
    const section = document.createElement('section');
    section.id = id;
    section.className = 'section-enter visible py-20 px-6 md:px-12';
    section.innerHTML = `
      <div class="max-w-4xl mx-auto">
        ${chapterHeader(number, title, subtitle)}
        ${body}
      </div>
    `;
    return section;
  }

  function selectedMarkets() {
    return parlayMarkets.filter(market => state.selected.has(market.id));
  }

  function calculateParlay() {
    const picks = selectedMarkets();
    const productProbability = picks.reduce((product, market) => product * market.probability, 1);
    const valid = picks.length >= 3 && picks.length <= 6;
    const rawMultiplier = valid && productProbability > 0 ? 0.75 / productProbability : 0;
    const multiplier = Math.min(25, Math.max(0, rawMultiplier));
    const uncappedPayout = state.stake * multiplier;
    const payout = Math.min(5000, uncappedPayout);
    return {
      picks,
      valid,
      productProbability,
      multiplier,
      payout,
      capped: uncappedPayout > 5000,
    };
  }

  function renderParlay() {
    const root = document.getElementById('guide-parlay-sim');
    if (!root) return;
    const result = calculateParlay();
    root.querySelectorAll('[data-market]').forEach((button) => {
      const id = button.getAttribute('data-market');
      button.classList.toggle('is-selected', state.selected.has(id));
    });
    root.querySelector('[data-selected-count]').textContent = `${result.picks.length}/6`;
    root.querySelector('[data-parlay-multiplier]').textContent = result.valid ? `${DECIMAL.format(result.multiplier)}x` : 'elige 3+';
    root.querySelector('[data-parlay-payout]').textContent = result.valid ? money(result.payout) : '--';
    root.querySelector('[data-parlay-probability]').textContent = result.valid ? percent(result.productProbability) : '--';
    root.querySelector('[data-parlay-status]').textContent = result.valid
      ? (result.capped ? 'Pago limitado al tope de 5,000 MXNP.' : 'Ticket valido: todas las piernas deben ganar.')
      : 'Selecciona entre 3 y 6 mercados para formar la combinada.';
  }

  function createParlaySection() {
    const markets = parlayMarkets.map(market => `
      <button class="guide-extra-market ${state.selected.has(market.id) ? 'is-selected' : ''}" data-market="${market.id}">
        <div class="guide-extra-label">${market.label}</div>
        <div class="guide-extra-prob">${percent(market.probability)} precio actual</div>
      </button>
    `).join('');
    return createSection(
      'combinadas',
      6,
      'Combinadas',
      'Junta de 3 a 6 mercados en un solo ticket y observa como cambia el multiplicador.',
      `
        <div class="space-y-4 text-sm text-gray-5 leading-relaxed max-w-2xl mb-10">
          <p>Una combinada paga mas porque necesitas acertar todas las piernas. El simulador usa seis mercados ficticios: activa o desactiva selecciones y mira como el multiplicador responde.</p>
          <p class="text-gray-4 text-xs font-mono border-l-2 border-orange pl-4">En Pronos el calculo real tambien aplica reglas de elegibilidad, grupos de exposicion, descuentos y topes para evitar tickets extremos.</p>
        </div>
        <div id="guide-parlay-sim" class="guide-extra-card">
          <div class="guide-extra-card-inner">
            <div class="guide-extra-market-grid">${markets}</div>
            <div class="guide-extra-controls">
              <div class="guide-extra-control">
                <label><span>Stake</span><strong><span data-parlay-stake>${money(state.stake)}</span></strong></label>
                <input type="range" min="50" max="1000" step="50" value="${state.stake}" data-parlay-stake-input>
              </div>
              <div class="guide-extra-control">
                <label><span>Selecciones</span><strong data-selected-count>3/6</strong></label>
                <div class="guide-extra-note" style="margin-top:0">Puedes elegir de 3 a 6. Si una pierna pierde, el ticket pierde.</div>
              </div>
            </div>
            <div class="guide-extra-summary">
              <div class="guide-extra-stat"><span>Multiplicador</span><strong data-parlay-multiplier>--</strong></div>
              <div class="guide-extra-stat"><span>Pago potencial</span><strong data-parlay-payout>--</strong></div>
              <div class="guide-extra-stat"><span>Prob. combinada</span><strong data-parlay-probability>--</strong></div>
            </div>
            <div class="guide-extra-note" data-parlay-status></div>
          </div>
        </div>
      `,
    );
  }

  function calculateHold() {
    const stake = 500;
    const entry = state.entryPrice / 100;
    const shares = stake / entry;
    const baseProfit = (shares * 1) - stake;
    const timeFactor = Math.min(1, Math.max(0, state.holdDays / 30));
    const priceFactor = Math.max(0, Math.min(1, (0.85 - entry) / 0.5));
    const bonusRate = Math.min(0.5, 0.5 * timeFactor * priceFactor);
    const bonus = baseProfit * bonusRate;
    return {
      stake,
      shares,
      baseProfit,
      bonusRate,
      bonus,
      total: baseProfit + bonus,
    };
  }

  function renderHold() {
    const root = document.getElementById('guide-hold-sim');
    if (!root) return;
    const result = calculateHold();
    root.querySelector('[data-hold-days]').textContent = `${state.holdDays} dias`;
    root.querySelector('[data-entry-price]').textContent = `${state.entryPrice}c`;
    root.querySelector('[data-hold-shares]').textContent = DECIMAL.format(result.shares);
    root.querySelector('[data-base-profit]').textContent = money(result.baseProfit);
    root.querySelector('[data-hold-bonus]').textContent = money(result.bonus);
    root.querySelector('[data-hold-total]').textContent = money(result.total);
    root.querySelector('[data-hold-rate]').textContent = `${Math.round(result.bonusRate * 100)}% extra`;
    root.querySelector('[data-hold-meter]').style.width = `${Math.round(result.bonusRate * 200)}%`;
  }

  function createHoldSection() {
    return createSection(
      'long-hold',
      7,
      'Long hold',
      'La conviccion premia posiciones ganadoras que se compraron bien y se mantuvieron hasta resolver.',
      `
        <div class="space-y-4 text-sm text-gray-5 leading-relaxed max-w-2xl mb-10">
          <p>Este simulador asume una compra de 500 MXNP que termina ganando. Mueve los dias de hold y el precio de entrada para ver como crece el bono de conviccion.</p>
          <p class="text-gray-4 text-xs font-mono border-l-2 border-orange pl-4">La idea es premiar capital que realmente se queda en riesgo. Entrar caro o vender antes de resolver reduce o elimina el bono.</p>
        </div>
        <div id="guide-hold-sim" class="guide-extra-card">
          <div class="guide-extra-card-inner">
            <div class="guide-extra-controls">
              <div class="guide-extra-control">
                <label><span>Dias en mercado</span><strong data-hold-days>${state.holdDays} dias</strong></label>
                <input type="range" min="0" max="30" step="1" value="${state.holdDays}" data-hold-days-input>
              </div>
              <div class="guide-extra-control">
                <label><span>Precio de entrada</span><strong data-entry-price>${state.entryPrice}c</strong></label>
                <input type="range" min="35" max="85" step="1" value="${state.entryPrice}" data-entry-price-input>
              </div>
            </div>
            <div class="guide-extra-meter"><span data-hold-meter></span></div>
            <div class="guide-extra-summary">
              <div class="guide-extra-stat"><span>Acciones</span><strong data-hold-shares>--</strong></div>
              <div class="guide-extra-stat"><span>PnL base</span><strong data-base-profit>--</strong></div>
              <div class="guide-extra-stat"><span>Bono hold</span><strong data-hold-bonus>--</strong></div>
              <div class="guide-extra-stat"><span>Multiplicador</span><strong data-hold-rate>--</strong></div>
              <div class="guide-extra-stat"><span>Total estimado</span><strong data-hold-total>--</strong></div>
              <div class="guide-extra-stat"><span>Stake ejemplo</span><strong>${money(500)}</strong></div>
            </div>
          </div>
        </div>
      `,
    );
  }

  function wireParlay() {
    const root = document.getElementById('guide-parlay-sim');
    if (!root) return;
    root.querySelectorAll('[data-market]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.getAttribute('data-market');
        if (state.selected.has(id)) {
          state.selected.delete(id);
        } else if (state.selected.size < 6) {
          state.selected.add(id);
        }
        renderParlay();
      });
    });
    const stakeInput = root.querySelector('[data-parlay-stake-input]');
    stakeInput.addEventListener('input', () => {
      state.stake = Number(stakeInput.value);
      root.querySelector('[data-parlay-stake]').textContent = money(state.stake);
      renderParlay();
    });
    renderParlay();
  }

  function wireHold() {
    const root = document.getElementById('guide-hold-sim');
    if (!root) return;
    const daysInput = root.querySelector('[data-hold-days-input]');
    const entryInput = root.querySelector('[data-entry-price-input]');
    daysInput.addEventListener('input', () => {
      state.holdDays = Number(daysInput.value);
      renderHold();
    });
    entryInput.addEventListener('input', () => {
      state.entryPrice = Number(entryInput.value);
      renderHold();
    });
    renderHold();
  }

  function mount() {
    if (document.getElementById('guide-parlay-sim')) return;
    injectStyles();
    addLanguageSwitch();
    updateHeroCounters();

    const primitive = document.getElementById('primitivo');
    const main = document.querySelector('main');
    if (!primitive || !main) return;
    const finalCta = primitive.nextElementSibling;
    const parlay = createParlaySection();
    const hold = createHoldSection();
    main.insertBefore(parlay, finalCta);
    main.insertBefore(hold, finalCta);
    wireParlay();
    wireHold();
  }

  window.addEventListener('load', () => {
    window.setTimeout(mount, 150);
  });
})();
