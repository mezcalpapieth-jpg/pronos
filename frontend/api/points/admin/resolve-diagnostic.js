/**
 * GET /api/points/admin/resolve-diagnostic
 *
 * Read-only report on the current state of auto-resolvable markets.
 * Answers "why haven't my markets resolved yet?" without having to
 * read Vercel function logs.
 *
 * Groups active markets into buckets:
 *   - resolvable       — resolver_type set, end_time in the past.
 *                        These are candidates the cron SHOULD pick
 *                        up on its next tick (every 15 min).
 *   - waitingWindow    — resolver_type set but end_time still in the
 *                        future. Normal; trading's still open.
 *   - missingResolver  — resolver_type IS NULL. These will NEVER
 *                        auto-resolve until retrofit runs.
 *   - manual           — resolver_type = 'manual'. Admin resolves.
 *
 * Admin-only.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

const sql = neon(process.env.DATABASE_URL);
const readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

function parseJsonb(v, fb) {
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    await ensurePointsSchema(sql);

    const rows = await readSql`
      SELECT id, question, category, status, resolver_type, resolver_config,
             start_time, end_time,
             EXTRACT(EPOCH FROM (NOW() - end_time))::int AS seconds_past_end
      FROM points_markets
      WHERE status = 'active'
        AND parent_id IS NULL
      ORDER BY end_time ASC NULLS LAST
      LIMIT 500
    `;

    const resolvable = [];
    const waitingWindow = [];
    const missingResolver = [];
    const manual = [];

    const AUTO_RESOLVER_TYPES = new Set([
      'chainlink_price', 'api_price', 'weather_api', 'api_chart', 'sports_api',
    ]);

    for (const r of rows) {
      const cfg = parseJsonb(r.resolver_config, null);
      const entry = {
        id: r.id,
        question: r.question,
        category: r.category,
        resolverType: r.resolver_type,
        resolverSource: cfg?.source || null,
        startTime: r.start_time,
        endTime: r.end_time,
        secondsPastEnd: r.seconds_past_end,
      };
      const pastEnd = Number(r.seconds_past_end || 0) > 0;

      if (r.resolver_type === 'manual') {
        manual.push(entry);
      } else if (!r.resolver_type) {
        missingResolver.push(entry);
      } else if (!AUTO_RESOLVER_TYPES.has(r.resolver_type)) {
        // Unknown resolver type — treat as manual-ish but flag it.
        manual.push({ ...entry, warning: `unknown resolver_type=${r.resolver_type}` });
      } else if (pastEnd) {
        resolvable.push(entry);
      } else {
        waitingWindow.push(entry);
      }
    }

    return res.status(200).json({
      ok: true,
      totalActive: rows.length,
      summary: {
        resolvable: resolvable.length,
        waitingWindow: waitingWindow.length,
        missingResolver: missingResolver.length,
        manual: manual.length,
      },
      // resolvable.length > 0 means the cron SHOULD be picking these
      // up. If it isn't, check Vercel cron logs. Often it means the
      // sports API says `completed=false` (benign skip).
      resolvable,
      // Most common cause of "my market hasn't resolved" — retrofit
      // needs to run to set resolver_type.
      missingResolver: missingResolver.slice(0, 50),
      waitingWindow: waitingWindow.slice(0, 20),
      manual: manual.slice(0, 20),
    });
  } catch (e) {
    console.error('[admin/resolve-diagnostic] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'diagnostic_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
