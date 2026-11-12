import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { recordFestivalChartBar } from '../../_lib/trading-festival.js';

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;
  if (process.env.VERCEL_ENV !== 'production' || process.env.TRADING_FESTIVAL_ENABLED !== '1') {
    return res.status(409).json({ error: 'festival_resolution_disabled' });
  }

  const { key, symbol, barStart, price } = req.body || {};
  try {
    const result = await recordFestivalChartBar({ key, symbol, barStart, price, actor: admin.username });
    return res.status(200).json(result);
  } catch (error) {
    if (error.status === 400 || error.status === 409) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[trading-festival] chart settlement failed', { message: error.message });
    return res.status(500).json({ error: 'festival_chart_settlement_failed' });
  }
}
