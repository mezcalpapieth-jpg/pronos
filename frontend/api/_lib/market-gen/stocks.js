/**
 * US equities over/under market generator.
 *
 * Fetches a Finnhub quote per symbol, picks a round strike slightly
 * above spot, and proposes one weekly binary market per symbol:
 *   "¿{Label} cerrará por encima de $X USD el {dd/mm/yyyy}?"
 *
 * Markets are tagged with resolver_type='api_price' (Chainlink doesn't
 * have equity feeds on Arbitrum, so we re-read Finnhub at settle time).
 * The same source_event_id-per-week idempotency applies — re-running
 * the same generator within the week is a no-op.
 */
import { readFinnhubQuote, STOCKS } from '../stockprice.js';

function nextRoundStrike(current, step) {
  return Math.ceil(current / step) * step;
}

function nextSundayEndUtc(now = new Date()) {
  const d = new Date(now);
  const day = d.getUTCDay();
  const daysAhead = (7 - day) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(23, 59, 0, 0);
  return d;
}

function formatDateYmd(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function formatDateEs(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export async function generateStockMarkets() {
  if (!process.env.FINNHUB_API_KEY) {
    console.warn('[market-gen/stocks] FINNHUB_API_KEY not set — skipping');
    return [];
  }

  const specs = [];
  const end = nextSundayEndUtc();
  const endIso = end.toISOString();
  const endYmd = formatDateYmd(end);
  const endEs = formatDateEs(end);

  for (const [symbol, cfg] of Object.entries(STOCKS)) {
    let quote;
    try {
      quote = await readFinnhubQuote(symbol);
    } catch (e) {
      console.error('[market-gen/stocks] quote failed', { symbol, message: e?.message });
      continue;
    }
    const spot = quote.price;
    if (!Number.isFinite(spot) || spot <= 0) continue;

    const strike = nextRoundStrike(spot, cfg.step);
    const strikeStr = strike.toLocaleString('es-MX');

    specs.push({
      source: 'finnhub',
      source_event_id: `stocks:${symbol}:${endYmd}:${strike}`,
      question: `¿${cfg.label} cerrará por encima de $${strikeStr} USD el ${endEs}?`,
      category: 'finanzas',
      icon: cfg.icon,
      outcomes: ['Sí', 'No'],
      seed_liquidity: 1000,
      end_time: endIso,
      amm_mode: 'unified',
      resolver_type: 'api_price',
      resolver_config: {
        source: 'finnhub',
        symbol,
        threshold: strike,
        op: 'gt',
        yesOutcome: 0,
      },
      source_data: {
        symbol,
        label: cfg.label,
        spotAtGeneration: spot,
        strike,
        step: cfg.step,
      },
    });
  }

  return specs;
}
