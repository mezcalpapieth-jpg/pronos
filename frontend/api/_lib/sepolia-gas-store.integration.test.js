import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { SEPOLIA_GAS_SCHEMA, sepoliaGasStore } from './sepolia-gas-store.js';
import { sepoliaGasSettings } from './sepolia-gas-config.js';

// Optional local PostgreSQL/WASM engine, installed outside the app. No preview
// or production connection is accepted by this test.
const modulePath = process.env.SEPOLIA_GAS_TEST_PGLITE;
test('PostgreSQL funding ledger: leases, fencing, crash recovery and rolling budgets', { skip: !modulePath }, async t => {
  const { PGlite } = await import(modulePath);
  const db = new PGlite();
  const sql = async (strings, ...values) => (await db.query(strings.reduce((text, s, i) => `${text}${i ? `$${i}` : ''}${s}`, ''), values)).rows;
  try {
    for (const ddl of SEPOLIA_GAS_SCHEMA) await db.exec(ddl);
    const store = sepoliaGasStore(sql), funder = `0x${'1'.repeat(40)}`;
    const config = sepoliaGasSettings();
    let sequence = 0;
    const entry = (overrides = {}) => ({ tx_hash: `hash-${++sequence}`, funder_address: funder,
      wallet_address: `0x${'2'.repeat(40)}`, suborg_id: 'user', signer_key_hash: 'key',
      amount_wei: ethers.utils.parseEther('0.0005').toString(),
      max_cost_wei: ethers.utils.parseEther('0.00051').toString(), nonce: sequence, signed_tx: 'persisted-payload', ...overrides });
    const reset = () => db.exec('TRUNCATE sepolia_gas_lock, sepolia_gas_transfers');
    const age = () => db.exec("UPDATE sepolia_gas_transfers SET created_at = now() - interval '6 minutes'");

    await t.test('only one overlapping claimant acquires the chain-wide funding lease', async () => {
      const a = randomUUID(), b = randomUUID();
      const results = await Promise.all([store.acquire(funder, a), store.acquire(funder, b)]);
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await store.acquire('other-funder', randomUUID()), false);
      await store.release(results[0] ? a : b);
      assert.equal(await store.acquire(funder, randomUUID()), true);
    });
    await t.test('expired workers cannot persist or release a successor lease', async () => {
      await reset(); const old = randomUUID(), next = randomUUID();
      await store.acquire(funder, old);
      await db.exec("UPDATE sepolia_gas_lock SET lease_until = now() - interval '1 second'");
      assert.equal(await store.acquire(funder, next), true);
      assert.equal(await store.prepare(entry(), old, config), false);
      await store.release(old);
      assert.equal(await store.acquire(funder, randomUUID()), false);
      assert.equal(await store.prepare(entry(), next, config), true);
    });
    await t.test('an unresolved signature survives a lease expiry and blocks every second payment', async () => {
      await reset(); const token = randomUUID(); await store.acquire(funder, token);
      const first = entry(); assert.equal(await store.prepare(first, token, config), true);
      assert.equal((await store.pending()).signed_tx, first.signed_tx);
      assert.equal(await store.prepare(entry({ wallet_address: 'someone-else' }), token, config), false);
      await store.release(token); const next = randomUUID(); await store.acquire(funder, next);
      assert.equal((await store.pending()).tx_hash, first.tx_hash);
      await store.settle(first.tx_hash, 'confirmed'); assert.equal(await store.pending(), undefined);
    });
    await t.test('cooldown and wallet/suborg limits are enforced even across changed account mappings', async () => {
      await reset(); const token = randomUUID(); await store.acquire(funder, token);
      for (let i = 0; i < 4; i++) {
        const e = entry(); assert.equal(await store.prepare(e, token, config), true);
        await store.settle(e.tx_hash, 'confirmed');
        assert.equal(await store.prepare(entry(), token, config), false);
        await age();
      }
      assert.equal(await store.prepare(entry(), token, config), false);
      assert.equal(await store.prepare(entry({ wallet_address: 'new-wallet' }), token, config), false);
      assert.equal(await store.prepare(entry({ suborg_id: 'new-suborg' }), token, config), false);
      await db.exec("UPDATE sepolia_gas_transfers SET created_at = now() - interval '25 hours'");
      assert.equal(await store.prepare(entry(), token, config), true);
    });
    await t.test('global limit includes transaction fee ceilings and reverted transfers conservatively', async () => {
      await reset(); const token = randomUUID(); await store.acquire(funder, token);
      const e = entry(); assert.equal(await store.prepare(e, token, config), true);
      await store.settle(e.tx_hash, 'reverted'); await age();
      const remaining = ethers.BigNumber.from(e.max_cost_wei).add(ethers.BigNumber.from(e.amount_wei));
      const tiny = { ...config, globalDaily: remaining }; // Amount fits; fee ceiling makes it exceed.
      assert.equal(await store.prepare(entry({ wallet_address: 'other', suborg_id: 'other' }), token, tiny), false);
    });
    await t.test('starter lifetime allowance cannot be refreshed by waiting or changing one identity',async()=>{
      await reset();const token=randomUUID();await store.acquire(funder,token);
      for(let i=0;i<4;i++) {
        const e=entry({starter:true,amount_wei:ethers.utils.parseEther('0.00005').toString(),max_cost_wei:ethers.utils.parseEther('0.00006').toString()});
        assert.equal(await store.prepare(e,token,config),true);await store.settle(e.tx_hash,'confirmed');await age();
      }
      await db.exec("UPDATE sepolia_gas_transfers SET created_at=now()-interval '30 days'");
      const small={starter:true,amount_wei:'1',max_cost_wei:'2'};
      for(const change of [{},{wallet_address:'new-wallet'},{suborg_id:'new-org'}]) assert.equal(await store.prepare(entry({...small,...change}),token,config),false);
      assert.equal(await store.prepare(entry(),token,config),true,'confirmed activity lifts only the starter lifetime cap');
    });
    await t.test('database constraints reject a second pending record and oversized transfers', async () => {
      await reset(); const token = randomUUID(); await store.acquire(funder, token);
      const e = entry(); assert.equal(await store.prepare(e, token, config), true);
      await assert.rejects(db.exec("INSERT INTO sepolia_gas_transfers SELECT 'second-hash', chain_id, funder_address, wallet_address, suborg_id, signer_key_hash, amount_wei, max_cost_wei, nonce + 1, signed_tx, status, created_at, confirmed_at FROM sepolia_gas_transfers"), /unique/i);
      await store.settle(e.tx_hash, 'confirmed'); await age();
      await assert.rejects(store.prepare(entry({ amount_wei: ethers.utils.parseEther('0.0006').toString(),
        max_cost_wei: ethers.utils.parseEther('0.00061').toString() }), token, config), /check/i);
    });
  } finally { await db.close(); }
});
