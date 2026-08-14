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
import { formatMexicoDateEs, formatMexicoDateYmd } from './mexico-time.js';

const NEW_YORK_TZ = 'America/New_York';
const WEEKDAYS = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function nextRoundStrike(current, step) {
  return Math.ceil(current / step) * step;
}

function partsObject(formatter, date) {
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
}

function zonedDateParts(date, timeZone) {
  const parts = partsObject(new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }), date);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS[parts.weekday],
  };
}

function zonedDateTimeParts(date, timeZone) {
  const parts = partsObject(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }), date);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function dateAtTimeZoneTime({
  year,
  month,
  day,
  hour,
  minute,
  second = 0,
  timeZone,
}) {
  const targetLocalMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  let utcMs = targetLocalMs;
  for (let i = 0; i < 3; i += 1) {
    const represented = zonedDateTimeParts(new Date(utcMs), timeZone);
    const representedLocalMs = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
      0,
    );
    const delta = targetLocalMs - representedLocalMs;
    if (delta === 0) break;
    utcMs += delta;
  }
  return new Date(utcMs);
}

function addDaysToLocalDate({ year, month, day }, days) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function nextFridayStockCloseUtc(now = new Date()) {
  const local = zonedDateParts(now, NEW_YORK_TZ);
  const daysAhead = ((5 - local.weekday + 7) % 7) || 7;
  const target = addDaysToLocalDate(local, daysAhead);
  // US equities close at 4:00 p.m. New York time. We stop entries one
  // minute before and let the next resolver pass read Finnhub's final quote.
  return dateAtTimeZoneTime({
    ...target,
    hour: 15,
    minute: 59,
    second: 0,
    timeZone: NEW_YORK_TZ,
  });
}

export async function generateStockMarkets() {
  if (!process.env.FINNHUB_API_KEY) {
    console.warn('[market-gen/stocks] FINNHUB_API_KEY not set — skipping');
    return [];
  }

  const specs = [];
  const end = nextFridayStockCloseUtc();
  const endIso = end.toISOString();
  const endYmd = formatMexicoDateYmd(end);
  const endEs = formatMexicoDateEs(end);

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
