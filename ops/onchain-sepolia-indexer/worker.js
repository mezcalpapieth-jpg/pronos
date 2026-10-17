import { randomUUID, timingSafeEqual } from 'node:crypto';

const factories = [
  '0xb6cf9f65ab82c17c8e9d58d06073ca3af3e5443d',
  '0x33c1cdd4e22a9732ad808f2ad7efe82211b65c6a',
];
// Historical factories keep their own checkpoints for remaining redemptions.
const legacyFactories = [
  '0x69440742a168635d9fa7cc0cfb0935afffe79ad3',
  '0xfcac9cfcf22df809ba365c85dd767c90bb260fd6',
];
export function validateWorker(env, source) {
  const db = new URL(env.DATABASE_URL);
  if (env.VERCEL_ENV !== 'production'
    || !env.PREVIEW_INDEXER_PROJECT_ID || env.VERCEL_PROJECT_ID !== env.PREVIEW_INDEXER_PROJECT_ID
    || source.branch !== 'onchain-sepolia' || !/^[a-f0-9]{40}$/.test(source.sha)
    || Number(env.CHAIN_ID) !== 421614 || Number(env.PROTOCOL_CHAIN_ID) !== 421614
    || String(env.FACTORY_ADDRESS).toLowerCase() !== factories[0]
    || String(env.FACTORY_V2_ADDRESS).toLowerCase() !== factories[1]
    || (env.ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS && env.ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS.toLowerCase() !== legacyFactories[0])
    || (env.ONCHAIN_LEGACY_MARKET_FACTORY_V2_ADDRESS && env.ONCHAIN_LEGACY_MARKET_FACTORY_V2_ADDRESS.toLowerCase() !== legacyFactories[1])
    || !/^ep-delicate-glitter-amp7yrkv(-pooler)?\.c-5\.us-east-1\.aws\.neon\.tech$/.test(db.hostname)
    || decodeURIComponent(db.username) !== 'sepolia_indexer'
    || !env.CRON_SECRET || env.CRON_SECRET.length < 32
    || Object.keys(env).some(key => /PRIVATE_KEY|TURNKEY|CRON_SECRET_MAIN/.test(key))) {
    throw Error('Sepolia indexer isolation check failed');
  }
}
function authorized(header, secret) {
  const actual = Buffer.from(header || ''), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createWorker({ env, source, sql, chainId, index, now = () => Date.now() }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    if (!authorized(req.headers.authorization, env.CRON_SECRET)) return res.status(401).json({ error: 'unauthorized' });
    const id = randomUUID();
    let acquired = false, recorded = false;
    try {
      validateWorker(env, source);
      if (await chainId() !== 421614) throw Error('RPC must be Arbitrum Sepolia');
      const lease = await sql`
        INSERT INTO preview_indexer_lease (name, owner, expires_at)
        VALUES ('onchain-sepolia', ${id}::uuid, NOW() + INTERVAL '330 seconds')
        ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
        WHERE preview_indexer_lease.expires_at < NOW()
        RETURNING owner
      `;
      if (!lease.length) return res.status(200).json({ status: 'skipped', reason: 'already_running' });
      acquired = true;
      const trigger = req.headers['x-vercel-cron-schedule'] === '* * * * *'
        && String(req.headers['user-agent']).startsWith('vercel-cron/') ? 'cron' : 'manual';
      await sql`
        INSERT INTO preview_indexer_runs (id, source_sha, trigger, status, started_at)
        VALUES (${id}::uuid, ${source.sha}, ${trigger}, 'running', NOW())
      `;
      recorded = true;
      const started = now();
      const result = await index();
      if (result.status !== 'ok') throw Error('Protocol indexer did not complete');
      const report = { ...result, durationMs: now() - started, protocolOnly: true };
      await sql`
        UPDATE preview_indexer_runs SET status = 'ok', completed_at = NOW(), report = ${JSON.stringify(report)}::jsonb
        WHERE id = ${id}::uuid
      `;
      return res.status(200).json({ id, status: 'ok', ...report });
    } catch (error) {
      // Store a generic error; provider/driver errors can contain connection details.
      console.error('[sepolia-indexer]', { runId: id, failed: true });
      if (recorded) await sql`
        UPDATE preview_indexer_runs SET status = 'error', completed_at = NOW(), report = '{"error":"indexer_failed"}'::jsonb
        WHERE id = ${id}::uuid
      `.catch(() => {});
      return res.status(500).json({ error: 'indexer_failed', runId: id });
    } finally {
      if (acquired) await sql`
        UPDATE preview_indexer_lease SET expires_at = NOW() WHERE name = 'onchain-sepolia' AND owner = ${id}::uuid
      `.catch(() => {});
    }
  };
}
