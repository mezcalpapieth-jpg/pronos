import { encode } from '@msgpack/msgpack';
import { Wallet, utils } from 'ethers';

const API = 'https://api.hyperliquid-testnet.xyz';
const BUILDER = '0x040fe3673b6bded15d949eefccf3509a2284cd04';
const FEE_TENTHS_BPS = 250;
const AGENT_TTL_MS = 30 * 60 * 1000;
const ZERO = '0x0000000000000000000000000000000000000000';
const USDC_SYSTEM_ADDRESS = '0x2000000000000000000000000000000000000000';
const USER_DOMAIN = {
  name: 'HyperliquidSignTransaction', version: '1', chainId: 421614, verifyingContract: ZERO,
};
const ORDER_DOMAIN = { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: ZERO };
const ORDER_TYPES = { Agent: [
  { name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' },
] };
const USER_ACTIONS = {
  approveAgent: ['ApproveAgent', { agentAddress: 'address', agentName: 'string', nonce: 'uint64' }],
  approveBuilderFee: ['ApproveBuilderFee', { maxFeeRate: 'string', builder: 'address', nonce: 'uint64' }],
  sendAsset: ['SendAsset', {
    destination: 'string', sourceDex: 'string', destinationDex: 'string',
    token: 'string', amount: 'string', fromSubAccount: 'string', nonce: 'uint64',
  }],
};

function normalizeAddress(value) {
  if (typeof value !== 'string' || !utils.isAddress(value) || value.toLowerCase() === ZERO) {
    throw new Error('Enter a valid wallet address.');
  }
  return utils.getAddress(value).toLowerCase();
}

function decimal(value, precision, label) {
  const raw = String(value).trim();
  if (!/^\d{1,8}(?:\.\d{1,8})?$/.test(raw)) throw new Error(`Invalid ${label}.`);
  const [whole, fraction = ''] = raw.split('.');
  const trailing = fraction.replace(/0+$/, '');
  if (trailing.length > precision || Number(raw) <= 0) throw new Error(`Invalid ${label}.`);
  return String(Number(whole)) + (trailing ? `.${trailing}` : '');
}

async function post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HyperCore testnet returned HTTP ${res.status}.`);
  return res.json();
}

function userPayload(type, fields) {
  const [primary, schema] = USER_ACTIONS[type];
  const message = { hyperliquidChain: 'Testnet', ...fields };
  const types = { [`HyperliquidTransaction:${primary}`]: Object.entries({
    hyperliquidChain: 'string', ...schema,
  }).map(([name, fieldType]) => ({ name, type: fieldType })) };
  return {
    action: { type, signatureChainId: '0x66eee', ...message },
    domain: USER_DOMAIN,
    types,
    message,
  };
}

function split(signature) {
  const { r, s, v } = utils.splitSignature(signature);
  return { r, s, v };
}

async function turnkeySign(input) {
  const { signPointsWalletTypedData } = await import('./pointsAuth.js');
  return signPointsWalletTypedData(input);
}

export function createHip4Pilot({ address, suborgId }, {
  request = post, sign = turnkeySign, now = Date.now,
} = {}) {
  const user = normalizeAddress(address);
  let agent;
  let nonce = 0;
  const nextNonce = () => { nonce = Math.max(now(), nonce + 1); return nonce; };
  const info = (type, fields = {}) => request('/info', { type, ...fields });
  const role = target => info('userRole', { user: target });
  const balance = () => info('spotClearinghouseState', { user });
  const cap = () => info('maxBuilderFee', { user, builder: BUILDER });
  async function hasAgent() {
    if (!agent || agent.expiration <= now()) return false;
    const agents = await info('extraAgents', { user });
    return agents.some(entry => entry.address?.toLowerCase() === agent.wallet.address.toLowerCase()
      && (entry.validUntil == null || entry.validUntil > now()));
  }

  async function submit(payload, id) {
    let response;
    try {
      response = await request('/exchange', payload);
    } catch {
      throw new Error(`Submission status is unknown (reference ${id}). Check HyperCore before retrying.`);
    }
    if (response.status !== 'ok') throw new Error(String(response.response || 'HyperCore rejected the action.'));
    return response;
  }

  async function ownerAction(type, fields, timestamp) {
    const { action, domain, types, message } = userPayload(type, fields);
    const payload = utils._TypedDataEncoder.getPayload(domain, types, message);
    const signature = await sign({ address: user, suborgId, payload });
    if (utils.verifyTypedData(domain, types, message, signature).toLowerCase() !== user) {
      throw new Error('Turnkey signature does not match the signed-in wallet.');
    }
    return submit({ action, nonce: timestamp, signature: split(signature) }, timestamp);
  }

  async function status() {
    const [account, spot, fee, agentApproved] = await Promise.all([role(user), balance(), cap(), hasAgent()]);
    const usdc = spot.balances.find(item => item.coin === 'USDC');
    const available = usdc ? utils.parseUnits(usdc.total, 8).sub(utils.parseUnits(usdc.hold, 8)) : 0;
    return {
      activated: account.role === 'user',
      usdc: utils.formatUnits(available, 8),
      agentApproved,
      builderApproved: Number(fee) >= FEE_TENTHS_BPS,
      builderAddress: BUILDER,
    };
  }

  return {
    status,
    async enableTrading({ onProgress } = {}) {
      const state = await status();
      if (!state.activated) throw new Error('Fund this HyperCore testnet wallet first.');
      if (!state.agentApproved) {
        onProgress?.('agent');
        if (!agent || agent.expiration <= now()) {
          agent = {
            wallet: new Wallet(utils.hexlify(utils.randomBytes(32))),
            expiration: now() + AGENT_TTL_MS,
          };
        }
        const timestamp = nextNonce();
        await ownerAction('approveAgent', {
          agentAddress: agent.wallet.address.toLowerCase(),
          agentName: `pronos-hip4 valid_until ${agent.expiration}`,
          nonce: timestamp,
        }, timestamp);
      }
      if (!state.builderApproved) {
        onProgress?.('builder');
        const timestamp = nextNonce();
        await ownerAction('approveBuilderFee', {
          maxFeeRate: '0.25%', builder: BUILDER, nonce: timestamp,
        }, timestamp);
      }
      return status();
    },
    async order({ coin, side, price, size }) {
      if (!/^#[1-9]\d{0,7}[01]$/.test(coin) || !['buy', 'sell'].includes(side)) {
        throw new Error('Enter a binary HIP-4 outcome coin and a buy or sell direction.');
      }
      const p = decimal(price, 5, 'limit price');
      const s = decimal(size, 0, 'share count');
      if (Number(p) >= 1 || Number(s) > 250 || (side === 'buy' && Number(p) * Number(s) > 25)) {
        throw new Error('The pilot accepts prices below 1, up to 250 shares and up to 25 test USDC per buy.');
      }
      const encoding = Number(coin.slice(1));
      const [approved, fee, meta, perps, abstraction] = await Promise.all([
        hasAgent(), cap(), info('outcomeMeta'), info('clearinghouseState', { user: BUILDER }),
        info('userAbstraction', { user: BUILDER }),
      ]);
      if (!approved || Number(fee) < FEE_TENTHS_BPS) throw new Error('Complete both approvals first.');
      if (!['default', 'disabled'].includes(abstraction) || Number(perps.marginSummary.accountValue) < 100) {
        throw new Error('The Pronos testnet builder needs at least 100 test USDC of Standard perps account value.');
      }
      const market = meta.outcomes.find(item => item.outcome === Math.floor(encoding / 10));
      if (market?.quoteToken !== 'USDC' || market.sideSpecs?.length !== 2) {
        throw new Error('Choose a listed binary testnet HIP-4 market quoted in USDC.');
      }
      const cloid = utils.hexlify(utils.randomBytes(16));
      const action = {
        type: 'order',
        orders: [{ a: 100_000_000 + encoding, b: side === 'buy', p, s, r: false, t: { limit: { tif: 'Ioc' } }, c: cloid }],
        grouping: 'na',
        builder: { b: BUILDER, f: FEE_TENTHS_BPS },
      };
      const timestamp = nextNonce();
      const expiresAfter = timestamp + 15000;
      // Match the official SDK's MessagePack action and nonce/vault/expiry suffix.
      const suffix = new Uint8Array(18);
      const view = new DataView(suffix.buffer);
      view.setBigUint64(0, BigInt(timestamp));
      view.setBigUint64(10, BigInt(expiresAfter));
      const connectionId = utils.keccak256(utils.concat([encode(action), suffix]));
      const signature = await agent.wallet._signTypedData(ORDER_DOMAIN, ORDER_TYPES, { source: 'b', connectionId });
      const response = await submit({ action, nonce: timestamp, expiresAfter, signature: split(signature) }, cloid);
      return { ...response, cloid };
    },
    async withdraw({ amount }) {
      // Native Circle USDC on HyperEVM uses six decimals and is credited to the same wallet.
      const quantity = decimal(amount, 6, 'USDC amount');
      const [account, spot] = await Promise.all([role(user), balance()]);
      const usdc = spot.balances.find(item => item.coin === 'USDC');
      if (account.role !== 'user') throw new Error('Fund this HyperCore testnet wallet first.');
      if (!usdc || utils.parseUnits(quantity, 8).gt(utils.parseUnits(usdc.total, 8).sub(utils.parseUnits(usdc.hold, 8)))) {
        throw new Error('The withdrawal exceeds available testnet USDC.');
      }
      const timestamp = nextNonce();
      const response = await ownerAction('sendAsset', {
        destination: USDC_SYSTEM_ADDRESS, sourceDex: 'spot', destinationDex: 'spot',
        token: 'USDC', amount: quantity, fromSubAccount: '', nonce: timestamp,
      }, timestamp);
      return { ...response, nonce: timestamp };
    },
  };
}
