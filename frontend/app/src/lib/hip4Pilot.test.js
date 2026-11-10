import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet, utils } from 'ethers';
import { createHip4Pilot } from './hip4Pilot.js';

// Deterministic fixture keys. These accounts never leave the fake transport.
const owner = new Wallet('0x' + '01'.padStart(64, '0'));
const time = 1794343000000;

function fixture({ failBuilderOnce = false, loseOrderResponse = false, signer = owner } = {}) {
  const calls = [];
  const prompts = [];
  let agent;
  let cap = 0;
  let total = 0;
  let shares = 0;
  let paid = 0;
  let received = 0;
  const pilot = createHip4Pilot({ address: owner.address, suborgId: 'test-suborg' }, {
    now: () => time,
    async sign({ address, suborgId, payload }) {
      assert.equal(address, owner.address.toLowerCase());
      assert.equal(suborgId, 'test-suborg');
      assert.equal(payload.domain.chainId, '421614');
      assert.equal(payload.message.hyperliquidChain, 'Testnet');
      const { EIP712Domain, ...types } = payload.types;
      assert.ok(EIP712Domain);
      prompts.push(payload.primaryType);
      return signer._signTypedData(payload.domain, types, payload.message);
    },
    async request(path, body) {
      if (path === '/info') {
        switch (body.type) {
          case 'userRole': return { role: total > 0 ? 'user' : 'missing' };
          case 'spotClearinghouseState': return { balances: [{ coin: 'USDC', total: String(total), hold: '0' }] };
          case 'maxBuilderFee': return cap;
          case 'extraAgents': return agent ? [{ address: agent, validUntil: time + 1800000 }] : [];
          case 'outcomeMeta': return { outcomes: [{ outcome: 26594, quoteToken: 'USDC', sideSpecs: [{}, {}] }] };
          case 'clearinghouseState': return { marginSummary: { accountValue: '100' } };
          case 'userAbstraction': return 'default';
          default: assert.fail(body.type);
        }
      }
      assert.equal(path, '/exchange');
      const { action, nonce, signature } = body;
      assert.ok(signature.v === 27 || signature.v === 28);
      assert.ok(!calls.some(previous => previous.nonce === nonce), 'each action gets a distinct nonce');
      calls.push(body);
      if (action.type === 'order') {
        const [order] = action.orders;
        assert.equal(order.a, 100265941);
        assert.equal(order.t.limit.tif, 'Ioc');
        assert.match(order.c, /^0x[0-9a-f]{32}$/);
        assert.equal(action.builder.f, 250);
        assert.equal(action.builder.b, '0x040fe3673b6bded15d949eefccf3509a2284cd04');
        assert.equal(body.expiresAfter, nonce + 15000);
        const notional = Number(order.p) * Number(order.s);
        const fee = notional * 0.0025;
        paid += fee;
        total = Math.round((total + (order.b ? -notional : notional) - fee) * 1e8) / 1e8;
        shares += Number(order.s) * (order.b ? 1 : -1);
        if (loseOrderResponse) throw new Error('connection lost after acceptance');
        return { status: 'ok', response: { data: { statuses: [{ filled: { totalSz: order.s, avgPx: order.p } }] } } };
      }
      assert.equal(action.hyperliquidChain, 'Testnet');
      assert.equal(action.signatureChainId, '0x66eee');
      assert.equal(action.nonce ?? action.time, nonce);
      if (action.type === 'approveAgent') {
        assert.match(action.agentName, /^pronos-hip4 valid_until \d+$/);
        agent = action.agentAddress;
      }
      if (action.type === 'approveBuilderFee') {
        assert.equal(action.maxFeeRate, '0.25%');
        if (failBuilderOnce) {
          failBuilderOnce = false;
          return { status: 'err', response: 'builder rejected' };
        }
        cap = 250;
      }
      if (action.type === 'sendAsset') {
        assert.equal(action.destination, '0x2000000000000000000000000000000000000000');
        assert.equal(action.sourceDex, 'spot');
        assert.equal(action.destinationDex, 'spot');
        assert.equal(action.token, 'USDC');
        assert.equal(action.fromSubAccount, '');
        received += Number(action.amount);
        total -= Number(action.amount);
      }
      return { status: 'ok', response: { type: 'default' } };
    },
  });
  return { pilot, calls, prompts, credit: () => { total = 30; }, ledger: () => ({ paid, shares, received }) };
}

test('fund, authorize in order, trade both sides at 25 bps, and pay out with the owner', async () => {
  const { pilot, calls, prompts, credit, ledger } = fixture();
  const stages = [];
  assert.equal((await pilot.status()).activated, false);
  await assert.rejects(pilot.enableTrading(), /Fund this/);
  assert.equal(calls.length, 0);
  credit();
  assert.equal((await pilot.status()).usdc, '30.0');
  const enabled = await pilot.enableTrading({ onProgress: stage => stages.push(stage) });
  assert.deepEqual(stages, ['agent', 'builder']);
  assert.equal(enabled.agentApproved && enabled.builderApproved, true);

  const order = { coin: '#265941', price: '0.90', size: '15' };
  const buy = await pilot.order({ ...order, side: 'buy' });
  const sell = await pilot.order({ ...order, side: 'sell' });
  assert.notEqual(buy.cloid, sell.cloid);
  assert.deepEqual(prompts, ['HyperliquidTransaction:ApproveAgent', 'HyperliquidTransaction:ApproveBuilderFee']);
  await assert.rejects(pilot.withdraw({ amount: '0.00000001' }), /Invalid USDC amount/);
  await pilot.withdraw({ amount: '10.00' });
  assert.equal(prompts.at(-1), 'HyperliquidTransaction:SendAsset');
  assert.deepEqual(ledger(), { paid: 0.0675, shares: 0, received: 10 });
  assert.equal((await pilot.status()).usdc, '19.9325');
});

test('retries only the missing approval after a rejected builder approval', async () => {
  const { pilot, prompts, credit } = fixture({ failBuilderOnce: true });
  credit();
  await assert.rejects(pilot.enableTrading(), /builder rejected/);
  await assert.rejects(pilot.order({ coin: '#265941', side: 'buy', price: '0.9', size: '15' }), /both approvals/);
  await pilot.enableTrading();
  assert.deepEqual(prompts, [
    'HyperliquidTransaction:ApproveAgent',
    'HyperliquidTransaction:ApproveBuilderFee',
    'HyperliquidTransaction:ApproveBuilderFee',
  ]);
});

test('rejects an owner signature from a different wallet before exchange submission', async () => {
  const { pilot, calls, credit } = fixture({ signer: new Wallet('0x' + '03'.padStart(64, '0')) });
  credit();
  await assert.rejects(pilot.enableTrading(), /does not match/);
  assert.equal(calls.length, 0);
});

test('reports the cloid for an ambiguous fill and sends no replacement', async () => {
  const { pilot, calls, credit, ledger } = fixture({ loseOrderResponse: true });
  credit();
  await pilot.enableTrading();
  await assert.rejects(pilot.order({ coin: '#265941', side: 'buy', price: '0.9', size: '15' }),
    /Submission status is unknown \(reference 0x[0-9a-f]{32}\)/);
  assert.equal(calls.filter(({ action }) => action.type === 'order').length, 1);
  assert.equal(ledger().shares, 15);
});
