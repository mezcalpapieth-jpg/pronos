/**
 * Gasoline price market generator (Mexico, monthly).
 *
 * Reads the current national-average retail price for each fuel type
 * from CRE's public XML dump, rounds up to a $0.50 strike, and
 * proposes one binary over/under per fuel type per month:
 *   "Gasolina Regular cierre de abril > $24.00"
 *
 * resolver_type='api_price', resolver_config.source='cre-gasolina'.
 * The auto-resolver re-reads the average at close (23:59 Mexico City
 * on the last day of the month) and compares to the stored threshold.
 *
 * Idempotent across re-runs within the same month because
 * source_event_id encodes fuel type + month + strike.
 */
import { readCreAverages, FUEL_TYPES, fuelLabel } from '../fuel.js';
import { endOfMexicoMonthClose, mexicoMonthKey, mexicoMonthNameEs } from './mexico-time.js';

function nextRoundStrike(current, step) {
  return Math.ceil(current / step) * step;
}

export async function generateFuelMarkets() {
  let averages;
  try {
    averages = await readCreAverages();
  } catch (e) {
    console.error('[market-gen/fuel] CRE read failed', { message: e?.message });
    return [];
  }

  const end = endOfMexicoMonthClose();
  const endIso = end.toISOString();
  const month = mexicoMonthNameEs(end);
  const mKey = mexicoMonthKey(end);

  const specs = [];
  for (const fuelType of FUEL_TYPES) {
    const avg = averages[fuelType];
    if (!Number.isFinite(avg) || avg <= 0) {
      console.warn('[market-gen/fuel] no average for', fuelType);
      continue;
    }
    // $0.50 strikes — gasoline moves 1–3% per month in typical conditions;
    // finer granularity would land too close to spot and resolve on noise.
    const strike = nextRoundStrike(avg, 0.5);
    const strikeStr = strike.toFixed(2);
    const label = fuelLabel(fuelType);

    specs.push({
      source: 'cre',
      source_event_id: `fuel:${fuelType}:${mKey}:${strikeStr}`,
      question: `${label} promedio nacional cierre de ${month} > $${strikeStr}`,
      category: 'finanzas',
      icon: '⛽',
      outcomes: ['Sí', 'No'],
      seed_liquidity: 1000,
      end_time: endIso,
      amm_mode: 'unified',
      resolver_type: 'api_price',
      resolver_config: {
        source: 'cre-gasolina',
        fuelType,
        threshold: strike,
        op: 'gt',
        yesOutcome: 0,
      },
      source_data: {
        fuelType,
        fuelLabel: label,
        spotAtGeneration: avg,
        sampleSize: averages.sampleSize?.[fuelType] ?? null,
        strike,
        month: mKey,
      },
    });
  }
  return specs;
}
