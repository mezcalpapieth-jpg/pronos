import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { buildTournamentPlan, normalizeDeployment, planHash, requireTournamentPreview,
  tournamentRuntimeEnv, validateTournamentPlan, verifyTournamentDeployment, MINT_ABI } from './sepolia-tournament.js';
import { SEPOLIA_TOURNAMENT_SCHEMA, tournamentStore } from './sepolia-tournament-store.js';
import { fundTournamentBatch, verifyMintReceipt } from './sepolia-tournament-funding.js';

const addr = n => `0x${n.toString(16).padStart(40, '0')}`;
const owner = new ethers.Wallet(`0x${'12'.repeat(32)}`);
const code = '0x6000';
function deployment(offset = 0) {
  return { chainId: 421614, token: addr(offset + 1), factoryV1: addr(offset + 2), factoryV2: addr(offset + 3),
    shareV1: addr(offset + 4), shareV2: addr(offset + 5), router: addr(offset + 6),
    owner: owner.address, operations: addr(20), routerCodeHash: ethers.utils.keccak256(code) };
}
const users = [
  { username: 'alice', wallet_address: addr(30), turnkey_sub_org_id: 'alice-org', points_balance: '9000' },
  { username: 'bob', wallet_address: addr(31), turnkey_sub_org_id: 'bob-org', points_balance: '0' },
  { username: 'unready', wallet_address: null, turnkey_sub_org_id: null },
];
function input(overrides = {}) {
  return { deployment: deployment(), previousDeployment: deployment(100), users,
    cycleId: 'cycle-two', label: 'Second cycle', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z',
    liquidityMxnp: '1000', maxTotalMxnp: '2000', batchSize: 2, ...overrides };
}
const plan = () => buildTournamentPlan(input());

test('fresh cycle gives equal grants regardless of old Points balances and reserves seed liquidity separately', () => {
  const p = plan();
  assert.equal(p.totalUnits, '2000000000');
  assert.equal(p.userCount, 2);
  assert.deepEqual(p.skipped, ['unready']);
  assert.deepEqual(p.batches.map(b => b.units), ['1000000000', '1000000000']);
  assert.deepEqual(p.batches[0].recipients.map(r => r.units), ['500000000', '500000000']);
  assert.equal(p.batches[1].recipients[0].kind, 'liquidity');
  assert.equal(tournamentRuntimeEnv(p).ONCHAIN_COLLATERAL_ADDRESS, p.deployment.token);
  assert.equal(tournamentRuntimeEnv(p).ONCHAIN_TRADING_ROUTER_ADDRESS, p.deployment.router);
  assert.equal(tournamentRuntimeEnv(p).ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS, undefined);
  assert.deepEqual(validateTournamentPlan(p), p);
});

test('snapshot/hash is deterministic across SQL JSON key order and user query order', () => {
  const p = plan();
  assert.equal(planHash(p), planHash(buildTournamentPlan(input({ users: [...users].reverse() }))));
  assert.equal(planHash(p), planHash(Object.fromEntries(Object.entries(p).reverse())));
  const changed = structuredClone(p);
  changed.batches[0].recipients[0].units = '999999999';
  assert.throws(() => validateTournamentPlan(changed), /modified_tournament_plan/);
});

test('rejects reused collateral/contracts, duplicate identities, invalid windows and budget overruns', () => {
  for (const options of [
    { previousDeployment: deployment() }, { allocation: '0' }, { allocation: '0.0000001' },
    { liquidityMxnp: '0' }, { maxTotalMxnp: '1999.999999' }, { batchSize: 101 },
    { endsAt: '2026-10-01' }, { users: [...users, { ...users[0], username: 'other' }] },
    { users: [...users, { ...users[0], username: 'other', wallet_address: addr(90) }] },
    { users: [...users, { ...users[0], username: 'other', turnkey_sub_org_id: null }] },
    { users: [{ ...users[0], wallet_address: addr(0) }] },
    { users: [{ ...users[0], wallet_address: addr(20) }] }, { users: [] },
  ]) assert.throws(() => buildTournamentPlan(input(options)));
  assert.throws(() => normalizeDeployment({ ...deployment(), chainId: 42161 }), /chain_mismatch/);
});

test('destination guard accepts only explicit branch preview metadata and the pinned direct DB', () => {
  const host = 'ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech';
  const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'onchain-sepolia',
    ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true', ONCHAIN_CHAIN_ID: '421614', ONCHAIN_RPC_URL: 'test',
    DATABASE_URL: `postgresql://local:local@${host}/neondb` };
  const args = { branch: 'onchain-sepolia', expectedHost: host, env };
  assert.doesNotThrow(() => requireTournamentPreview(args));
  for (const change of [{ branch: 'pointbreak' }, { expectedHost: 'production' }, { expectedHost: undefined },
    { env: { ...env, VERCEL_ENV: 'production' } }, { env: { ...env, ONCHAIN_CHAIN_ID: '84532' } },
    { env: { ...env, DATABASE_URL: 'postgresql://localhost/production' } }]) {
    assert.throws(() => requireTournamentPreview({ ...args, ...change }), /destination_required/);
  }
});

test('deployment preflight verifies fresh supply, creator and immutable token/factory/router bindings', async () => {
  const p = plan(), d = p.deployment;
  let supply = '0', actualCreator = d.operations, factoryCollateral = d.token;
  const provider = { getNetwork: async () => ({ chainId: 421614 }), getCode: async () => code };
  const contractAt = a => {
    if (a === d.token) return { owner: async () => d.owner, decimals: async () => 6, totalSupply: async () => supply };
    if ([d.factoryV1, d.factoryV2].includes(a)) return {
      collateral: async () => factoryCollateral, token: async () => a === d.factoryV1 ? d.shareV1 : d.shareV2,
      tradingRouter: async () => d.router, marketCreator: async () => actualCreator, owner: async () => d.owner, marketCount: async () => 0,
    };
    if ([d.shareV1, d.shareV2].includes(a)) return { owner: async () => a === d.shareV1 ? d.factoryV1 : d.factoryV2 };
    return { VERSION: async () => 1, factoryV1: async () => d.factoryV1, factoryV2: async () => d.factoryV2,
      collateral: async () => d.token, tokenV1: async () => d.shareV1, tokenV2: async () => d.shareV2 };
  };
  const check = () => verifyTournamentDeployment(p, { provider, contractAt });
  await check();
  supply = '1'; await assert.rejects(check(), /supply_mismatch/); supply = '0';
  actualCreator = addr(99); await assert.rejects(check(), /binding_or_activity/); actualCreator = d.operations;
  factoryCollateral = p.previousDeployment.token; await assert.rejects(check(), /binding_or_activity/);
});

const mint = new ethers.utils.Interface(MINT_ABI);
function receiptFor(p, batch, status = 1) {
  return { confirmations: 2, status, logs: batch.recipients.map(r => {
    const event = mint.encodeEventLog(mint.getEvent('Transfer'), [ethers.constants.AddressZero, r.wallet, r.units]);
    return { address: p.deployment.token, ...event };
  }) };
}

test('receipts must mint the exact snapshot amounts and recipients', () => {
  const p = plan(), batch = p.batches[0], receipt = receiptFor(p, batch);
  verifyMintReceipt(receipt, p, batch);
  assert.throws(() => verifyMintReceipt({ ...receipt, logs: receipt.logs.slice(1) }, p, batch), /allocation_mismatch/);
  assert.throws(() => verifyMintReceipt(receiptFor(p, { recipients: [...batch.recipients].reverse() }), p, batch), /allocation_mismatch/);
});

const modulePath = process.env.SEPOLIA_GAS_TEST_PGLITE;
test('local PostgreSQL: immutable snapshots, fenced outbox, crash recovery and cycle funding', { skip: !modulePath }, async t => {
  const { PGlite } = await import(modulePath);
  const db = new PGlite();
  const sql = async (strings, ...values) => (await db.query(strings.reduce((text, s, i) => `${text}${i ? `$${i}` : ''}${s}`, ''), values)).rows;
  try {
    for (const ddl of SEPOLIA_TOURNAMENT_SCHEMA) await db.exec(ddl);
    await db.exec('CREATE TABLE points_users (username text, wallet_address text, turnkey_sub_org_id text)');
    for (const u of users) await db.query('INSERT INTO points_users VALUES ($1,$2,$3)', [u.username, u.wallet_address, u.turnkey_sub_org_id]);
    const store = tournamentStore(sql), p = plan(), hash = planHash(p);
    await store.register(p, hash);
    let supply = 0n, nonce = 0, signedCount = 0, broadcasts = 0, timeout = true, sendMode = 'mine', receiptStatus = 1;
    const receipts = new Map();
    const provider = {
      getNetwork: async () => ({ chainId: 421614 }), getTransactionReceipt: async h => receipts.get(h),
      getTransactionCount: async () => nonce, getGasPrice: async () => ethers.BigNumber.from(10_000_000),
      estimateGas: async () => ethers.BigNumber.from(100_000), getBalance: async () => ethers.utils.parseEther('1'),
      sendTransaction: async signed => {
        broadcasts++;
        const h = ethers.utils.keccak256(signed);
        assert.equal((await store.pending(p.deployment.owner)).tx_hash, h, 'signature must be durable before sending');
        if (!receipts.has(h) && sendMode === 'mine') {
          const tx = ethers.utils.parseTransaction(signed);
          const [wallets, amounts] = mint.decodeFunctionData('batchMint', tx.data);
          const b = { recipients: wallets.map((wallet, i) => ({ wallet: wallet.toLowerCase(), units: amounts[i].toString() })) };
          if (receiptStatus === 1) supply += amounts.reduce((sum, n) => sum + BigInt(n.toString()), 0n);
          nonce++;
          receipts.set(h, receiptFor(p, b, receiptStatus));
        }
        if (timeout) throw new Error('RPC timeout after broadcast');
        return { hash: h };
      },
    };
    const run = extra => fundTournamentBatch({ store, provider, cycleId: p.cycleId, expectedHash: hash,
      now: new Date('2026-11-01'), sign: async tx => { signedCount++; return owner.signTransaction(tx); },
      verifyDeployment: async (_plan, { expectedSupply }) => assert.equal(supply.toString(), expectedSupply), ...extra });
    const reset = async () => {
      await db.exec('TRUNCATE sepolia_tournament_closures, sepolia_tournament_joins, sepolia_tournament_mints, sepolia_tournament_lock, sepolia_tournament_cycles');
      await store.register(p, hash);
      supply = 0n; nonce = 0; signedCount = 0; broadcasts = 0; timeout = false;
      sendMode = 'mine'; receiptStatus = 1; receipts.clear();
    };

    await t.test('repeat prepare cannot change the snapshot or reuse its token', async () => {
      await store.register(p, hash);
      await assert.rejects(store.register({ ...p, label: 'changed' }, 'f'.repeat(64)), /immutable/);
      await assert.rejects(store.register({ ...p, cycleId: 'another' }, 'e'.repeat(64)), /unique/i);
    });
    await t.test('expired workers cannot persist signatures or release successor leases', async () => {
      const a = randomUUID(), b = randomUUID();
      assert.equal(await store.acquire(p.deployment.owner, a), true);
      assert.equal(await store.acquire(p.deployment.owner, b), false);
      await db.exec("UPDATE sepolia_tournament_lock SET lease_until = now() - interval '1 second'");
      assert.equal(await store.acquire(p.deployment.owner, b), true);
      await store.release(p.deployment.owner, a);
      await assert.rejects(store.prepare({ cycleId: p.cycleId, planHash: hash, owner: p.deployment.owner,
        hash: 'a', batchIndex: 0, nonce: 0, units: '1', signed: 'private' }, a), /lease_or_cycle/);
      await store.release(p.deployment.owner, b);
    });
    await t.test('ambiguous broadcast confirms the original transaction without a second signature or allocation', async () => {
      await assert.rejects(run(), /broadcast_uncertain/);
      assert.equal(supply, 1000000000n);
      assert.ok((await store.pending(p.deployment.owner)).signed_tx.startsWith('0x'));
      assert.equal((await run()).status, 'confirmed');
      assert.equal(signedCount, 1); assert.equal(broadcasts, 1);
      assert.equal(supply, 1000000000n);
      assert.equal((await store.attempts(p.cycleId))[0].signed_tx, undefined);
    });
    await t.test('batch uniqueness is enforced by PostgreSQL; confirmed allocations cannot be queued twice', async () => {
      const lease = randomUUID(); await store.acquire(p.deployment.owner, lease);
      await assert.rejects(store.prepare({ cycleId: p.cycleId, planHash: hash, owner: p.deployment.owner,
        hash: 'duplicate', batchIndex: 0, nonce: 99, units: p.batches[0].units, signed: 'private' }, lease), /unique/i);
      await assert.rejects(store.finish(p.cycleId, lease, p.deployment.owner), /incomplete/);
      await store.release(p.deployment.owner, lease);
    });
    await t.test('all user and liquidity batches must confirm before the cycle is funded; completion is idempotent', async () => {
      timeout = false;
      assert.equal((await run()).status, 'pending');
      assert.equal((await store.cycle(p.cycleId)).status, 'prepared');
      const pending = await store.pending(p.deployment.owner);
      receipts.get(pending.tx_hash).confirmations = 1;
      assert.equal((await run()).status, 'pending');
      receipts.get(pending.tx_hash).confirmations = 2;
      assert.equal((await run()).status, 'confirmed');
      assert.equal((await run()).status, 'funded');
      assert.equal((await run()).status, 'funded');
      assert.equal(supply, 2000000000n); assert.equal(signedCount, 2);
      assert.equal((await store.cycle(p.cycleId)).status, 'funded');
      await assert.rejects(run({ expectedHash: '0'.repeat(64) }), /reviewed_plan_hash/);
    });
    await t.test('dropped transactions rebroadcast the exact saved signature even after the cycle ends', async () => {
      await reset(); sendMode = 'missing';
      await run();
      const first = await store.pending(p.deployment.owner);
      sendMode = 'mine';
      assert.equal((await run({ now: new Date('2027-01-01') })).txHash, first.tx_hash);
      assert.equal((await store.pending(p.deployment.owner)).signed_tx, first.signed_tx);
      assert.equal(signedCount, 1); assert.equal(broadcasts, 2);
      assert.equal((await run({ now: new Date('2027-01-01') })).status, 'confirmed');
      await assert.rejects(run({ now: new Date('2027-01-01') }), /ended_no_new_mints/);
    });
    await t.test('a consumed nonce without a receipt stops rather than minting a replacement', async () => {
      await reset(); sendMode = 'missing'; await run(); nonce++;
      await assert.rejects(run(), /nonce_consumed_without_receipt/);
      assert.equal(signedCount, 1); assert.equal(broadcasts, 1); assert.equal(supply, 0n);
    });
    await t.test('reverted batches require explicit review before a fresh nonce retry', async () => {
      await reset(); receiptStatus = 0;
      await run(); assert.equal((await run()).status, 'reverted');
      assert.equal(supply, 0n);
      await assert.rejects(run(), /requires_explicit_retry/);
      receiptStatus = 1;
      assert.equal((await run({ retryReverted: true })).status, 'pending');
      assert.equal((await run()).status, 'confirmed');
      assert.equal(supply, 1000000000n);
      assert.deepEqual((await store.attempts(p.cycleId)).map(a => a.status), ['reverted', 'confirmed']);
    });
    await t.test('SQL refuses allocations outside the immutable batch budget', async () => {
      await reset();
      const lease = randomUUID(); await store.acquire(p.deployment.owner, lease);
      await assert.rejects(store.prepare({ cycleId: p.cycleId, planHash: hash, owner: p.deployment.owner,
        hash: 'bad-cap', batchIndex: 0, nonce: 0, units: '1000000001', signed: 'private' }, lease), /lease_or_cycle/);
      await store.release(p.deployment.owner, lease);
      assert.equal(await store.pending(p.deployment.owner), undefined);
    });
    await t.test('wrong chain, ended cycle, unexpected supply, excessive fees and wrong signer cannot broadcast', async () => {
      await reset();
      await assert.rejects(run({ provider: { ...provider, getNetwork: async () => ({ chainId: 84532 }) } }), /rpc_chain_mismatch/);
      await assert.rejects(run({ now: new Date('2027-01-01') }), /ended_no_new_mints/);
      supply = 1n; await assert.rejects(run(), /1.*0/); supply = 0n;
      await assert.rejects(run({ provider: { ...provider, getGasPrice: async () => ethers.utils.parseEther('1') } }), /gas_budget_exceeded/);
      await assert.rejects(run({ sign: tx => new ethers.Wallet(`0x${'34'.repeat(32)}`).signTransaction(tx) }), /signature_payload_mismatch/);
      assert.equal(await store.pending(p.deployment.owner), undefined);
      assert.equal(broadcasts, 0);
    });
    await t.test('changed or newly ambiguous account mappings stop a new mint without rewriting the snapshot', async () => {
      await reset();
      await db.query('UPDATE points_users SET wallet_address = $1 WHERE username = $2', [addr(99), 'alice']);
      await assert.rejects(run(), /recipient_mapping_changed/);
      assert.equal(broadcasts, 0);
      await db.query('UPDATE points_users SET wallet_address = $1 WHERE username = $2', [addr(30), 'alice']);
      await db.query('INSERT INTO points_users VALUES ($1,$2,$3)', ['alias', addr(30), null]);
      await assert.rejects(run(), /recipient_mapping_changed/);
      assert.equal(broadcasts, 0);
      assert.equal((await store.cycle(p.cycleId)).plan_hash, hash);
    });
  } finally { await db.close(); }
});
