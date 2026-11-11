import { createSecureClient, forkEnvironmentConfig, OrderSide, OrderType, WalletType } from '@polymarket/client';
import { postOrder, prepareGaslessTransaction, prepareMarketOrder } from '@polymarket/client/actions';
import { builderApiKey } from '@polymarket/client/node';
import { utils } from 'ethers';
import { POLYMARKET_BUILDER_PROFILE } from '../../../frontend/api/_lib/polymarket-builder.js';

const unit = 1_000_000n;
const minimumBuilderPayout = 100_000n;
const fakeBuilder = {
  key: '00000000-0000-4000-8000-000000000001',
  secret: 'cHJvbm9zLW9mZmxpbmU=',
  passphrase: 'offline-fixture',
};

export const environment = forkEnvironmentConfig({
  name: 'pronos-polymarket-offline',
  rpc: 'https://polygon.invalid',
  clob: { rest: 'https://clob.invalid' },
  relayer: { rest: 'https://relayer.invalid' },
  relayerPollFrequencyMs: 1,
  relayerMaxPolls: 3,
});

export const erc20 = new utils.Interface([
  'function approve(address, uint256) returns (bool)',
  'function transfer(address, uint256) returns (bool)',
]);
export const erc1155 = new utils.Interface([
  'function setApprovalForAll(address, bool)',
]);

export function micros(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/.test(value)) {
    throw new Error('Expected a non-negative decimal with up to six places');
  }
  return BigInt(utils.parseUnits(value, 6).toString());
}

const decimal = value => utils.formatUnits(value.toString(), 6);
const addressOf = value => utils.getAddress(value).toLowerCase();

// Same {address, suborgId, payload} contract as signPointsWalletTypedData in pointsAuth.js.
export function makeTurnkeySigner({ address, suborgId, signTypedData }) {
  const owner = addressOf(address);
  return {
    getAddress: async () => owner,
    async signTypedData({ domain, types: { EIP712Domain, ...types }, message, primaryType }) {
      if (Number(domain.chainId) !== 137 || !['ClobAuth', 'Batch', 'TypedDataSign'].includes(primaryType)) {
        throw new Error('Unsupported Polymarket signing request');
      }
      const payload = utils._TypedDataEncoder.getPayload(domain, types, message);
      if (payload.primaryType !== primaryType) throw new Error('Unexpected typed-data schema');
      const signature = await signTypedData({ address: owner, suborgId, payload });
      if (addressOf(utils.verifyTypedData(domain, types, message, signature)) !== owner) {
        throw new Error('Turnkey signature did not recover the wallet owner');
      }
      return signature;
    },
  };
}

async function runWalletBatch(client, signer, calls, metadata) {
  const workflow = await prepareGaslessTransaction(client, { calls, metadata });
  let step = await workflow.next();
  while (!step.done) {
    const { kind, payload } = step.value;
    if (kind === 'requestAddress') step = await workflow.next(await signer.getAddress());
    else if (kind === 'signGaslessTypedData') step = await workflow.next(await signer.signTypedData(payload));
    else throw new Error('Expected a Deposit Wallet Batch signature');
  }
  return step.value.wait();
}

// The transport serves local fixture responses and a normalized receipt ledger.
// No host, API credential, or production transport is read from the environment.
export async function createOfflineWorkflow({ owner, suborgId, signTypedData, transport }) {
  const signer = makeTurnkeySigner({ address: owner, suborgId, signTypedData });
  const ownerAddress = await signer.getAddress();
  const client = await createSecureClient({
    environment, fetch: transport.fetch, signer, apiKey: builderApiKey(fakeBuilder),
  });
  const wallet = addressOf(client.account.wallet);
  if (client.account.walletType !== WalletType.DEPOSIT_WALLET || wallet === ownerAddress) {
    throw new Error('Expected a distinct Polygon Deposit Wallet');
  }

  const { collateralToken, conditionalTokens, standardExchange } = environment.contracts;
  const orders = new Map();
  const withdrawals = new Map();

  function reconcile(record) {
    const receipt = transport.readOrder(record.orderHash);
    if (!receipt) return { status: 'unknown', orderHash: record.orderHash };
    let filled = 0n;
    let gross = 0n;
    let venueFee = 0n;
    let builderFee = 0n;
    const ids = new Set();
    for (const fill of receipt.fills) {
      if (fill.orderHash !== record.orderHash || fill.assetId !== record.assetId
        || fill.side !== record.side || !fill.tradeId || ids.has(fill.tradeId)) {
        throw new Error('Fill identity does not match the order');
      }
      ids.add(fill.tradeId);
      const shares = micros(fill.shares);
      const amount = micros(fill.gross);
      const price = micros(fill.price);
      if (shares === 0n || amount === 0n || price >= unit || shares * price !== amount * unit
        || (record.side === 'buy' ? price > micros(record.limitPrice) : price < micros(record.limitPrice))) {
        throw new Error('Confirmed fill violated the order limit');
      }
      const chargedVenueFee = micros(fill.venueFee);
      const chargedBuilderFee = micros(fill.builderFee);
      // The mock market has an exponent-one 0.05 fee rate. Fixture fills have exact
      // five-decimal venue fees and exact micro-pUSD builder fees.
      const expectedVenue = shares * 50_000n * price * (unit - price) / (unit ** 3n);
      if (chargedVenueFee !== expectedVenue) throw new Error('Venue fee does not reconcile');
      const expectedBuilder = amount * BigInt(POLYMARKET_BUILDER_PROFILE.takerFeeBps) / 10_000n;
      if (fill.builderCode !== POLYMARKET_BUILDER_PROFILE.code || chargedBuilderFee !== expectedBuilder) {
        throw new Error('Builder fee or attribution does not reconcile');
      }
      filled += shares;
      gross += amount;
      venueFee += chargedVenueFee;
      builderFee += chargedBuilderFee;
    }
    const net = record.side === 'buy' ? gross + venueFee + builderFee : gross - venueFee - builderFee;
    if (filled > record.shareLimit || (record.side === 'buy' && (gross > record.grossLimit || net > record.cashCap))
      || net < 0n) throw new Error('Confirmed fills exceeded the order bounds');
    return {
      status: !receipt.terminal ? 'pending' : filled === 0n ? 'unfilled' : filled < record.shareLimit ? 'partial' : 'filled',
      orderHash: record.orderHash, fills: ids.size, shares: decimal(filled),
      signedMakerAmount: decimal(record.side === 'buy' ? record.grossLimit : record.shareLimit),
      signedTakerAmount: decimal(record.side === 'buy' ? record.shareLimit : record.grossLimit),
      gross: decimal(gross), venueFee: decimal(venueFee), builderFee: decimal(builderFee),
      net: decimal(net),
    };
  }

  return {
    owner: ownerAddress,
    wallet,
    async approveTrading(maxCash) {
      const cap = micros(maxCash);
      if (cap === 0n) throw new Error('Approval cap must be positive');
      const { allowance, outcomeApproved } = transport.readWallet(wallet);
      const calls = [];
      if (allowance < cap) calls.push({
        to: collateralToken, data: erc20.encodeFunctionData('approve', [standardExchange, cap]),
      });
      if (!outcomeApproved) calls.push({
        to: conditionalTokens, data: erc1155.encodeFunctionData('setApprovalForAll', [standardExchange, true]),
      });
      if (calls.length === 0) return { approved: 0 };
      const receipt = await runWalletBatch(client, signer, calls, 'Pronos offline CTF approvals');
      const after = transport.readWallet(wallet);
      if (after.allowance < cap || !after.outcomeApproved) throw new Error('Approval did not reconcile');
      return { approved: calls.length, transactionHash: receipt.transactionHash };
    },
    async order({ intentId, assetId, side, amount, limitPrice }) {
      if (typeof intentId !== 'string' || !intentId || !/^[1-9]\d{0,77}$/.test(assetId)
        || !['buy', 'sell'].includes(side) || micros(amount) === 0n
        || micros(limitPrice) === 0n || micros(limitPrice) >= unit) throw new Error('Invalid offline order intent');
      const identity = JSON.stringify([assetId, side, amount, limitPrice]);
      const known = orders.get(intentId);
      if (known) {
        if (known.identity !== identity) throw new Error('Order intent already has different terms');
        if (known.inFlight) return { status: 'pending', orderHash: known.orderHash ?? null };
        if (known.rejected) return { status: 'rejected', orderHash: known.orderHash };
        return reconcile(known);
      }
      const record = { identity, assetId, side, limitPrice, inFlight: true };
      orders.set(intentId, record);

      try {
        const balances = transport.readWallet(wallet);
        if (side === 'buy' ? balances.cash < micros(amount) || balances.allowance < micros(amount)
          : !balances.outcomeApproved || balances.shares < micros(amount)) throw new Error('Insufficient balance or approval');
        const workflow = await prepareMarketOrder(client, {
          assetId, orderType: OrderType.FAK, builderCode: POLYMARKET_BUILDER_PROFILE.code,
          ...(side === 'buy'
            ? { side: OrderSide.BUY, amount, maxSpend: amount, maxPrice: limitPrice }
            : { side: OrderSide.SELL, shares: amount, minPrice: limitPrice }),
        });
        const step = await workflow.next();
        if (step.done || step.value.kind !== 'signOrder') throw new Error('Expected an SDK signing request');
        const { payload } = step.value;
        const contents = payload.message.contents;
        if (payload.primaryType !== 'TypedDataSign' || payload.domain.version !== '2'
          || addressOf(payload.domain.verifyingContract) !== addressOf(standardExchange)
          || contents.signatureType !== 3 || addressOf(contents.maker) !== wallet || addressOf(contents.signer) !== wallet
          || contents.tokenId.toString() !== assetId || contents.builder !== POLYMARKET_BUILDER_PROFILE.code
          || contents.side !== (side === 'buy' ? 0 : 1)) throw new Error('Unexpected Deposit Wallet order');
        record.shareLimit = BigInt(side === 'buy' ? contents.takerAmount : contents.makerAmount);
        record.grossLimit = BigInt(side === 'buy' ? contents.makerAmount : contents.takerAmount);
        record.cashCap = side === 'buy' ? micros(amount) : null;
        const price = micros(limitPrice);
        if (record.shareLimit === 0n || (side === 'buy'
          ? record.grossLimit > record.cashCap || record.grossLimit * unit > record.shareLimit * price
          : record.shareLimit > micros(amount) || record.grossLimit * unit < record.shareLimit * price)) {
          throw new Error('Signed amounts cannot preserve the requested order bounds');
        }
        record.orderHash = utils._TypedDataEncoder.hash(payload.domain, { Order: payload.types.Order }, contents);
        const finished = await workflow.next(await signer.signTypedData(payload));
        if (!finished.done) throw new Error('Expected one order signature');
        let response;
        record.submissionStarted = true;
        try {
          response = await postOrder(client)(finished.value);
        } catch {
          // A lost acknowledgement can hide a fill. The same intent only reads the ledger.
          return { status: 'unknown', orderHash: record.orderHash };
        }
        if (!response.ok) {
          record.rejected = true;
          return { status: 'rejected', orderHash: record.orderHash };
        }
        if (response.orderId !== record.orderHash) throw new Error('CLOB order ID does not match the signed order');
        return reconcile(record);
      } finally {
        record.inFlight = false;
        if (!record.submissionStarted) orders.delete(intentId);
      }
    },
    auditBuilderFees(utcDay) {
      if (typeof utcDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(utcDay)) throw new Error('Expected a UTC day');
      const fillIds = new Set();
      let accrued = 0n;
      for (const record of orders.values()) {
        const receipt = record.orderHash && transport.readOrder(record.orderHash);
        if (!receipt?.terminal) continue;
        reconcile(record);
        for (const fill of receipt.fills) {
          if (fill.utcDay !== utcDay) continue;
          if (fillIds.has(fill.tradeId)) throw new Error('Trade ID repeated across orders');
          fillIds.add(fill.tradeId);
          accrued += micros(fill.builderFee);
        }
      }
      const payout = transport.readBuilderCredit(POLYMARKET_BUILDER_PROFILE.code, utcDay);
      const credited = payout ? micros(payout.amount) : 0n;
      const status = accrued < minimumBuilderPayout
        ? credited === 0n ? 'below_minimum' : 'mismatch'
        : credited === 0n ? 'awaiting_credit' : credited === accrued ? 'credited' : 'mismatch';
      return { status, accrued: decimal(accrued), credited: decimal(credited), reference: payout?.reference ?? null };
    },
    async withdraw({ intentId, amount }) {
      if (typeof intentId !== 'string' || !intentId) throw new Error('Withdrawal intent ID is required');
      const value = micros(amount);
      const known = withdrawals.get(intentId);
      if (known) {
        if (known.amount !== value) throw new Error('Withdrawal intent already has a different amount');
        return known.result;
      }
      const before = transport.readWallet(wallet).cash;
      const destinationBefore = transport.readCash(ownerAddress);
      if (value === 0n || value > before) throw new Error('Withdrawal exceeds available pUSD');
      const record = { amount: value, result: { status: 'pending' } };
      withdrawals.set(intentId, record);
      let transactionHash;
      try {
        const receipt = await client.transferErc20({
          tokenAddress: collateralToken, recipientAddress: ownerAddress, amount: value,
        });
        ({ transactionHash } = await receipt.wait());
      } catch {
        record.result = { status: 'unknown' };
        return record.result;
      }
      const debit = before - transport.readWallet(wallet).cash;
      const credit = transport.readCash(ownerAddress) - destinationBefore;
      const status = debit === value && credit === value ? 'confirmed' : 'mismatch';
      record.result = { status, transactionHash, debited: decimal(debit), credited: decimal(credit), collateral: 'Polygon pUSD' };
      return record.result;
    },
  };
}
