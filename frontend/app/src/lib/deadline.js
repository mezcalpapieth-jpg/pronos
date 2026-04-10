// ─── DEADLINE HELPERS ──────────────────────────────────────────────────────
// Parse Spanish-formatted deadline strings ("3 Abr 2026", "15 Ene 2027") and
// determine whether a market has passed its resolution date. Used both by
// MarketsGrid (to hide expired markets client-side) and the auto-resolve cron.

const MONTHS_ES = {
  ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5,
  jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11,
};

/**
 * Parse a deadline string into a Date at end-of-day UTC.
 * Accepts:
 *   "3 Abr 2026"         (Spanish short)
 *   "15 Enero 2026"      (Spanish long)
 *   "2026-04-03T23:59Z"  (ISO)
 * Returns null when the string can't be parsed.
 */
export function parseDeadline(input) {
  if (!input) return null;
  const s = String(input).trim();
  // ISO fast path
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  // "3 Abr 2026" / "15 Enero 2027"
  const m = s.match(/^(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]{3,})\.?\s+(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthKey = m[2].toLowerCase().slice(0, 3);
  const month = MONTHS_ES[monthKey];
  const year = parseInt(m[3], 10);
  if (month == null || isNaN(day) || isNaN(year)) return null;
  // End of day UTC so a market labelled "1 Abr 2026" counts as open all day
  return new Date(Date.UTC(year, month, day, 23, 59, 59));
}

/**
 * Resolve a market's end date. Prefers the ISO `_endDate` field set by
 * gmNormalize, otherwise falls back to parsing the human `deadline` string.
 */
export function resolveEndDate(market) {
  if (!market) return null;
  if (market._endDate) {
    const d = new Date(market._endDate);
    if (!isNaN(d)) return d;
  }
  return parseDeadline(market.deadline);
}

/**
 * True when the market's deadline is in the past. Markets already resolved
 * via market_resolutions return false (they're not "expired", they're closed).
 */
export function isExpired(market, now = Date.now()) {
  if (market?._resolved) return false;
  const d = resolveEndDate(market);
  if (!d) return false;
  return d.getTime() < now;
}
