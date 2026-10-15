import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { updateOfficialContracts } from '../../_lib/official-contract-upgrade.js';

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  const admin = requirePointsAdmin(req, res);
  if (!admin) return;
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'POST' && !req.body?.planHash) return res.status(400).json({ error: 'preview_required' });
    const result = await withTransaction(client => updateOfficialContracts(client, {
      apply: req.method === 'POST', expectedPlanHash: req.body?.planHash, actor: admin.username,
    }));
    return res.status(200).json(result);
  } catch (e) { return res.status(e.status || 500).json({ error: e.status ? e.message : 'official_contract_upgrade_failed' }); }
}
