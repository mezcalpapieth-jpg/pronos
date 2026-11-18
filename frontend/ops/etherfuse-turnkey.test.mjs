import assert from 'node:assert/strict';
import test from 'node:test';
import { ethers } from 'ethers';
import { createMonadTestnetTransferClient, MONAD_TESTNET_CHAIN_ID, MONAD_TESTNET_RPC_URL } from './etherfuse-turnkey.mjs';

const wallet = new ethers.Wallet(`0x${'12'.repeat(32)}`);
const otherWallet = new ethers.Wallet(`0x${'42'.repeat(32)}`);
const transfer = {
  tokenAddress: ethers.utils.getAddress(`0x${'34'.repeat(20)}`),
  destinationAddress: ethers.utils.getAddress(`0x${'56'.repeat(20)}`),
  amountUnits: '5750000',
};
const tokenInterface = new ethers.utils.Interface([
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount)',
]);

function setup(overrides = {}) {
  const requests = [];
  const provider = {
    async send(method, params) {
      requests.push([method, params]);
      return ethers.utils.hexValue(MONAD_TESTNET_CHAIN_ID);
    },
    async getTransactionCount(address, block) {
      assert.equal(address, wallet.address);
      assert.equal(block, 'pending');
      return 7;
    },
    async getFeeData() {
      return { maxFeePerGas: ethers.BigNumber.from(50), maxPriorityFeePerGas: ethers.BigNumber.from(2) };
    },
    async getCode(address) {
      assert.equal(address, transfer.tokenAddress);
      return '0x60';
    },
    async getBalance(address, block) {
      assert.equal(address, wallet.address);
      assert.equal(block, 'pending');
      return ethers.BigNumber.from(2_500_000);
    },
    async call({ to, data }) {
      assert.equal(to, transfer.tokenAddress);
      const call = tokenInterface.parseTransaction({ data });
      if (call.name === 'decimals') return tokenInterface.encodeFunctionResult('decimals', [6]);
      assert.equal(call.name, 'balanceOf');
      assert.equal(call.args.account, wallet.address);
      return tokenInterface.encodeFunctionResult('balanceOf', [transfer.amountUnits]);
    },
    async estimateGas(call) {
      requests.push(['estimateGas', call]);
      return ethers.BigNumber.from(40_000);
    },
    async sendTransaction(raw) {
      requests.push(['sendTransaction', raw]);
      return { hash: ethers.utils.keccak256(raw) };
    },
    async getTransaction() {
      return null;
    },
    ...overrides.provider,
  };
  const signTransaction = overrides.signTransaction ?? (async ({ signWith, unsignedTransaction }) => {
    requests.push(['signTransaction', unsignedTransaction]);
    assert.equal(signWith, wallet.address);
    return wallet.signTransaction(ethers.utils.parseTransaction(unsignedTransaction));
  });
  const client = createMonadTestnetTransferClient({
    env: { ETHERFUSE_TEST_WALLET_ADDRESS: wallet.address }, provider, signTransaction,
  });
  return { client, provider, requests };
}

test('prepares a direct Monad testnet transfer, signs it without broadcast, and submits existing bytes explicitly', async () => {
  const { client, requests } = setup();
  assert.equal(MONAD_TESTNET_CHAIN_ID, 10143);
  assert.equal(MONAD_TESTNET_RPC_URL, 'https://testnet-rpc.monad.xyz');
  const prepared = await client.prepareTransfer(transfer);
  const unsigned = ethers.utils.parseTransaction(prepared.unsignedTransaction);
  assert.equal(unsigned.chainId, 10143);
  assert.equal(unsigned.nonce, 7);
  assert.equal(unsigned.to, transfer.tokenAddress);
  assert.equal(unsigned.value.toString(), '0');
  const [to, units] = tokenInterface.decodeFunctionData('transfer', unsigned.data);
  assert.equal(to, transfer.destinationAddress);
  assert.equal(units.toString(), transfer.amountUnits);
  assert.deepEqual(requests.map(([method]) => method), ['eth_chainId', 'estimateGas']);

  const signed = await client.signTransfer(prepared);
  assert.equal(ethers.utils.parseTransaction(signed.rawTransaction).from, wallet.address);
  assert.equal(signed.txHash, ethers.utils.keccak256(signed.rawTransaction));
  assert.equal(requests.some(([method]) => method === 'sendTransaction'), false);

  assert.deepEqual(await client.broadcastTransfer({ ...transfer, ...signed }), { txHash: signed.txHash, alreadyKnown: false });
  assert.deepEqual(requests.slice(-2), [['eth_chainId', []], ['sendTransaction', signed.rawTransaction]]);
});

test('refuses a different RPC chain before preparation, signing, or broadcast', async () => {
  const { client, provider, requests } = setup();
  const prepared = await client.prepareTransfer(transfer);
  const signed = await client.signTransfer(prepared);
  provider.send = async () => '0x8f';
  await assert.rejects(client.prepareTransfer(transfer), /monad_testnet_chain_mismatch/);
  await assert.rejects(client.signTransfer(prepared), /monad_testnet_chain_mismatch/);
  await assert.rejects(client.broadcastTransfer({ ...transfer, ...signed }), /monad_testnet_chain_mismatch/);
  assert.equal(requests.filter(([method]) => method === 'signTransaction').length, 1);
  assert.equal(requests.some(([method]) => method === 'sendTransaction'), false);
});

test('rejects signatures from another wallet and modifications to the approved payload', async () => {
  const wrongSigner = setup({
    signTransaction: async ({ unsignedTransaction }) => otherWallet.signTransaction(ethers.utils.parseTransaction(unsignedTransaction)),
  });
  const prepared = await wrongSigner.client.prepareTransfer(transfer);
  await assert.rejects(wrongSigner.client.signTransfer(prepared), /monad_test_wallet_signature_mismatch/);

  const changedNonce = setup({
    signTransaction: async ({ unsignedTransaction }) => wallet.signTransaction({
      ...ethers.utils.parseTransaction(unsignedTransaction), nonce: 8,
    }),
  });
  await assert.rejects(changedNonce.client.signTransfer(prepared), /monad_signed_transfer_payload_mismatch/);

  const { client, requests } = setup();
  const signed = await client.signTransfer(prepared);
  await assert.rejects(
    client.broadcastTransfer({ ...transfer, ...signed, destinationAddress: otherWallet.address }),
    /monad_transfer_payload_mismatch/,
  );
  assert.equal(requests.some(([method]) => method === 'sendTransaction'), false);
});

test('retry acknowledges the exact signed transaction only when its hash is found', async () => {
  const { client, provider, requests } = setup();
  const signed = await client.signTransfer(await client.prepareTransfer(transfer));
  provider.sendTransaction = async raw => {
    requests.push(['sendTransaction', raw]);
    throw new Error('nonce too low');
  };
  await assert.rejects(client.broadcastTransfer({ ...transfer, ...signed }), /monad_testnet_broadcast_unconfirmed/);

  provider.getTransaction = async hash => {
    assert.equal(hash, signed.txHash);
    return { hash };
  };
  assert.deepEqual(await client.broadcastTransfer({ ...transfer, ...signed }), { txHash: signed.txHash, alreadyKnown: true });
  assert.deepEqual(requests.filter(([method]) => method === 'sendTransaction'), [
    ['sendTransaction', signed.rawTransaction], ['sendTransaction', signed.rawTransaction],
  ]);
});

test('requires the payer wallet to cover gas and rejects a missing source token contract', async () => {
  const noGas = setup({ provider: { getBalance: async () => ethers.constants.Zero } });
  await assert.rejects(noGas.client.prepareTransfer(transfer), /insufficient_monad_test_wallet_gas/);

  const noToken = setup({ provider: { getCode: async () => '0x' } });
  await assert.rejects(noToken.client.prepareTransfer(transfer), /monad_test_token_has_no_code/);
});

test('rejects a token with a non-USDC denomination or a wallet balance below the exact transfer amount', async () => {
  const { client, provider, requests } = setup();
  const callToken = provider.call;
  provider.call = async input => {
    if (input.data === tokenInterface.getSighash('decimals')) return tokenInterface.encodeFunctionResult('decimals', [18]);
    return callToken(input);
  };
  await assert.rejects(client.prepareTransfer(transfer), /unexpected_monad_usdc_decimals/);

  provider.call = async input => {
    if (input.data === tokenInterface.getSighash('decimals')) return callToken(input);
    return tokenInterface.encodeFunctionResult('balanceOf', ['5749999']);
  };
  await assert.rejects(client.prepareTransfer(transfer), /insufficient_monad_test_wallet_token_balance/);
  assert.deepEqual(requests.map(([method]) => method), ['eth_chainId', 'eth_chainId']);
});
