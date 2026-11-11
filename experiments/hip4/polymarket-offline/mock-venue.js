import assert from 'node:assert/strict';
import { Wallet, utils } from 'ethers';
import { environment, erc20, erc1155, micros } from './workflow.js';
import { POLYMARKET_BUILDER_PROFILE } from '../../../frontend/api/_lib/polymarket-builder.js';

export const assetId = '12345' + '0'.repeat(68);
const condition = '0x' + '12'.repeat(32);
const unit = 1_000_000n;
const fmt = value => utils.formatUnits(value.toString(), 6);
const lower = value => value.toLowerCase();
const { collateralToken, conditionalTokens, standardExchange } = environment.contracts;
const { depositWalletFactory, depositWalletBeacon } = environment.walletDerivation;
const addressWord = value => utils.defaultAbiCoder.encode(['address'], [value]);

// Known fixture key with no connection to user accounts, environment secrets or a provider.
const ownerWallet = new Wallet('0x' + '01'.padStart(64, '0'));
export const owner = lower(ownerWallet.address);
export const suborgId = 'offline-test-suborg';
export const fixtureUtcDay = '2026-11-11';
const expectedDepositWallet = '0x6f908b3b67b9f9c40413775fff48b286aef9a081';

const orderType = 'Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)';
const orderFields = orderType.slice(6, -1).split(',').map(field => {
  const [type, name] = field.split(' ');
  return { name, type };
});
const wrapperFields = [
  { name: 'contents', type: 'Order' }, { name: 'name', type: 'string' },
  { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' }, { name: 'salt', type: 'bytes32' },
];
const batchFields = {
  Call: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }],
  Batch: [
    { name: 'wallet', type: 'address' }, { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }, { name: 'calls', type: 'Call[]' },
  ],
};
const orderDomain = {
  name: 'Polymarket CTF Exchange', version: '2', chainId: 137, verifyingContract: standardExchange,
};

function verifyOrder(order, wallet) {
  assert.equal(lower(order.maker), wallet);
  assert.equal(lower(order.signer), wallet);
  assert.equal(order.signatureType, 3);
  assert.equal(order.builder, POLYMARKET_BUILDER_PROFILE.code);
  assert.ok(Number.isSafeInteger(order.salt));
  const values = Object.fromEntries(orderFields.map(({ name }) => [name, order[name]]));
  values.side = order.side === 'BUY' ? 0 : 1;
  const domainSeparator = utils._TypedDataEncoder.hashDomain(orderDomain);
  const contentHash = utils._TypedDataEncoder.hashStruct('Order', { Order: orderFields }, values);
  const bytes = utils.arrayify(order.signature);
  assert.equal(utils.hexlify(bytes.slice(65, 97)), domainSeparator);
  assert.equal(utils.hexlify(bytes.slice(97, 129)), contentHash);
  assert.equal(utils.toUtf8String(bytes.slice(129, -2)), orderType);
  assert.equal(Number(utils.hexlify(bytes.slice(-2))), orderType.length);
  assert.equal(lower(utils.verifyTypedData(orderDomain, { Order: orderFields, TypedDataSign: wrapperFields }, {
    contents: values, name: 'DepositWallet', version: '1', chainId: 137, verifyingContract: wallet,
    salt: utils.hexZeroPad('0x', 32),
  }, utils.hexlify(bytes.slice(0, 65)))), owner);
  return utils.keccak256(utils.hexConcat(['0x1901', domainSeparator, contentHash]));
}

export function createMockVenue({
  loseBuyResponse = true, rejectOrders = false, leaveOrderPending = false, loseWithdrawalResponse = false,
} = {}) {
  const relay = new Map();
  const receipts = new Map();
  const builderCredits = new Map();
  const requests = [];
  const signing = [];
  const failures = [];
  const wallet = expectedDepositWallet;
  let deployed = false;
  let cash = 0n;
  let ownerCash = 0n;
  let shares = 0n;
  let allowance = 0n;
  let outcomeApproved = false;
  let nonce = 0n;
  let orderAttempts = 0;

  function newTransaction(apply) {
    const id = '00000000-0000-4000-8000-' + String(relay.size + 1).padStart(12, '0');
    relay.set(id, { apply, transactionHash: utils.id(id), confirmed: false });
    return Response.json({ transactionID: id, state: 'STATE_NEW' });
  }

  async function relayRequest(request, url) {
    const path = url.pathname;
    if (request.method === 'GET' && path === '/deployed') {
      assert.equal(url.searchParams.get('type'), 'WALLET');
      // The SDK checks its candidate wallet before provisioning and authenticating it.
      return Response.json({ deployed });
    }
    if (request.method === 'GET' && path === '/v1/account/transactions/params') {
      assert.equal(lower(url.searchParams.get('address')), owner);
      assert.equal(url.searchParams.get('type'), 'WALLET');
      return Response.json({ address: owner, nonce: nonce.toString() });
    }
    if (request.method === 'GET' && path.startsWith('/v1/account/transactions/')) {
      const id = path.split('/').at(-1);
      const transaction = relay.get(id);
      assert.ok(transaction);
      if (!transaction.confirmed) {
        transaction.apply();
        transaction.confirmed = true;
      }
      return Response.json({ transaction_id: id, transaction_hash: transaction.transactionHash, state: 'STATE_CONFIRMED' });
    }
    assert.equal(request.method, 'POST');
    assert.equal(path, '/submit');
    const body = await request.json();
    assert.equal(lower(body.from), owner);
    assert.equal(lower(body.to), lower(depositWalletFactory));
    if (body.type === 'WALLET-CREATE') {
      assert.equal(deployed, false);
      return newTransaction(() => { deployed = true; });
    }
    assert.equal(body.type, 'WALLET');
    const { depositWallet, deadline, calls } = body.depositWalletParams;
    assert.equal(lower(depositWallet), wallet);
    assert.equal(BigInt(body.nonce), nonce);
    assert.ok(Number(deadline) > Date.now() / 1000);
    assert.equal(lower(utils.verifyTypedData(
      { name: 'DepositWallet', version: '1', chainId: 137, verifyingContract: depositWallet },
      batchFields, { wallet: depositWallet, nonce: body.nonce, deadline, calls }, body.signature,
    )), owner);
    const changes = calls.map(({ target, data, value }) => {
      assert.equal(value, '0');
      if (lower(target) === lower(collateralToken)) {
        const call = erc20.parseTransaction({ data });
        if (call.name === 'approve') {
          assert.equal(lower(call.args[0]), lower(standardExchange));
          return () => { allowance = BigInt(call.args[1].toString()); };
        }
        assert.equal(call.name, 'transfer');
        assert.equal(lower(call.args[0]), owner);
        const amount = BigInt(call.args[1].toString());
        assert.ok(amount > 0n && amount <= cash);
        return () => { cash -= amount; ownerCash += amount; };
      }
      assert.equal(lower(target), lower(conditionalTokens));
      const call = erc1155.parseTransaction({ data });
      assert.equal(call.name, 'setApprovalForAll');
      assert.equal(lower(call.args[0]), lower(standardExchange));
      assert.equal(call.args[1], true);
      return () => { outcomeApproved = true; };
    });
    const submitted = newTransaction(() => {
      nonce += 1n;
      changes.forEach(apply => apply());
    });
    if (loseWithdrawalResponse && calls.some(call => call.data.startsWith(erc20.getSighash('transfer')))) {
      const { transactionID } = await submitted.json();
      const receipt = relay.get(transactionID);
      receipt.apply();
      receipt.confirmed = true;
      throw new Error('Fixture lost withdrawal acknowledgement');
    }
    return submitted;
  }

  async function clobRequest(request, url) {
    if (request.method === 'POST' && url.pathname === '/auth/api-key') {
      assert.equal(lower(request.headers.get('poly_address')), owner);
      const { domain, types: { EIP712Domain, ...types }, message, primaryType } = signing.at(-1);
      assert.equal(primaryType, 'ClobAuth');
      assert.equal(lower(message.address), owner);
      assert.equal(request.headers.get('poly_timestamp'), message.timestamp);
      assert.equal(request.headers.get('poly_nonce'), message.nonce);
      assert.equal(lower(utils.verifyTypedData(domain, types, message, request.headers.get('poly_signature'))), owner);
      return Response.json({ apiKey: '00000000-0000-4000-8000-000000000002', secret: 'b2ZmbGluZQ==', passphrase: 'offline' });
    }
    if (request.method === 'GET' && url.pathname === '/markets-by-token/' + assetId) {
      return Response.json({ condition_id: condition });
    }
    if (request.method === 'GET' && url.pathname === '/clob-markets/' + condition) {
      return Response.json({
        c: condition, mts: 0.01, nr: false, fd: { r: 0.05, e: 1, to: true },
        t: [{ t: assetId, o: 'A' }, { t: '54321' + '0'.repeat(68), o: 'B' }],
      });
    }
    if (request.method === 'GET' && url.pathname === '/fees/builder-fees/' + POLYMARKET_BUILDER_PROFILE.code) {
      return Response.json({ builder_maker_fee_rate_bps: 0, builder_taker_fee_rate_bps: 50 });
    }
    assert.equal(request.method, 'POST');
    assert.equal(url.pathname, '/order');
    assert.equal(lower(request.headers.get('poly_address')), owner);
    const body = await request.json();
    assert.equal(body.owner, '00000000-0000-4000-8000-000000000002');
    assert.equal(body.orderType, 'FAK');
    assert.equal(body.order.expiration, '0');
    assert.equal(body.order.tokenId, assetId);
    orderAttempts += 1;
    const orderHash = verifyOrder(body.order, wallet);
    assert.ok(!receipts.has(orderHash), 'No replacement or duplicate order after an ambiguous response');
    const side = body.order.side === 'BUY' ? 'buy' : 'sell';
    const fillShares = micros('10');
    const price = micros(side === 'buy' ? '0.50' : '0.45');
    const gross = fillShares * price / unit;
    const venueFee = side === 'buy' ? micros('0.125') : micros('0.12375');
    const builderFee = side === 'buy' ? micros('0.025') : micros('0.0225');
    assert.ok(side === 'buy' ? BigInt(body.order.takerAmount) >= fillShares : BigInt(body.order.makerAmount) >= fillShares);
    if (rejectOrders) return Response.json({
      success: false, errorMsg: 'fixture rejection', orderID: '', status: '', makingAmount: '', takingAmount: '',
    });
    if (leaveOrderPending) {
      receipts.set(orderHash, { terminal: false, fills: [] });
      return Response.json({
        success: true, errorMsg: '', orderID: orderHash, status: 'delayed', makingAmount: '', takingAmount: '',
        tradeIDs: [], transactionsHashes: [],
      });
    }

    if (side === 'buy') {
      const spend = gross + venueFee + builderFee;
      assert.ok(cash >= spend && allowance >= spend);
      cash -= spend;
      allowance -= spend;
      shares += fillShares;
    } else {
      assert.ok(outcomeApproved && shares >= fillShares);
      shares -= fillShares;
      cash += gross - venueFee - builderFee;
    }
    const tradeId = '00000000-0000-4000-8000-' + String(orderAttempts).padStart(12, '0');
    receipts.set(orderHash, {
      terminal: true,
      fills: [{
        tradeId, orderHash, assetId, side, utcDay: fixtureUtcDay, price: fmt(price), shares: fmt(fillShares), gross: fmt(gross),
        venueFee: fmt(venueFee), builderFee: fmt(builderFee), builderCode: body.order.builder,
      }],
    });
    if (side === 'buy' && loseBuyResponse) throw new Error('Fixture lost acknowledgement after recording a fill');
    return Response.json({
      success: true, orderID: orderHash, errorMsg: '', status: 'matched',
      makingAmount: fmt(side === 'buy' ? gross : fillShares), takingAmount: fmt(side === 'buy' ? fillShares : gross),
      tradeIDs: [tradeId], transactionsHashes: [utils.id(tradeId)],
    });
  }

  const transport = {
    async fetch(input, init) {
      const request = new Request(input, init);
      const url = new URL(request.url);
      requests.push(request.method + ' ' + url.hostname + url.pathname);
      try {
        if (url.origin === 'https://relayer.invalid') return await relayRequest(request, url);
        if (url.origin === 'https://clob.invalid') return await clobRequest(request, url);
        if (url.origin === 'https://polygon.invalid') {
          const body = await request.json();
          assert.equal(body.method, 'eth_call');
          assert.equal(lower(body.params[0].to), lower(depositWalletFactory));
          return Response.json({ jsonrpc: '2.0', id: body.id, result: addressWord(depositWalletBeacon) });
        }
        assert.fail('Unexpected offline SDK request ' + url.pathname);
      } catch (error) {
        if (!error.message.startsWith('Fixture lost ')) failures.push(error);
        throw error;
      }
    },
    readWallet(address) {
      assert.equal(lower(address), wallet);
      return { cash, allowance, outcomeApproved, shares };
    },
    readCash(address) {
      assert.equal(lower(address), owner);
      return ownerCash;
    },
    readOrder(hash) { return structuredClone(receipts.get(hash)); },
    readBuilderCredit(code, day) {
      assert.equal(code, POLYMARKET_BUILDER_PROFILE.code);
      return structuredClone(builderCredits.get(day));
    },
    fund(walletAddress, amount) {
      assert.equal(deployed, true);
      assert.equal(lower(walletAddress), wallet);
      cash += micros(amount);
    },
  };
  return {
    transport, requests, signing, failures,
    get orderAttempts() { return orderAttempts; },
    get relays() { return relay.size; },
    creditBuilder(day, amount) {
      builderCredits.set(day, { amount, reference: utils.id('offline-payout:' + day) });
    },
    async signTypedData({ address, suborgId: organization, payload }) {
      assert.equal(address, owner);
      assert.equal(organization, suborgId);
      // Turnkey receives a JSON payload, not the SDK's BigInt values.
      const serializable = JSON.parse(JSON.stringify(payload));
      signing.push(serializable);
      const { domain, types: { EIP712Domain, ...types }, message } = serializable;
      return ownerWallet._signTypedData(domain, types, message);
    },
  };
}
