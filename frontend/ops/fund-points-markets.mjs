import { readFile, writeFile } from 'node:fs/promises';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { planPointsLiquidityRollout, applyPointsLiquidityRollout } from '../api/_lib/points-liquidity-rollout.js';

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const path = option('plan');
if (!path || !process.env.DATABASE_URL) throw new Error('Provide DATABASE_URL and --plan=/absolute/path.json. Dry run is the default.');
neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const transaction = async callback => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
};

try {
  if (!args.includes('--apply')) {
    const excludedMarketIds = (option('exclude') || '').split(',').filter(Boolean).map(Number);
    if (excludedMarketIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('invalid_excluded_market');
    const plan = await planPointsLiquidityRollout(pool, { excludedMarketIds });
    await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ dryRun: true, plan: path, inspectedPools: plan.inspectedPools,
      fundingPools: plan.entries.length, unchanged: plan.unchanged.length,
      excludedMarketIds: plan.excludedMarketIds, policy: plan.policy,
      totalCollateral: plan.totalCollateral, targets: plan.targets,
      byCategory: Object.fromEntries([...new Set(plan.entries.map(row => row.category))].map(category => [category, {
        pools: plan.entries.filter(row => row.category === category).length,
        collateral: plan.entries.filter(row => row.category === category).reduce((sum, row) => sum + row.amount, 0),
      }])) }));
  } else {
    const plan = JSON.parse(await readFile(path, 'utf8'));
    const results = await applyPointsLiquidityRollout(transaction, plan, {
      username: option('operator'), maxTotalCollateral: Number(option('max-total')),
      onResult: result => console.log(JSON.stringify(result)),
    });
    await writeFile(`${path}.results.json`, `${JSON.stringify(results, null, 2)}\n`);
    console.log(JSON.stringify({ complete: true, fundedPools: results.filter(row => !row.skipped).length,
      skippedPools: results.filter(row => row.skipped).length,
      newlyAddedCollateral: results.filter(row => !row.skipped && !row.replayed).reduce((sum, row) => sum + row.collateral, 0) }));
  }
} finally { await pool.end(); }
