import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet, utils } from 'ethers';
import { createHip4Pilot } from './hip4Pilot.js';

// Deterministic fixture keys. These accounts never leave the fake transport.
const owner = new Wallet('0x' + '01'.padStart(64, '0'));
const time = 1794343000000;
const order = { coin: '#265401', price: '0.90', size: '15' };
const marketFixture = {
  outcome: 26540,
  name: 'template:sportsContestWinner7',
  description: 'competition:NFL|contestType:game|officialSource:NFL|participantA:Carolina Panthers|participantB:New Orleans Saints|resolutionDeadline:20261118-1800|scheduledStart:20261115-1800|season:2026|shortNameA:CAR|shortNameB:NO|sport:American football|stage:Week 10',
  sideSpecs: [{ name: 'template:{shortNameA}' }, { name: 'template:{shortNameB}' }],
  quoteToken: 'USDC',
  venue: 'flip',
};

// The published testnet template is pinned by the pilot, so the fixture uses its exact description.
const templateFixture = {
  id: 'sportsContestWinner7',
  role: { standaloneOutcome: { sideNames: ['{shortNameA}', '{shortNameB}'] } },
  description: [
    'This {sport} market has two sides, {shortNameA} for {participantA} and {shortNameB} for {participantB}.',
    'It covers the {contestType} between {participantA} and {participantB} in the {season} {competition} {stage}, scheduled for {scheduledStart} UTC (the "Contest").',
    "The market resolves to {shortNameA} if {officialSource}'s official result names {participantA} the sole winner of the Contest, and resolves to {shortNameB} if that result names {participantB} the sole winner.",
    'Tokens of the side the market resolves to pay out $1 each and tokens of the other side pay out $0 each.',
    'The official result includes all periods and tiebreak procedures that {officialSource} treats as part of the Contest.',
    'If the Contest is postponed, delayed, or suspended, the result of the Contest as ultimately completed applies if a listed participant is named the sole winner by {resolutionDeadline} UTC.',
    'A listed participant named the sole winner after an abandonment, walkover, forfeit, disqualification, retirement, withdrawal, or administrative decision also applies.',
    'The market resolves to 0.5, with {shortNameA} and {shortNameB} tokens each paying out $0.50, if {officialSource} records a draw, tie, co-winners (even if a listed participant is among them), no contest, or no winner; names anyone other than the listed participants as the winner; cancels the Contest without a replacement; or has not named a listed participant the sole winner by {resolutionDeadline} UTC.',
    '{officialSource} is the primary resolution source; independent reputable reporting may be used if it has not published the relevant result.',
    'The market resolves to 0.5 under the deadline rule above only if neither {officialSource} nor independent reputable reporting names a listed participant the sole winner by {resolutionDeadline} UTC.',
    'Once resolved, later appeals, corrections, reversals, or result reassignments do not change the resolution.',
    'This market is not sponsored by, endorsed by, or affiliated with {officialSource} or with any competition, league, governing body, organizer, team, club, participant, or other person or entity referenced in this market.',
    'All names and trademarks are the property of the respective rights holders and are descriptive only.',
    'metadata=category:sports|subCategory:{sport}|semanticRestriction:This market must refer to a single scheduled sports contest.',
  ].join(' '),
};

function fixture({
  failBuilderOnce = false,
  loseOrderResponse = false,
  signer = owner,
  market = marketFixture,
  templates = [templateFixture],
  questions = [],
  failTemplates = false,
  startingShares = 0,
} = {}) {
  const calls = [];
  const prompts = [];
  const infoQueries = [];
  let agent;
  let cap = 0;
  let total = 0;
  let shares = startingShares;
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
        infoQueries.push(body.type);
        switch (body.type) {
          case 'userRole': return { role: total > 0 ? 'user' : 'missing' };
          case 'spotClearinghouseState': return { balances: [{ coin: 'USDC', total: String(total), hold: '0' }] };
          case 'maxBuilderFee': return cap;
          case 'extraAgents': return agent ? [{ address: agent, validUntil: time + 1800000 }] : [];
          case 'outcomeMeta': return { outcomes: [market], questions };
          case 'outcomeTemplates':
            if (failTemplates) throw new Error('testnet templates unavailable');
            return templates;
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
        assert.equal(order.a, 100_000_000 + market.outcome * 10 + 1);
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
  return { pilot, calls, prompts, infoQueries, credit: () => { total = 30; }, ledger: () => ({ paid, shares, received }) };
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
  await assert.rejects(pilot.order({ ...order, side: 'buy' }), /both approvals/);
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
  await assert.rejects(pilot.order({ ...order, side: 'buy' }),
    /Submission status is unknown \(reference 0x[0-9a-f]{32}\)/);
  assert.equal(calls.filter(({ action }) => action.type === 'order').length, 1);
  assert.equal(ledger().shares, 15);
});

test('blocks buys before exchange submission when cancellation terms cannot be verified', async (t) => {
  const cases = [
    ['changed template text', { templates: [{ ...templateFixture, description: `${templateFixture.description} Changed.` }] }],
    ['unknown price template', { market: { ...marketFixture, name: 'template:binaryPrice6' } }],
    ['different venue', { market: { ...marketFixture, venue: 'pewt' } }],
    ['grouped outcome', { questions: [{ fallbackOutcome: 1, namedOutcomes: [26540], settledNamedOutcomes: [] }] }],
    ['group fallback', { questions: [{ fallbackOutcome: 26540, namedOutcomes: [], settledNamedOutcomes: [] }] }],
    ['settled group member', { questions: [{ fallbackOutcome: 1, namedOutcomes: [], settledNamedOutcomes: [26540] }] }],
    ['incorrect sport', { market: { ...marketFixture, description: marketFixture.description.replace('American football', 'Politics') } }],
    ['expired market', { market: { ...marketFixture, description: marketFixture.description.replace('20261118-1800', '20261110-1800').replace('20261115-1800', '20261109-1800') } }],
    ['impossible deadline', { market: { ...marketFixture, description: marketFixture.description.replace('20261118-1800', '20261131-1800') } }],
    ['unavailable rules', { failTemplates: true }, /No pudimos verificar/],
  ];
  for (const [name, options, expected = /NFL de Flip/] of cases) {
    await t.test(name, async () => {
      const { pilot, calls, credit } = fixture(options);
      credit();
      await pilot.enableTrading();
      await assert.rejects(pilot.order({ ...order, side: 'buy' }), expected);
      assert.equal(calls.filter(({ action }) => action.type === 'order').length, 0);
    });
  }
});

test('an existing position can be sold and withdrawn from a market ineligible for new buys', async () => {
  const { pilot, calls, credit, ledger, infoQueries } = fixture({
    market: { outcome: 26594, quoteToken: 'USDC', sideSpecs: [{}, {}], name: 'template:binaryPrice6', venue: 'pewt' },
    failTemplates: true,
    startingShares: 15,
  });
  credit();
  await pilot.enableTrading();
  const oldOrder = { ...order, coin: '#265941' };
  await assert.rejects(pilot.order({ ...oldOrder, side: 'buy' }), /NFL de Flip/);
  infoQueries.length = 0;
  await pilot.order({ ...oldOrder, side: 'sell' });
  await pilot.withdraw({ amount: '10.00' });
  assert.ok(!infoQueries.includes('outcomeTemplates'));
  assert.deepEqual(calls.map(({ action }) => action.type), ['approveAgent', 'approveBuilderFee', 'order', 'sendAsset']);
  assert.deepEqual(ledger(), { paid: 0.03375, shares: 0, received: 10 });
});
