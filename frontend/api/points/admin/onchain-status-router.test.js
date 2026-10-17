import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('./onchain-status.js', import.meta.url), 'utf8');
async function status({ configured = false, verified = true, gasEnabled = false, gasReady = false } = {}) {
  const bindings = {
    applyCors: () => false, requirePointsAdmin: () => ({ username: 'admin' }),
    readProtocolPoolAddresses: async () => ({ pools: [] }),
    collectOnchainReadiness: () => ({ env: { rpc: true }, warnings: [], gas: { autoFunding: { enabled: gasEnabled, configured: false } },
      launch: { ready: true, blockers: [], blockerCount: 0, nextSteps: [], reviews: [{ id: 'gas_auto_funding_unverified' }] } }),
    probeGasFunding: async () => ({ enabled: true, ready: gasReady }),
    ethers: { providers: { JsonRpcProvider: class {} } },
    probeFactory: async () => ({ reachable: true }), appendFactoryProbeWarnings() {},
    process: { env: configured ? { ONCHAIN_TRADING_ROUTER_ADDRESS: 'configured' } : {} },
    verifyTradingRouter: async () => { if (!verified) throw Error('runtime mismatch'); return { address: 'verified-router' }; },
    console: { error() {} },
  };
  const handler = new Function(...Object.keys(bindings), source.slice(source.indexOf('export default')).replace('export default', 'return'))(...Object.values(bindings));
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await handler({ method: 'GET' }, res);
  return res;
}
test('optional router does not change direct-market readiness; verified configuration exposes router scope', async () => {
  const direct = await status();
  assert.equal(direct.data.ok, true); assert.equal(direct.data.tradingAuthorization.scope, 'pools');
  const routed = await status({ configured: true });
  assert.equal(routed.data.ok, true); assert.equal(routed.data.tradingAuthorization.verified, true);
  assert.equal(routed.data.tradingAuthorization.scope, 'router');
});
test('a configured router with wrong code or bindings blocks readiness with an explicit fix', async () => {
  const failed = await status({ configured: true, verified: false });
  assert.equal(failed.code, 200); assert.equal(failed.data.ok, false);
  assert.equal(failed.data.launch.ready, false); assert.equal(failed.data.launch.blockerCount, 1);
  assert.equal(failed.data.launch.blockers[0].id, 'trading_router_unverified');
  assert.equal(typeof failed.data.launch.nextSteps[0], 'string');
  assert.equal(failed.data.tradingAuthorization.verified, false);
});
test('enabled but unready gas funding blocks launch; confirmed funding removes the configuration-only review', async () => {
  const pending = await status({ gasEnabled: true });
  assert.equal(pending.code, 200); assert.equal(pending.data.ok, false);
  assert.equal(pending.data.launch.ready, false);
  assert.equal(pending.data.launch.blockers[0].id, 'gas_auto_funding_unready');
  const ready = await status({ gasEnabled: true, gasReady: true });
  assert.equal(ready.data.ok, true); assert.equal(ready.data.gas.autoFunding.ready, true);
  assert.equal(ready.data.launch.reviews.length, 0);
});
