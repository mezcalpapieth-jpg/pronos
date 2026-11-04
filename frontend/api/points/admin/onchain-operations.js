import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { rateLimit, clientIp } from '../../_lib/rate-limit.js';
import { collectOnchainOperations, onchainOperationsSettings } from '../../_lib/onchain-operations.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!requirePointsAdmin(req, res)) return;
  const settings = onchainOperationsSettings();
  if (!settings.enabled) return res.status(403).json({ error: 'onchain_operations_disabled' });
  if (!settings.configured) return res.status(503).json({ error: 'onchain_operations_unavailable' });
  if (Object.keys(req.query || {}).length) return res.status(400).json({ error: 'query_overrides_forbidden' });
  if (rateLimit(req, res, { key: `onchain-operations:${clientIp(req)}`, limit: 12, windowMs: 60000 })) return;
  try {
    // The durable ledger intentionally denies the generic reader and worker
    // roles. Use the preview application's connection with SELECT-only queries.
    const report = await collectOnchainOperations({ sql: neon(process.env.DATABASE_URL),
      provider: new ethers.providers.JsonRpcProvider({ url: process.env.ONCHAIN_RPC_URL, timeout: 5000 }) });
    return res.status(200).json(report);
  } catch {
    return res.status(503).json({ error: 'onchain_operations_unavailable' });
  }
}
