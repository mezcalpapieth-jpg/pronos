import { neon } from '@neondatabase/serverless';
import { FESTIVAL_MINUTE } from '../../shared/trading-festival.js';
import { applyCors } from '../_lib/cors.js';
import { clientIp, rateLimit } from '../_lib/rate-limit.js';
import { festivalChartRange, festivalFeedEnabled, festivalSchedule, readFestivalBars } from '../_lib/trading-festival-feed.js';
import { festivalMarketMeta, readFestivalMarkets } from '../_lib/trading-festival.js';

function setCache(res, seconds) {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${seconds}`);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (rateLimit(req, res, { key: `festival:${clientIp(req)}`, limit: 240, windowMs: FESTIVAL_MINUTE })) return;

  const slots = festivalSchedule();
  if (req.query.slot !== undefined) {
    const slot = slots.find(item => item.key === req.query.slot);
    if (!slot) return res.status(400).json({ error: 'invalid_slot' });
    if (!festivalFeedEnabled(slot)) {
      setCache(res, 15);
      return res.status(200).json({ status: 'unavailable', bars: [] });
    }
    try {
      const now = Date.now();
      const { from, to } = festivalChartRange(slot, now);
      const bars = await readFestivalBars(slot, { from, to });
      setCache(res, now >= Date.parse(slot.endTime) + 15 * FESTIVAL_MINUTE ? 300 : 12);
      return res.status(200).json({ status: 'ok', bars });
    } catch {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: 'festival_feed_unavailable' });
    }
  }

  try {
    // The same primary used by the minute cron keeps short windows responsive.
    const rows = await readFestivalMarkets(neon(process.env.DATABASE_URL));
    const byKey = new Map(rows.map(row => [row.source_event_id, row]));
    setCache(res, 5);
    return res.status(200).json({
      slots: slots.map(slot => {
        const feedEnabled = festivalFeedEnabled(slot);
        const row = byKey.get(slot.key);
        const meta = row && festivalMarketMeta(row);
        const market = meta ? {
          id: row.id,
          status: row.status,
          outcome: row.outcome,
          threshold: meta.threshold,
          closePrice: meta.closePrice,
        } : null;
        // Once a market has opened, show its stored times even if the
        // provisional schedule is subsequently changed.
        return market && row.status !== 'pending'
          ? { ...slot, feedEnabled, startTime: row.start_time, endTime: row.end_time, requiresReschedule: false, market }
          : { ...slot, feedEnabled, market };
      }),
    });
  } catch (error) {
    console.error('[trading-festival] schedule failed', { message: error.message });
    return res.status(503).json({ error: 'festival_schedule_unavailable' });
  }
}
