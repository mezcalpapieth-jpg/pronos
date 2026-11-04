import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { rateLimit, clientIp } from '../../_lib/rate-limit.js';
import { onchainOperationsSettings } from '../../_lib/onchain-operations.js';
import { collectOnchainTransactions, transactionFilters } from '../../_lib/onchain-transactions.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  const cors=applyCors(req,res,{ methods:'GET, OPTIONS',credentials:true });
  if (cors) return cors;
  if (req.method!=='GET') return res.status(405).json({ error:'method_not_allowed' });
  if (!requirePointsAdmin(req,res)) return;
  const settings=onchainOperationsSettings();
  if (!settings.enabled) return res.status(403).json({ error:'onchain_transactions_disabled' });
  if (!settings.configured) return res.status(503).json({ error:'onchain_transactions_unavailable' });
  if (rateLimit(req,res,{ key:`onchain-transactions:${clientIp(req)}`,limit:30,windowMs:60000 })) return;
  try {
    transactionFilters(req.query);
    const report=await collectOnchainTransactions({ sql:neon(process.env.DATABASE_URL,
      { fetchOptions:{ signal:AbortSignal.timeout(8000) } }),query:req.query });
    return res.status(200).json(report);
  } catch(error) {
    return res.status(error.status===400 ? 400 : 503).json({ error:error.status===400 ? 'invalid_transaction_filters' : 'onchain_transactions_unavailable' });
  }
}
