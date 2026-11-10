import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { rateLimit, clientIp } from '../../_lib/rate-limit.js';
import { accountingContext, accountingSettings, accountingSummary } from '../../_lib/onchain-accounting.js';
import { accountingMovements, accountingQuery } from '../../_lib/onchain-accounting-movements.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!requirePointsAdmin(req, res)) return;
  const settings = accountingSettings();
  if (!settings.enabled) return res.status(403).json({ error: 'onchain_accounting_disabled' });
  if (!settings.configured) return res.status(503).json({ error: 'onchain_accounting_unavailable' });
  if (rateLimit(req, res, { key: 'onchain-accounting:' + clientIp(req), limit: 30, windowMs: 60000 })) return;
  try {
    const query = accountingQuery(req.query);
    const provider = new ethers.providers.JsonRpcProvider({ url: process.env.ONCHAIN_RPC_URL, timeout: 5000, throttleLimit: 1 });
    const sql = neon(process.env.DATABASE_URL, { fetchOptions: { signal: AbortSignal.timeout(6000) } });
    const context = await accountingContext({ sql, provider, settings, snapshotBlock: query.snapshotBlock, marketBefore: query.marketBefore });
    const report = query.kind === 'summary' ? await accountingSummary(context, Boolean(settings.explorerKey))
      : await accountingMovements(context, query, settings.explorerKey);
    return res.status(200).json(report);
  } catch (error) {
    return res.status(error.status === 400 ? 400 : 503).json({
      error: error.status === 400 ? 'invalid_accounting_query' : 'onchain_accounting_unavailable',
    });
  }
}
