import { applyCors } from '../_lib/cors.js';
import { readEspnLiveScore } from '../_lib/espn-live-score.js';

const LEAGUE_PATH_RE = /^[a-z0-9.-]+\/[a-z0-9.-]+$/i;

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: false });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const source = String(req.query.source || 'espn');
  const leaguePath = String(req.query.leaguePath || '');
  const eventId = String(req.query.eventId || '');
  const dateYmd = req.query.dateYmd ? String(req.query.dateYmd) : null;

  if (source !== 'espn') return res.status(400).json({ error: 'unsupported_source' });
  if (!LEAGUE_PATH_RE.test(leaguePath) || !eventId) {
    return res.status(400).json({ error: 'invalid_event_lookup' });
  }

  try {
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
    const liveScore = await readEspnLiveScore({ leaguePath, eventId, dateYmd });
    return res.status(200).json({ liveScore });
  } catch (e) {
    console.error('[sports/live-score] ESPN lookup failed', {
      message: e?.message,
      leaguePath,
      eventId,
    });
    return res.status(502).json({
      error: 'live_score_unavailable',
      detail: e?.message?.slice(0, 180) || null,
    });
  }
}
