/**
 * USD/MXN FX market generator.
 *
 * Reads the latest Banxico FIX rate (the canonical reference everyone
 * quotes), rounds up to a neat strike (nearest $0.25), and proposes
 * one weekly binary market:
 *   "USD/MXN cierre del viernes > $X.XX"
 *
 * resolver_type='api_price', resolver_config.source='banxico-fix' so
 * the auto-resolver re-reads the same series at close time.
 *
 * Idempotent across re-runs within the same week because source_event_id
 * is namespaced by the Friday-of-week date + strike.
 */
import { readBanxicoLatest, SERIES } from '../banxico.js';

function nextRoundStrike(current, step) {
  return Math.ceil(current / step) * step;
}

// Roll forward to next Friday 21:00 UTC (end of US trading + past
// Banxico's 12:00 CDT FIX publish). If today IS Friday, skip to the
// one after so the market has a full week of depth to build up.
function nextFridayCloseUtc(now = new Date()) {
  const d = new Date(now);
  const day = d.getUTCDay();                // 0=Sun, 5=Fri
  const daysAhead = ((5 - day + 7) % 7) || 7; // today Fri → next Fri
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(21, 0, 0, 0);
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

export async function generateFxMarkets() {
  if (!process.env.BANXICO_API_TOKEN) {
    console.warn('[market-gen/fx] BANXICO_API_TOKEN not set — skipping');
    return [];
  }

  let latest;
  try {
    latest = await readBanxicoLatest(SERIES.FX_USD_MXN);
  } catch (e) {
    console.error('[market-gen/fx] banxico read failed', { message: e?.message });
    return [];
  }
  if (!Number.isFinite(latest?.value) || latest.value <= 0) return [];

  const end = nextFridayCloseUtc();
  const endIso = end.toISOString();
  const endYmd = formatDateYmd(end);
  const endEs  = formatDateEs(end);

  // 0.25 MXN step → natural round numbers like $20.25 / $20.50 / $20.75.
  // Peso moves maybe 0.5-1% in a week, so a 0.25 strike keeps the
  // market roughly balanced and resolves with non-trivial signal.
  const strike = nextRoundStrike(latest.value, 0.25);
  const strikeStr = strike.toFixed(2);

  return [{
    source: 'banxico',
    source_event_id: `fx:USDMXN:${endYmd}:${strikeStr}`,
    question: `USD/MXN cierre del viernes > $${strikeStr}`,
    category: 'finanzas',
    icon: '🇲🇽',
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1000,
    end_time: endIso,
    amm_mode: 'unified',
    resolver_type: 'api_price',
    resolver_config: {
      source: 'banxico-fix',
      seriesId: SERIES.FX_USD_MXN,
      threshold: strike,
      op: 'gt',
      yesOutcome: 0,
    },
    source_data: {
      pair: 'USD/MXN',
      seriesId: SERIES.FX_USD_MXN,
      seriesTitle: latest.title,
      spotAtGeneration: latest.value,
      spotFecha: latest.fecha,
      strike,
      endLabel: endEs,
    },
  }];
}
