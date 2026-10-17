import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ethers } from 'ethers';
import { readSellQuoteAmounts } from './onchain-sell-quote.js';
import { formatProtocolSellQuote, enforceProtocolSellSlippage } from './protocol-trade-guards.js';
import { buildSellPreview } from '../../app/points/src/lib/sellPreview.js';

// The 1-share rehearsal sell at block 320119066 emitted net=508851,
// fee=13684. Reserves are the preceding 100-MXNP seed + 5-MXNP buy.
function binaryFixture({ sellYes = true, tiny = false, square = false, inconsistent = false, failFee = false } = {}) {
  const calls = [];
  const yes = tiny || square ? '100000000' : sellYes ? '95351610' : '104875000';
  const no = tiny || square ? '100000000' : sellYes ? '104875000' : '95351610';
  const shares = tiny ? '3' : square ? '150000000' : '1000000';
  const gross = tiny ? '1' : square ? '50000000' : '522535';
  const fee = tiny ? '1' : square ? '1250000' : '13684';
  const net = tiny ? '0' : square ? '48750000' : '508851';
  const record = (name, result) => async (...args) => {
    calls.push([name, ...args]);
    return ethers.BigNumber.from(result);
  };
  const amm = {
    estimateSell: record('estimateSell', inconsistent ? '508850' : net),
    reserveYes: record('reserveYes', yes),
    reserveNo: record('reserveNo', no),
    async calculateFee(amount, buyYes, overrides) {
      calls.push(['calculateFee', amount, buyYes, overrides]);
      assert.equal(amount, gross);
      assert.equal(buyYes, !sellYes);
      if (failFee) throw Error('rpc_unavailable');
      return ethers.BigNumber.from(fee);
    },
    priceYes: record('priceYes', sellYes ? '523781' : '476218'),
    priceNo: record('priceNo', sellYes ? '476218' : '523781'),
  };
  return { amm, calls, shares, gross, fee, net, outcomeIndex: sellYes ? 0 : 1 };
}

for (const sellYes of [true, false]) {
  test(`binary ${sellYes ? 'YES' : 'NO'} sell uses the opposite-side fee and exact gross rounding`, async () => {
    const f = binaryFixture({ sellYes });
    const result = await readSellQuoteAmounts({ amm: f.amm, binary: true, outcomeIndex: f.outcomeIndex,
      sharesUnits: ethers.BigNumber.from(f.shares), blockTag: 320119065 });
    assert.deepEqual(result, { gross: 522535n, fee: 13684n, collateralOut: 508851n });
    assert.equal(f.calls[0][1], sellYes);
    for (const call of f.calls) assert.deepEqual(call.at(-1), { blockTag: 320119065 });
  });
}

for (const options of [{ tiny: true }, { square: true }]) {
  test(`binary sell handles ${options.tiny ? 'minimum-unit fees' : 'a perfect square discriminant'}`, async () => {
    const f = binaryFixture(options);
    const result = await readSellQuoteAmounts({ amm: f.amm, binary: true, outcomeIndex: 0,
      sharesUnits: f.shares, blockTag: 1 });
    assert.deepEqual(result, { gross: BigInt(f.gross), fee: BigInt(f.fee), collateralOut: BigInt(f.net) });
  });
}

test('multi-outcome sells remain fee-free and keep the six-decimal net estimate', async () => {
  const calls = [];
  const amm = { async estimateSell(...args) { calls.push(args); return ethers.BigNumber.from('12345678'); },
    calculateFee() { assert.fail('V2 calculateFee is a buy fee, not a sell fee'); } };
  const result = await readSellQuoteAmounts({ amm, binary: false, outcomeIndex: 2, sharesUnits: '50000000', blockTag: 42 });
  assert.deepEqual(result, { gross: 12345678n, fee: 0n, collateralOut: 12345678n });
  assert.deepEqual(calls, [[2, '50000000', { blockTag: 42 }]]);
});

test('inconsistent estimates and unavailable fee reads fail without a fabricated fee', async () => {
  for (const [options, message] of [[{ inconsistent: true }, /sell_quote_inconsistent/], [{ failFee: true }, /rpc_unavailable/]]) {
    const f = binaryFixture(options);
    await assert.rejects(readSellQuoteAmounts({ amm: f.amm, binary: true, outcomeIndex: 0,
      sharesUnits: f.shares, blockTag: 1 }), message);
  }
});

// Exercise the real dispatcher/ABI/price reader with an injected RPC; signing
// dependencies are deliberately excluded from this read-only test.
const source = await readFile(new URL('./onchain-trader.js', import.meta.url), 'utf8');
function sellDispatcher(amm) {
  const abi = source.slice(source.indexOf('const BINARY_AMM_ABI ='), source.indexOf('const ERC20_ABI ='));
  const prices = source.slice(source.indexOf('async function readAmmPrices('), source.indexOf('export async function quoteBuyOnChain('));
  const quote = source.slice(source.indexOf('export async function quoteSellOnChain('), source.indexOf('export async function buyOnChain(')).replace('export async', 'async');
  const rpc = { async getBlockNumber() { return 320119065; } };
  const bindings = {
    ethers: { ...ethers, Contract: class {
      constructor(address, contractAbi, provider) {
        assert.equal(provider, rpc);
        const iface = new ethers.utils.Interface(contractAbi);
        if (amm.reserveYes) assert.ok(iface.getFunction('reserveYes'));
        if (amm.reserveNo) assert.ok(iface.getFunction('reserveNo'));
        return amm;
      }
    } },
    requireReadReady() {}, provider: () => rpc,
    isBinary: market => market.outcomes.length === 2,
    parseCollateralUnits: n => ethers.utils.parseUnits(String(n), 6),
    toCollateralNumber: n => Number(ethers.utils.formatUnits(n, 6)),
    priceToNumber: n => Number(ethers.utils.formatUnits(n, 6)),
    readSellQuoteAmounts, formatProtocolSellQuote,
  };
  return new Function(...Object.keys(bindings), `${abi}\n${prices}\n${quote}\nreturn quoteSellOnChain;`)(...Object.values(bindings));
}

test('the real sell dispatcher presents gross/fee/net while frontend PnL and minimum-out use net once', async () => {
  const f = binaryFixture();
  const quote = await sellDispatcher(f.amm)({ market: { chain_address: '0xPool', outcomes: ['Sí', 'No'] }, outcomeIndex: 0, shares: 1 });
  assert.equal(quote.gross, 0.522535);
  assert.equal(quote.fee, 0.013684);
  assert.equal(quote.collateralOut, 0.508851);
  assert.equal(quote.feePct, (0.013684 / 0.522535) * 100);
  assert.equal(quote.priceBefore, 0.523781);
  assert.deepEqual(quote.pricesBefore, [0.523781, 0.476218]);
  for (const call of f.calls) assert.deepEqual(call.at(-1), { blockTag: 320119065 });

  const preview = buildSellPreview({ mode: 'onchain', shares: 2, costBasis: 1, currentValue: 1.04 }, quote);
  assert.equal(preview.gross, quote.gross);
  assert.equal(preview.fee, quote.fee);
  assert.equal(preview.feePct, quote.feePct);
  assert.equal(preview.collateralOut, 0.508851);
  assert.equal(preview.salePnl, 0.01);
  assert.equal(preview.minCollateralOut, 0.503762);
  assert.doesNotThrow(() => enforceProtocolSellSlippage({ quote, minCollateralOut: preview.minCollateralOut }));
  assert.throws(() => enforceProtocolSellSlippage({ quote, minCollateralOut: quote.gross }), /price_moved/);
});

test('the real multi-outcome dispatcher does not introduce a sell fee', async () => {
  const amm = { estimateSell: async () => '12345678', prices: async overrides => {
    assert.deepEqual(overrides, { blockTag: 320119065 });
    return ['200000', '300000', '500000'];
  } };
  const quote = await sellDispatcher(amm)({ market: { chain_address: '0xMulti', outcomes: ['A', 'B', 'C'] }, outcomeIndex: 2, shares: 50 });
  assert.equal(quote.gross, 12.345678);
  assert.equal(quote.collateralOut, 12.345678);
  assert.equal(quote.fee, 0);
  assert.equal(quote.feePct, 0);
  assert.equal(quote.priceBefore, 0.5);
});
