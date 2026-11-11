import { publicJson } from './mxn-checkout-data.js';
import { checkoutError, FX_TTL_MS, TICKETS_MXN, units } from './mxn-checkout-quote.js';

const UNIT = 1_000_000n;
const BPS = 10_000n * UNIT;
const FX_MAX_FUTURE_MS = 5_000;
const INDICATIVE_TTL_MS = 30_000;
const POLYMARKET_BRIDGE = 'https://bridge.polymarket.com';
const CIRCLE_FEES = 'https://iris-api.circle.com/v2/burn/USDC/fees/7/19?forward=true&hyperCoreDeposit=true';
const HYPEREVM_RPC = 'https://rpc.hyperliquid.xyz/evm';
const CORE_DEPOSIT_WALLET = '0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24';
// calculateCrossChainWithdrawalFee(true, 7) uses Polygon's CCTP domain, not its chain ID.
const CORE_WITHDRAWAL_FEE_CALL = `0xe26f7d23${'1'.padStart(64, '0')}${'7'.padStart(64, '0')}`;
const POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const POLYGON_PUSD = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';
// Public address from the Polymarket quote example. No customer address or quote ID is used.
const QUOTE_EXAMPLE_RECIPIENT = '0x17eC161f126e82A8ba337f4022d574DBEaFef575';
const VENUE_ASSET = { hip4: 'USDC', polymarket: 'pUSD' };
const VENUE_ROUTE = {
  hip4: ['USDC (Polygon)', 'Circle CCTP', 'HyperCore spot (USDC)'],
  polymarket: ['USDC (Polygon)', 'Polymarket Bridge', 'Polymarket (pUSD)'],
};

function amount(asset, value) {
  const decimal = (value % UNIT).toString().padStart(6, '0').replace(/0+$/, '');
  return { asset, amount: `${value / UNIT}${decimal ? `.${decimal}` : ''}` };
}

function fee(type, asset, value, status, includedInEstimate) {
  return { type, asset, amount: value == null ? null : amount(asset, value).amount, status, includedInEstimate };
}

function missingFee(type, asset) {
  return fee(type, asset, null, 'unavailable', false);
}

function baseUnits(value) {
  const raw = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof raw !== 'string' || !/^(?:0|[1-9]\d{0,14})$/.test(raw)) throw checkoutError('provider_quote_unavailable');
  return BigInt(raw);
}

function usd(value, { zero = false } = {}) {
  const decimal = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toFixed(6) : value;
  return units(decimal, 'provider_quote_unavailable', { zero, max: 100_000n * UNIT });
}

function routeMinimum(asset, value, comparison) {
  return { ...amount(asset, value), comparison };
}

async function polyLeg(get, deposit, input) {
  const from = deposit ? POLYGON_USDC : POLYGON_PUSD;
  const to = deposit ? POLYGON_PUSD : POLYGON_USDC;
  const listing = await get(`${POLYMARKET_BRIDGE}/supported-assets`);
  const polygonAsset = address => listing?.supportedAssets?.filter(asset => String(asset.chainId) === '137'
    && asset.token?.address?.toLowerCase() === address.toLowerCase() && asset.token.decimals === 6);
  const source = polygonAsset(from);
  if (source?.length !== 1 || polygonAsset(to)?.length !== 1) throw checkoutError('provider_quote_unavailable');
  const minimum = usd(source[0].minCheckoutUsd);
  const providerMinimum = routeMinimum('USD', minimum, 'at_least');
  // Use stablecoin par for the estimate, then verify the bridge's USD valuation.
  if (input < minimum) return { providerMinimum, belowMinimum: true };
  const quoted = await get(`${POLYMARKET_BRIDGE}/quote`, {
    fromAmountBaseUnit: input.toString(), fromChainId: '137', fromTokenAddress: from,
    recipientAddress: QUOTE_EXAMPLE_RECIPIENT, toChainId: '137', toTokenAddress: to,
  });
  if (usd(quoted?.estInputUsd) < minimum) return { providerMinimum, belowMinimum: true };
  const output = baseUnits(quoted.estToTokenBaseUnit);
  const estimateMs = quoted.estCheckoutTimeMs;
  if (output <= 0n || output > input * 2n || !Number.isFinite(estimateMs) || estimateMs <= 0 || estimateMs > 86_400_000) {
    throw checkoutError('provider_quote_unavailable');
  }
  const fees = [];
  if (output <= input) fees.push(fee('polymarket_bridge_cost', deposit ? 'USDC' : 'pUSD', input - output, 'indicative', true));
  const gas = quoted.estFeeBreakdown?.gasUsd;
  fees.push(gas == null ? missingFee('polymarket_bridge_gas', 'USD')
    : fee('polymarket_bridge_gas', 'USD', usd(gas, { zero: true }), 'indicative', false));
  return { output, fees, providerMinimum, estimatedSeconds: Math.ceil(estimateMs / 1000) };
}

async function hyperCoreDeposit(get, input) {
  const rows = await get(CIRCLE_FEES);
  if (!Array.isArray(rows)) throw checkoutError('provider_quote_unavailable');
  const standard = rows.filter(row => row?.finalityThreshold === 2000);
  if (standard.length !== 1) throw checkoutError('provider_quote_unavailable');
  const { minimumFee, forwardFee } = standard[0];
  const bps = units(minimumFee, 'provider_quote_unavailable', { zero: true, max: BPS - 1n });
  const protocol = (input * bps + BPS - 1n) / BPS;
  const forwarding = baseUnits(forwardFee?.med ?? forwardFee?.medium);
  const fees = [fee('cctp_protocol', 'USDC', protocol, 'indicative', true),
    fee('cctp_forwarding', 'USDC', forwarding, 'indicative', true), missingFee('polygon_source_gas', 'USD')];
  // A transfer must retain at least one base unit after the fixed and rounded-up protocol fees.
  const netRate = BPS - bps;
  const minimum = ((forwarding + 1n) * BPS + netRate - 1n) / netRate;
  const providerMinimum = routeMinimum('USDC', minimum, 'at_least');
  if (input <= protocol + forwarding) return { providerMinimum, belowMinimum: true };
  return { output: input - protocol - forwarding, fees, providerMinimum };
}

async function hyperCoreWithdrawal(get, input) {
  const rpc = await get(HYPEREVM_RPC, {
    jsonrpc: '2.0', id: 1, method: 'eth_call',
    params: [{ to: CORE_DEPOSIT_WALLET, data: CORE_WITHDRAWAL_FEE_CALL }, 'latest'],
  });
  if (rpc?.id !== 1 || rpc.jsonrpc !== '2.0' || rpc.error || typeof rpc.result !== 'string'
    || !/^0x[0-9a-f]{64}$/i.test(rpc.result)) throw checkoutError('provider_quote_unavailable');
  const maximum = BigInt(rpc.result);
  if (maximum > 100_000n * UNIT) throw checkoutError('provider_quote_unavailable');
  const providerMinimum = routeMinimum('USDC', maximum, 'greater_than');
  if (input <= maximum) return { providerMinimum, belowMinimum: true };
  const output = input - maximum;
  return { output, outputWithActivation: output > UNIT ? output - UNIT : null, providerMinimum,
    fees: [fee('cctp_withdrawal_max', 'USDC', maximum, 'documented', true), missingFee('hypercore_withdrawal', 'USDC'),
      fee('hypercore_activation', 'USDC', UNIT, 'documented', false)] };
}

function mxnProceeds(input, rate) {
  // Round stablecoin debits down to a micro-unit and bank proceeds down to a whole centavo.
  return amount('MXN', (input * rate / (10_000n * UNIT)) * 10_000n);
}

export function createMxnFundingQuoteService({ fx, fetchImpl = globalThis.fetch, now = Date.now }) {
  const get = (url, body) => publicJson(fetchImpl, url, body);
  return {
    async quote({ venue, direction, ticketMxn }) {
      if (!Object.hasOwn(VENUE_ASSET, venue) || !['deposit', 'withdrawal'].includes(direction)
        || !TICKETS_MXN.includes(ticketMxn)) throw checkoutError('invalid_query');
      const deposit = direction === 'deposit';
      const collateral = VENUE_ASSET[venue];
      const route = ['SPEI', 'Bitso (MXN / USDC)', ...VENUE_ROUTE[venue]];
      const fees = [missingFee(deposit ? 'spei_in' : 'spei_out', 'MXN'), missingFee('bitso_conversion', 'MXN')];
      if (deposit) fees.push(missingFee('bitso_polygon_payout', 'USDC'));
      const result = {
        venue, direction, ticketMxn, status: 'unavailable', reason: 'fx_unavailable', executable: false,
        route: deposit ? route : route.reverse(), debit: deposit ? { asset: 'MXN', amount: String(ticketMxn) } : null,
        estimatedReceive: null, minimumReceive: null, providerMinimum: null, estimatedFirstWithdrawalReceive: null,
        fees, fxRate: null, fxSpreadMxn: null, expiresAt: null, estimatedSeconds: null, estimatedSecondsScope: null,
        pronosFeeMxn: '0', pronosSubsidyMxn: '0', costPayer: 'customer',
      };
      let rate;
      let input;
      let expires;
      try {
        const { bid, ask, timeMs } = await fx();
        const checkedAt = now();
        const bidRate = units(bid, 'invalid_fx');
        const askRate = units(ask, 'invalid_fx');
        expires = Math.min(checkedAt + INDICATIVE_TTL_MS, timeMs + FX_TTL_MS);
        if (!Number.isSafeInteger(timeMs) || timeMs > checkedAt + FX_MAX_FUTURE_MS
          || expires <= checkedAt || askRate < bidRate) return result;
        rate = deposit ? askRate : bidRate;
        input = BigInt(ticketMxn) * UNIT ** 2n / rate;
        result.fxRate = amount('MXN', rate).amount;
        result.fxSpreadMxn = amount('MXN', input * (askRate - bidRate) / (2n * UNIT)).amount;
        if (!deposit) result.debit = amount(collateral, input);
      } catch {
        return result;
      }
      result.reason = 'provider_quote_unavailable';
      try {
        const leg = venue === 'polymarket' ? await polyLeg(get, deposit, input)
          : await (deposit ? hyperCoreDeposit : hyperCoreWithdrawal)(get, input);
        if (now() >= expires) return { ...result, reason: 'fx_unavailable' };
        if (leg.belowMinimum) {
          return { ...result, status: 'below_minimum', reason: 'below_provider_minimum', providerMinimum: leg.providerMinimum };
        }
        return {
          ...result, status: 'indicative', reason: 'partner_quote_required', expiresAt: new Date(expires).toISOString(),
          estimatedReceive: deposit ? amount(collateral, leg.output) : mxnProceeds(leg.output, rate),
          estimatedFirstWithdrawalReceive: leg.outputWithActivation == null ? null : mxnProceeds(leg.outputWithActivation, rate),
          fees: [...fees, ...leg.fees], providerMinimum: leg.providerMinimum,
          estimatedSeconds: leg.estimatedSeconds ?? null, estimatedSecondsScope: leg.estimatedSeconds ? 'provider_leg' : null,
        };
      } catch {
        return result;
      }
    },
  };
}
