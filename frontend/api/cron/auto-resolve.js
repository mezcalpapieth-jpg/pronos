/**
 * @deprecated DO NOT USE — Polymarket-mirror resolver removed.
 *
 * This cron used to query Polymarket Gamma to resolve legacy
 * `generated_markets` rows that had a `_polyId` or `_conditionId`.
 * As of 2026-05-06 there are zero approved rows in that table and
 * Pronos no longer mirrors Polymarket markets.
 *
 * The Vercel cron entry was removed too (see vercel.json) — this
 * handler is kept as a 410 Gone responder so any stale call (e.g.
 * a manual hit from an old admin tool, or a paused Vercel cron that
 * gets reactivated by mistake) returns a clear "this is gone" signal
 * instead of pinging Polymarket again.
 *
 * Active resolvers:
 *   - /api/cron/points-auto-resolve   sports_api / chainlink / api_price
 *   - manual admin resolve            via /api/points/admin/resolve-market
 *
 * When the legacy /mvp UI is fully migrated or removed, delete this
 * file along with the other Polymarket stubs (lib/gamma.js, etc.).
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(410).json({
    error: 'gone',
    message: 'Polymarket-mirror auto-resolve removed. Use points-auto-resolve or manual admin resolve.',
  });
}
