/**
 * FX market generator.
 *
 * Reads the latest Banxico FIX rate for USD/MXN plus Frankfurter rates
 * for other peso crosses, rounds up to a neat strike, and proposes
 * weekly binary markets:
 *   "USD/MXN cierre del viernes > $X.XX"
 *
 * resolver_type='api_price' lets the auto-resolver re-read the same
 * source at close time.
 *
 * Idempotent across re-runs within the same week because source_event_id
 * is namespaced by the Friday-of-week date + strike.
 */
import { BANXICO_FIX_RESOLUTION_CRITERIA, readBanxicoLatest, SERIES } from '../banxico.js';
import {
  FRANKFURTER_RESOLUTION_CRITERIA,
  FRANKFURTER_SOURCE,
  readFrankfurterRate,
} from '../frankfurter.js';
import { formatMexicoDateEs, formatMexicoDateYmd, nextMexicoFridayClose } from './mexico-time.js';

function nextRoundStrike(current, step) {
  return Math.ceil(current / step) * step;
}

const CROSS_FX_PAIRS = Object.freeze([
  { base: 'EUR', quote: 'MXN', step: 0.25, decimals: 2, icon: '€' },
  { base: 'JPY', quote: 'MXN', step: 0.005, decimals: 3, icon: '¥' },
  { base: 'CHF', quote: 'MXN', step: 0.25, decimals: 2, icon: '₣' },
  { base: 'GBP', quote: 'MXN', step: 0.25, decimals: 2, icon: '£' },
  { base: 'CAD', quote: 'MXN', step: 0.10, decimals: 2, icon: 'C$' },
  { base: 'BRL', quote: 'MXN', step: 0.05, decimals: 2, icon: 'R$' },
]);

async function generateBanxicoUsdMxnMarket({ endIso, endYmd, endEs }) {
  let latest;
  try {
    latest = await readBanxicoLatest(SERIES.FX_USD_MXN);
  } catch (e) {
    console.error('[market-gen/fx] banxico read failed', { message: e?.message });
    return [];
  }
  if (!Number.isFinite(latest?.value) || latest.value <= 0) return [];

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
      resolveDateYmd: endYmd,
      criteria: BANXICO_FIX_RESOLUTION_CRITERIA,
      rationale: BANXICO_FIX_RESOLUTION_CRITERIA,
    },
    source_data: {
      pair: 'USD/MXN',
      seriesId: SERIES.FX_USD_MXN,
      seriesTitle: latest.title,
      spotAtGeneration: latest.value,
      spotFecha: latest.fecha,
      strike,
      resolveDateYmd: endYmd,
      endLabel: endEs,
      resolutionCriteria: BANXICO_FIX_RESOLUTION_CRITERIA,
    },
  }];
}

async function generateFrankfurterMxnCrossMarkets({ endIso, endYmd, endEs }) {
  const specs = [];
  for (const pair of CROSS_FX_PAIRS) {
    let latest;
    try {
      latest = await readFrankfurterRate(pair);
    } catch (e) {
      console.error('[market-gen/fx] frankfurter read failed', {
        pair: `${pair.base}/${pair.quote}`,
        message: e?.message,
      });
      continue;
    }
    if (!Number.isFinite(latest?.value) || latest.value <= 0) continue;

    const strike = nextRoundStrike(latest.value, pair.step);
    const strikeStr = strike.toFixed(pair.decimals);
    const label = `${pair.base}/${pair.quote}`;
    const criteria = `${FRANKFURTER_RESOLUTION_CRITERIA} Par: ${label}.`;

    specs.push({
      source: FRANKFURTER_SOURCE,
      source_event_id: `fx:${pair.base}${pair.quote}:${endYmd}:${strikeStr}`,
      question: `${label} cierre del viernes > $${strikeStr}`,
      category: 'finanzas',
      icon: pair.icon,
      outcomes: ['Sí', 'No'],
      seed_liquidity: 1000,
      end_time: endIso,
      amm_mode: 'unified',
      resolver_type: 'api_price',
      resolver_config: {
        source: FRANKFURTER_SOURCE,
        base: pair.base,
        quote: pair.quote,
        pair: label,
        threshold: strike,
        op: 'gt',
        yesOutcome: 0,
        resolveDateYmd: endYmd,
        criteria,
        rationale: criteria,
      },
      source_data: {
        pair: label,
        base: pair.base,
        quote: pair.quote,
        sourceTitle: latest.title,
        spotAtGeneration: latest.value,
        spotFecha: latest.date,
        strike,
        step: pair.step,
        resolveDateYmd: endYmd,
        endLabel: endEs,
        resolutionCriteria: criteria,
      },
    });
  }
  return specs;
}

export async function generateFxMarkets() {
  const end = nextMexicoFridayClose();
  const endIso = end.toISOString();
  const endYmd = formatMexicoDateYmd(end);
  const endEs  = formatMexicoDateEs(end);
  const specs = [];

  if (!process.env.BANXICO_API_TOKEN) {
    console.warn('[market-gen/fx] BANXICO_API_TOKEN not set — skipping USD/MXN');
  } else {
    specs.push(...await generateBanxicoUsdMxnMarket({ endIso, endYmd, endEs }));
  }

  specs.push(...await generateFrankfurterMxnCrossMarkets({ endIso, endYmd, endEs }));
  return specs;
}
