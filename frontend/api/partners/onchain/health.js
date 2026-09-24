import { applyPartnerCors, withPartnerEnvelope } from '../../_lib/partner-onchain.js';

function has(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0;
}

export default async function handler(req, res) {
  const cors = applyPartnerCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  res.setHeader('Cache-Control', 'no-store, no-cache');
  return res.status(200).json(withPartnerEnvelope(req, {
    ok: true,
    status: 'available',
    dependencies: {
      database: has('DATABASE_URL') || has('DATABASE_READ_URL'),
      rpc: has('ONCHAIN_RPC_URL'),
      collateral: has('ONCHAIN_COLLATERAL_ADDRESS'),
      factoryV1: has('ONCHAIN_MARKET_FACTORY_ADDRESS'),
      factoryV2: has('ONCHAIN_MARKET_FACTORY_V2_ADDRESS'),
    },
  }));
}

