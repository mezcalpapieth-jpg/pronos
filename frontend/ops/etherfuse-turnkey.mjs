import { Turnkey } from '@turnkey/sdk-server';
import { ethers } from 'ethers';

export const MONAD_TESTNET_CHAIN_ID = 10143;
export const MONAD_TESTNET_RPC_URL = 'https://testnet-rpc.monad.xyz';

const ERC20 = new ethers.utils.Interface([
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);
const TURNKEY_API_URL = 'https://api.turnkey.com';

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`missing_${name}`);
  return value;
}

function address(value, field) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value)) throw new Error(`invalid_${field}`);
  const normalized = ethers.utils.getAddress(value.toLowerCase());
  if (normalized === ethers.constants.AddressZero) throw new Error(`invalid_${field}`);
  return normalized;
}

function transferFields({ tokenAddress, destinationAddress, amountUnits }) {
  if (typeof amountUnits !== 'string' || !/^[1-9]\d{0,77}$/.test(amountUnits)
    || ethers.BigNumber.from(amountUnits).gt(ethers.constants.MaxUint256)) {
    throw new Error('invalid_monad_transfer_amount');
  }
  const token = address(tokenAddress, 'monad_token_address');
  const destination = address(destinationAddress, 'monad_destination_address');
  return {
    tokenAddress: token,
    destinationAddress: destination,
    amountUnits,
    data: ERC20.encodeFunctionData('transfer', [destination, amountUnits]),
  };
}

function rpcUrl(env) {
  const url = new URL(env.ETHERFUSE_MONAD_TESTNET_RPC_URL?.trim() || MONAD_TESTNET_RPC_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('invalid_monad_testnet_rpc_url');
  }
  return url.href;
}

function normalizeSignedHex(value) {
  if (typeof value !== 'string' || !/^(0x)?(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new Error('invalid_monad_signed_transaction');
  }
  return value.startsWith('0x') ? value : `0x${value}`;
}

function checkTransferTransaction(transaction, transfer) {
  if (transaction.type !== 2 || transaction.chainId !== MONAD_TESTNET_CHAIN_ID
    || transaction.to !== transfer.tokenAddress || transaction.data !== transfer.data
    || !transaction.value.isZero() || transaction.accessList?.length !== 0
    || !transaction.gasLimit.gt(0) || !transaction.maxFeePerGas?.gt(0)
    || !transaction.maxPriorityFeePerGas || transaction.maxPriorityFeePerGas.gt(transaction.maxFeePerGas)) {
    throw new Error('monad_transfer_payload_mismatch');
  }
}

function unsignedPayload(transaction) {
  return ethers.utils.serializeTransaction({
    type: transaction.type,
    chainId: transaction.chainId,
    nonce: transaction.nonce,
    to: transaction.to,
    value: transaction.value,
    data: transaction.data,
    gasLimit: transaction.gasLimit,
    maxFeePerGas: transaction.maxFeePerGas,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    accessList: transaction.accessList,
  });
}

function turnkeySigner(env) {
  const organizationId = requiredEnv(env, 'ETHERFUSE_TEST_TURNKEY_SUBORG_ID');
  const api = new Turnkey({
    apiBaseUrl: TURNKEY_API_URL,
    defaultOrganizationId: organizationId,
    apiPublicKey: requiredEnv(env, 'ETHERFUSE_TEST_TURNKEY_API_PUBLIC_KEY'),
    apiPrivateKey: requiredEnv(env, 'ETHERFUSE_TEST_TURNKEY_API_PRIVATE_KEY'),
  }).apiClient();
  return async ({ signWith, unsignedTransaction }) => {
    const result = await api.signTransaction({
      organizationId,
      signWith,
      type: 'TRANSACTION_TYPE_ETHEREUM',
      unsignedTransaction: unsignedTransaction.slice(2),
    });
    return result.signedTransaction;
  };
}

export function createMonadTestnetTransferClient({ env = process.env, provider, signTransaction } = {}) {
  const walletAddress = address(requiredEnv(env, 'ETHERFUSE_TEST_WALLET_ADDRESS'), 'monad_test_wallet_address');
  const rpc = provider ?? new ethers.providers.StaticJsonRpcProvider(rpcUrl(env), MONAD_TESTNET_CHAIN_ID);

  async function checkChain() {
    // A static provider's getNetwork() returns the configured network. Read the actual RPC chain ID.
    const chainId = await rpc.send('eth_chainId', []);
    if (typeof chainId !== 'string' || !/^0x[0-9a-f]+$/i.test(chainId)
      || !ethers.BigNumber.from(chainId).eq(MONAD_TESTNET_CHAIN_ID)) {
      throw new Error('monad_testnet_chain_mismatch');
    }
  }

  function checkSignedTransaction(rawTransaction, transfer) {
    const signed = ethers.utils.parseTransaction(rawTransaction);
    checkTransferTransaction(signed, transfer);
    if (signed.from !== walletAddress || !signed.hash) throw new Error('monad_test_wallet_signature_mismatch');
    return signed;
  }

  async function prepareTransfer(input) {
    const { data, ...transfer } = transferFields(input);
    await checkChain();
    const [nonce, feeData, tokenCode, gasBalance] = await Promise.all([
      rpc.getTransactionCount(walletAddress, 'pending'),
      rpc.getFeeData(),
      rpc.getCode(transfer.tokenAddress),
      rpc.getBalance(walletAddress, 'pending'),
    ]);
    if (tokenCode === '0x') throw new Error('monad_test_token_has_no_code');
    const [decimalsResult, balanceResult] = await Promise.all([
      rpc.call({ to: transfer.tokenAddress, data: ERC20.encodeFunctionData('decimals') }),
      rpc.call({ to: transfer.tokenAddress, data: ERC20.encodeFunctionData('balanceOf', [walletAddress]) }),
    ]);
    const [decimals] = ERC20.decodeFunctionResult('decimals', decimalsResult);
    if (decimals !== 6) throw new Error('unexpected_monad_usdc_decimals');
    const [tokenBalance] = ERC20.decodeFunctionResult('balanceOf', balanceResult);
    if (tokenBalance.lt(transfer.amountUnits)) throw new Error('insufficient_monad_test_wallet_token_balance');
    const { maxFeePerGas, maxPriorityFeePerGas } = feeData;
    if (!maxFeePerGas?.gt(0) || !maxPriorityFeePerGas || maxPriorityFeePerGas.gt(maxFeePerGas)) {
      throw new Error('missing_monad_eip1559_fee');
    }
    const call = { to: transfer.tokenAddress, data, value: 0 };
    const gasLimit = await rpc.estimateGas({ ...call, from: walletAddress });
    if (gasBalance.lt(gasLimit.mul(maxFeePerGas))) throw new Error('insufficient_monad_test_wallet_gas');
    const unsignedTransaction = ethers.utils.serializeTransaction({
      ...call,
      type: 2,
      chainId: MONAD_TESTNET_CHAIN_ID,
      nonce,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
    return { ...transfer, walletAddress, unsignedTransaction };
  }

  async function signTransfer(prepared) {
    const transfer = transferFields(prepared);
    const { unsignedTransaction } = prepared;
    const unsigned = ethers.utils.parseTransaction(unsignedTransaction);
    checkTransferTransaction(unsigned, transfer);
    if (prepared.walletAddress !== walletAddress || unsigned.from || unsignedPayload(unsigned) !== unsignedTransaction) {
      throw new Error('monad_unsigned_transfer_payload_mismatch');
    }
    await checkChain();
    const sign = signTransaction ?? turnkeySigner(env);
    const rawTransaction = normalizeSignedHex(await sign({ signWith: walletAddress, unsignedTransaction }));
    const signed = checkSignedTransaction(rawTransaction, transfer);
    if (unsignedPayload(signed) !== unsignedTransaction) throw new Error('monad_signed_transfer_payload_mismatch');
    return { rawTransaction, txHash: signed.hash };
  }

  async function broadcastTransfer({ rawTransaction, ...input }) {
    const raw = normalizeSignedHex(rawTransaction);
    const signed = checkSignedTransaction(raw, transferFields(input));
    await checkChain();
    let result;
    try {
      result = await rpc.sendTransaction(raw);
    } catch (error) {
      // Retrying accepted bytes can return "already known" or "nonce too low".
      // Confirm the exact transaction by hash before treating either as a success.
      const existing = await rpc.getTransaction(signed.hash).catch(() => null);
      if (existing?.hash === signed.hash) return { txHash: signed.hash, alreadyKnown: true };
      throw new Error('monad_testnet_broadcast_unconfirmed', { cause: error });
    }
    if (result?.hash !== signed.hash) throw new Error('monad_broadcast_hash_mismatch');
    return { txHash: signed.hash, alreadyKnown: false };
  }

  return { walletAddress, prepareTransfer, signTransfer, broadcastTransfer };
}
