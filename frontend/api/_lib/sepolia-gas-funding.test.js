import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { sepoliaGasSettings } from './sepolia-gas-config.js';
import { ensureSepoliaGas } from './sepolia-gas-funding.js';

const funder = new ethers.Wallet(`0x${'11'.repeat(32)}`);
const owner = new ethers.Wallet(`0x${'22'.repeat(32)}`).address.toLowerCase();
const env = { ONCHAIN_AUTO_GAS_FUNDING_ENABLED: 'true', ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true',
  VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'onchain-sepolia', ONCHAIN_CHAIN_ID: '421614',
  ONCHAIN_GAS_FUNDER_ADDRESS: funder.address, ONCHAIN_GAS_FUNDER_SUBORG_ID: 'funding-org',
  DATABASE_URL: 'postgres://test@ep-delicate-glitter-amp7yrkv-pooler.c-5.us-east-1.aws.neon.tech/neondb',
  ONCHAIN_RPC_URL: 'https://test.invalid', TURNKEY_POLICIES_ENABLED: 'true' };
Object.assign(env, { TURNKEY_ORGANIZATION_ID: 'parent-org', TURNKEY_API_PUBLIC_KEY: 'test-public', TURNKEY_API_PRIVATE_KEY: 'test-private' });

function fixture() {
  let balance = ethers.constants.Zero, locked = false, entry, mined = true, signs = 0, sends = 0, authorizations = 0;
  let persist = true, funderBalance = ethers.utils.parseEther('1'), latest = 0, noncePending = 0;
  const records = [];
  const settings = sepoliaGasSettings(env);
  const provider = {
    getNetwork: async () => ({ chainId: 421614 }), getCode: async () => '0x',
    getBalance: async a => a.toLowerCase() === owner ? balance : funderBalance,
    getTransactionCount: async (_a, block) => block === 'pending' ? noncePending : latest,
    estimateGas: async () => ethers.BigNumber.from(50000),
    getTransactionReceipt: async hash => records.find(r => r.tx_hash === hash)?.receipt || null,
    sendTransaction: async signed => {
      sends++; const tx = ethers.utils.parseTransaction(signed);
      if (mined && !entry.receipt) { balance = balance.add(tx.value); latest++; noncePending++;
        entry.receipt = { status: 1, transactionHash: tx.hash }; }
      return {};
    },
    waitForTransaction: async hash => records.find(r => r.tx_hash === hash)?.receipt || null,
  };
  const store = {
    acquire: async () => { if (locked) return false; locked = true; return true; },
    release: async () => { locked = false; }, pending: async () => entry?.status === 'prepared' ? entry : null,
    prepare: async e => { if (!persist) return false; entry = { ...e, status: 'prepared' }; records.push(entry); return true; },
    settle: async (_hash, status) => { entry.status = status; },
  };
  const args = { ownerAddr: owner, suborgId: 'user-org', gasUnits: 720000, settings, provider, store,
    authorize: async () => { authorizations++; },
    feeQuote: async () => ({ maxFeePerGas: ethers.utils.parseUnits('0.04', 'gwei'), maxPriorityFeePerGas: ethers.constants.Zero }),
    sign: async ({ unsignedTx }) => { signs++; return funder.signTransaction(ethers.utils.parseTransaction(unsignedTx)); },
  };
  return { args, records, counts: () => ({ signs, sends, authorizations }),
    balance: v => { balance = ethers.utils.parseEther(v); }, mine: v => { mined = v; },
    funderBalance: v => { funderBalance = ethers.utils.parseEther(v); },
    persist: v => { persist = v; }, pendingNonce: v => { noncePending = v; },
  };
}

test('funding is confined to the opted-in Sepolia preview and requires a dedicated funder', () => {
  assert.equal(sepoliaGasSettings(env).configured, true);
  for (const override of [ { VERCEL_ENV: 'production' }, { VERCEL_GIT_COMMIT_REF: 'pointbreak' },
    { ONCHAIN_CHAIN_ID: '42161' }, { ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'false' }, { ONCHAIN_AUTO_GAS_FUNDING_ENABLED: 'false' } ]) {
    assert.equal(sepoliaGasSettings({ ...env, ...override }).enabled, false);
  }
  for (const override of [ { ONCHAIN_GAS_FUNDER_ADDRESS: 'invalid' }, { ONCHAIN_GAS_FUNDER_SUBORG_ID: '' },
    { DATABASE_URL: 'postgres://production' }, { DATABASE_URL: '' },
    { ONCHAIN_DEPLOYER_ADDRESS: funder.address }, { ONCHAIN_OWNER_ADDRESS: funder.address },
    { MARKET_CREATOR_ADDRESS: funder.address }, { RESOLVER_SAFE_ADDRESS: funder.address },
    { ONCHAIN_GAS_FUNDER_ADDRESS: '0x0Caa37c077924038e14e9D8dE46B5208788e52CF' } ]) {
    assert.equal(sepoliaGasSettings({ ...env, ...override }).configured, false);
  }
});

test('zero-ETH user is topped up before trading, using one persisted native transfer', async () => {
  const f = fixture();
  const result = await ensureSepoliaGas(f.args);
  assert.equal(result.funded, true);
  assert.equal(f.records.length, 1);
  const tx = ethers.utils.parseTransaction(f.records[0].signed_tx);
  assert.equal(tx.to.toLowerCase(), owner); assert.equal(tx.chainId, 421614);
  assert.equal(tx.value.toString(), ethers.utils.parseEther('0.0005').toString());
  assert.equal(tx.data, '0x'); assert.equal(tx.gasLimit.toString(), '65000');
  assert.equal(f.records[0].status, 'confirmed');
  await ensureSepoliaGas(f.args);
  assert.deepEqual(f.counts(), { signs: 1, sends: 1, authorizations: 1 });
});

test('already funded users bypass the ledger and funding signer', async () => {
  const f = fixture(); f.balance('0.0003');
  f.args.store = null; f.args.sign = () => assert.fail('must not sign');
  assert.equal((await ensureSepoliaGas(f.args)).funded, false);
});

test('partial balance receives only the difference to target', async () => {
  const f = fixture(); f.balance('0.0001');
  await ensureSepoliaGas(f.args);
  assert.equal(f.records[0].amount_wei, ethers.utils.parseEther('0.0004').toString());
});

test('timeouts recover with the same stored signature and never allocate another nonce', async () => {
  const f = fixture(); f.mine(false);
  await assert.rejects(ensureSepoliaGas(f.args), /gas_funding_pending/);
  assert.equal(f.records[0].status, 'prepared');
  const signed = f.records[0].signed_tx;
  const wait = f.args.provider.waitForTransaction;
  f.args.provider.waitForTransaction = async () => { throw Error('TIMEOUT'); };
  await assert.rejects(ensureSepoliaGas(f.args), /gas_funding_pending/);
  f.args.provider.waitForTransaction = wait;
  f.mine(true);
  await ensureSepoliaGas(f.args);
  assert.equal(f.records.length, 1); assert.equal(f.records[0].signed_tx, signed);
  assert.equal(f.counts().signs, 1); assert.equal(f.counts().sends, 3);
});

test('overlapping requests cannot allocate two funding transactions', async () => {
  const f = fixture();
  const results = await Promise.allSettled([ensureSepoliaGas(f.args), ensureSepoliaGas(f.args)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.records.length, 1); assert.equal(f.counts().signs, 1);
});

test('no broadcasts after lease/budget rejection, persistence failure or unauthorized trading', async () => {
  const f = fixture(); f.persist(false);
  await assert.rejects(ensureSepoliaGas(f.args), /gas_funding_limit/);
  assert.equal(f.counts().sends, 0);
  f.args.store.prepare = async () => { throw Error('database unavailable'); };
  await assert.rejects(ensureSepoliaGas(f.args), /database unavailable/);
  assert.equal(f.counts().sends, 0);
  f.args.authorize = async () => { throw Error('delegation_required'); };
  await assert.rejects(ensureSepoliaGas(f.args), /delegation_required/);
  assert.equal(f.counts().sends, 0);
});

test('wrong chain, expensive fees, unknown pending nonce, contract recipients and low treasury fail closed', async () => {
  const cases = [
    f => { f.args.provider.getNetwork = async () => ({ chainId: 42161 }); },
    f => { f.args.feeQuote = async () => ({ maxFeePerGas: ethers.utils.parseUnits('0.3', 'gwei') }); },
    f => f.pendingNonce(1), f => f.funderBalance('0.0101'),
    f => { f.args.provider.getCode = async () => '0x1234'; },
    f => { f.args.sign = async ({ unsignedTx }) => new ethers.Wallet(`0x${'33'.repeat(32)}`).signTransaction(ethers.utils.parseTransaction(unsignedTx)); },
    f => { f.args.sign = async ({ unsignedTx }) => {
      const tx = ethers.utils.parseTransaction(unsignedTx); tx.value = tx.value.add(1); return funder.signTransaction(tx);
    }; },
  ];
  for (const change of cases) {
    const f = fixture(); change(f);
    await assert.rejects(ensureSepoliaGas(f.args));
    assert.equal(f.counts().sends, 0);
  }
});

test('broadcast errors recover a mined transfer; reverted transfer never unblocks the trade', async () => {
  const f = fixture(); const send = f.args.provider.sendTransaction;
  f.args.provider.sendTransaction = async signed => { await send(signed); throw Error('RPC timeout after acceptance'); };
  assert.equal((await ensureSepoliaGas(f.args)).funded, true);
  const bad = fixture(); const sendBad = bad.args.provider.sendTransaction;
  bad.args.provider.sendTransaction = async signed => { await sendBad(signed); bad.records[0].receipt.status = 0; };
  await assert.rejects(ensureSepoliaGas(bad.args), /gas_funding_unavailable/);
  assert.equal(bad.records[0].status, 'reverted');
});
