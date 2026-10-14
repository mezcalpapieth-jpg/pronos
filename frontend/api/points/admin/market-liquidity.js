import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { addPointsMarketFunding, previewPointsMarketFunding } from '../../_lib/points-market-funding.js';

export function createMarketLiquidityHandler({
  requireAdmin = requirePointsAdmin,
  transaction = withTransaction,
  ensureSchema = () => ensurePointsSchema(neon(process.env.DATABASE_URL)),
} = {}) {
  return async function handler(req, res) {
    const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
    const admin = requireAdmin(req, res);
    if (!admin) return;
    res.setHeader('Cache-Control', 'no-store');
    try {
      const input = req.method === 'GET' ? req.query : req.body;
      const marketId = Number(input?.marketId);
      if (!['number', 'string'].includes(typeof input?.marketId)
        || !Number.isSafeInteger(marketId) || marketId <= 0) return res.status(400).json({ error: 'invalid_market_id' });
      await ensureSchema();
      const result = await transaction(client => req.method === 'GET'
        ? previewPointsMarketFunding(client, { marketId, amount: input.amount ?? null })
        : addPointsMarketFunding(client, { marketId, amount: input.amount,
          expectedReserves: input.expectedReserves, requestId: input.requestId, username: admin.username }));
      return res.status(200).json(result);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status === 500) console.error('[admin/market-liquidity]', { message: error?.message, code: error?.code });
      return res.status(status).json({ error: status === 500 ? 'funding_failed' : error.message });
    }
  };
}

export default createMarketLiquidityHandler();
