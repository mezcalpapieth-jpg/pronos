import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkoutData } from '../api/_lib/mxn-checkout-data.js';
import { FX_TTL_MS, TICKETS_MXN, units } from '../api/_lib/mxn-checkout-quote.js';
import { createEtherfuseSandboxClient } from './etherfuse-client.mjs';
import { createMonadTestnetTransferClient } from './etherfuse-turnkey.mjs';

const SANDBOX_CAP_MXN = 500;
const TEST_CLABE = '012180000000000002';
const TEST_RFC = 'XAXX010101000';
const ONE = 1_000_000n;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const TERMINAL = new Set(['completed', 'failed', 'canceled', 'refunded']);
const defaultPause = ms => new Promise(ready => setTimeout(ready, ms));

function requireValue(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

function formatAmount(raw) {
  const remainder = (raw % ONE).toString().padStart(6, '0').replace(/0+$/, '');
  return remainder ? `${raw / ONE}.${remainder}` : String(raw / ONE);
}

function amount(value) {
  requireValue(typeof value === 'string', 'invalid_provider_amount');
  return units(value, 'invalid_provider_amount');
}

function sameAsset(left, right) {
  return typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
}

function checkFees(fees) {
  requireValue(Array.isArray(fees) && fees.every(fee => typeof fee?.type === 'string' &&
    (fee.type !== 'partnerFee' || units(fee.amount, 'unexpected_partner_fee', { zero: true }) === 0n) &&
    !['walletSponsor', 'walletSigning'].includes(fee.type)), 'unexpected_fee_or_sponsorship');
  return fees.map(({ type, asset, amount, bps }) => ({ type, asset, amount, bps }));
}

function checkOrder(order, position) {
  const { quote, request, orgId } = position;
  requireValue(order?.id === quote.quoteId && order.organizationId === orgId &&
    order.source?.paymentAccountId === request.source.id && order.destination?.paymentAccountId === request.destination.id &&
    sameAsset(order.source.asset, request.sourceAsset) && sameAsset(order.destination.asset, request.destinationAsset) &&
    order.source.rail === request.sourceRail && order.destination.rail === request.destinationRail &&
    amount(order.source.amount) === amount(quote.sourceAmount) &&
    amount(order.destination.amount) === amount(quote.destinationAmount), 'order_does_not_match_quote');
  checkFees(order.fees);
  return order;
}

function describeOrder(order, signedTxHash, submittedTxHash) {
  return {
    orderId: order.id, status: order.status, completedAt: order.completedAt,
    source: { asset: order.source.asset, amount: order.source.amount, rail: order.source.rail },
    destination: { asset: order.destination.asset, amount: order.destination.amount, rail: order.destination.rail },
    fees: checkFees(order.fees), signedTransactionHash: signedTxHash ?? null,
    submittedTransactionHash: submittedTxHash ?? null,
    ...(order.failure ? { failureCode: order.failure.code } : {}),
  };
}

function ready(account, rail, direction) {
  const status = account?.rails?.[rail]?.[direction]?.status;
  requireValue(!['rejected', 'disabled'].includes(status) && account?.status !== 'disabled', 'payment_account_rejected');
  return status === 'ready';
}

export function createSandboxWorkflow({ api, walletAddress, fx = checkoutData().fx, now = Date.now, pause = defaultPause }) {
  requireValue(typeof walletAddress === 'string' && ADDRESS.test(walletAddress), 'invalid_turnkey_test_wallet_address');
  const wallet = walletAddress.toLowerCase();

  async function waitFor(poll, accept, code) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const value = await poll();
      if (accept(value)) return value;
      if (attempt < 29) await pause(2_000);
    }
    throw Object.assign(new Error(code), { code });
  }

  async function accountReady(orgId, accountId, rail, kind) {
    return waitFor(() => api.account(orgId, accountId), row =>
      row?.id === accountId && row.kind === kind && ready(row, rail, 'source') && ready(row, rail, 'destination'),
    'payment_account_not_ready');
  }

  async function order(position) {
    const result = await api.order(position.orgId, position.quote.quoteId);
    return checkOrder(result, position);
  }

  function fundingOpen(current) {
    requireValue(current.status === 'created' && Date.parse(current.fundingInstructions?.fundingDeadline) > now(),
      'order_not_open_for_funding');
  }

  async function instructions(position) {
    return waitFor(() => order(position), current => current.status !== 'created' ||
      current.fundingInstructions?.destination != null, 'funding_instructions_pending');
  }

  return {
    async setup(configuredOrgId) {
      const orgId = configuredOrgId ?? (await api.org()).id;
      requireValue(UUID.test(orgId ?? ''), 'invalid_etherfuse_organization');
      const bankRequest = {
        kind: 'bank', label: 'Pronos sandbox SPEI', country: 'MX', currency: 'MXN',
        accountDetails: { kind: 'clabe', clabe: TEST_CLABE },
      };
      let bank;
      try {
        bank = await api.registerAccount(orgId, bankRequest);
      } catch (error) {
        if (error.code !== 'registration-info-required') throw error;
        const sandboxHolder = {
          '#/registrationInfo/accountHolderName': ['accountHolderName', 'Ejemplo Comercial SA de CV'],
          '#/registrationInfo/taxId': ['taxId', TEST_RFC],
        };
        const missing = error.missing ?? [];
        if (!missing.length || missing.some(field => !Object.hasOwn(sandboxHolder, field))) throw error;
        bank = await api.registerAccount(orgId, { ...bankRequest,
          registrationInfo: Object.fromEntries(missing.map(field => sandboxHolder[field])) });
      }
      const account = await api.registerAccount(orgId, {
        kind: 'wallet', label: 'Pronos Turnkey test wallet', accountDetails: { kind: 'address', address: wallet, chain: 'monad' },
      });
      requireValue(UUID.test(bank?.id ?? '') && UUID.test(account?.id ?? ''), 'invalid_payment_account');
      await Promise.all([accountReady(orgId, bank.id, 'spei', 'bank'), accountReady(orgId, account.id, 'monad', 'wallet')]);
      return { orgId, bankId: bank.id, walletId: account.id, wallet };
    },

    async quote(accounts, direction, ticketMxn) {
      requireValue(accounts.wallet === wallet, 'sandbox_wallet_binding_mismatch');
      requireValue(TICKETS_MXN.includes(ticketMxn) && ['deposit', 'withdrawal'].includes(direction), 'invalid_ticket');
      const deposit = direction === 'deposit';
      const { tokens } = await api.assets(accounts.orgId, accounts.walletId);
      const usdc = tokens?.filter(token => token.chain === 'monad' && token.symbol === 'USDC' && token.currency === 'USD');
      requireValue(usdc?.length === 1 && ADDRESS.test(usdc[0].asset), 'monad_testnet_usdc_unavailable');
      const asset = usdc[0].asset;
      let sourceAmount = String(ticketMxn);
      let referenceMxnPerUsd = null;
      if (!deposit) {
        const rate = await fx();
        requireValue(Number.isSafeInteger(rate.timeMs) && rate.timeMs <= now() + 5_000 && now() - rate.timeMs < FX_TTL_MS,
          'stale_mxn_reference_rate');
        // The ticket is a gross MXN equivalent. Etherfuse prices the actual MXN payout from the USDC input.
        referenceMxnPerUsd = rate.bid;
        sourceAmount = formatAmount(BigInt(ticketMxn) * ONE * ONE / units(rate.bid, 'invalid_mxn_reference_rate'));
      }
      const request = {
        source: { type: 'stored', id: deposit ? accounts.bankId : accounts.walletId },
        destination: { type: 'stored', id: deposit ? accounts.walletId : accounts.bankId },
        sourceAmount, sourceAsset: deposit ? 'MXN' : asset, destinationAsset: deposit ? asset : 'MXN',
        sourceRail: deposit ? 'spei' : 'monad', destinationRail: deposit ? 'monad' : 'spei', partnerFeeBpsOverride: 0,
      };
      const quote = await api.quote(accounts.orgId, request);
      requireValue(!(deposit && ticketMxn > SANDBOX_CAP_MXN), 'sandbox_deposit_cap_changed');
      requireValue(UUID.test(quote?.quoteId ?? '') && amount(quote.sourceAmount) === amount(sourceAmount) &&
        amount(quote.destinationAmount) > 0n && sameAsset(quote.sourceAsset, request.sourceAsset) &&
        sameAsset(quote.destinationAsset, request.destinationAsset) && quote.sourceRail === request.sourceRail &&
        quote.destinationRail === request.destinationRail && Date.parse(quote.expiresAt) > now(), 'invalid_sandbox_quote');
      quote.fees = checkFees(quote.fees);
      return { orgId: accounts.orgId, wallet, direction, ticketMxn, referenceMxnPerUsd, request, quote };
    },

    async open(position) {
      requireValue(position.wallet === wallet, 'sandbox_wallet_binding_mismatch');
      requireValue(position.ticketMxn <= SANDBOX_CAP_MXN, 'quote_only_ticket');
      try {
        return checkOrder(await api.createOrder(position.orgId, position.quote.quoteId), position);
      } catch (error) {
        if (error.code !== 'conflict') throw error;
        return order(position);
      }
    },

    order,

    async settle(position) {
      return waitFor(() => order(position), current => TERMINAL.has(current.status), 'sandbox_order_pending');
    },

    async simulateDeposit(position, sendOnce) {
      requireValue(position.wallet === wallet && position.direction === 'deposit', 'not_a_deposit');
      const current = await instructions(position);
      if (current.status === 'created') {
        fundingOpen(current);
        requireValue(current.fundingInstructions.rail === 'spei' && /^\d{18}$/.test(current.fundingInstructions.destination.clabe),
          'invalid_spei_instructions');
        await sendOnce(() => api.simulateDeposit(position.orgId, current.id, current.source.amount));
      }
    },

    async cashOutTransfer(position) {
      requireValue(position.wallet === wallet && position.direction === 'withdrawal', 'not_a_cash_out');
      const current = await instructions(position);
      if (current.status !== 'created') return null;
      fundingOpen(current);
      const { rail, destination } = current.fundingInstructions;
      requireValue(rail === 'monad' && ADDRESS.test(destination.address ?? '') && (destination.expiresAt === null ||
        Date.parse(destination.expiresAt) > now()), 'invalid_monad_funding_instructions');
      return { tokenAddress: position.request.sourceAsset, destinationAddress: destination.address,
        amountUnits: amount(current.source.amount).toString() };
    },
  };
}

async function maybeRead(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function writeNew(path, body) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(body));
      await file.sync();
    } finally { await file.close(); }
    await link(temporary, path);
  } finally { await unlink(temporary); }
}

async function locked(path, action) {
  try {
    await writeNew(path, { pid: process.pid });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    requireValue(false, 'sandbox_operation_locked');
  }
  try { return await action(); } finally { await unlink(path); }
}

export async function main([command, argument, amountMxn, ...extra], env = process.env) {
  const simple = ['setup'].includes(command) && argument === undefined;
  const quote = command === 'quote' && ['deposit', 'withdrawal'].includes(argument) && TICKETS_MXN.map(String).includes(amountMxn);
  const order = ['open', 'simulate-deposit', 'fund-cash-out', 'status'].includes(command) && UUID.test(argument ?? '') && amountMxn === undefined;
  requireValue(extra.length === 0 && (simple || quote || order), 'usage: setup | quote deposit|withdrawal 100|300|1000 | open|simulate-deposit|fund-cash-out|status <order-id>');
  const api = createEtherfuseSandboxClient({ apiKey: env.ETHERFUSE_SANDBOX_API_KEY });
  const walletAddress = env.ETHERFUSE_TEST_WALLET_ADDRESS;
  const flow = createSandboxWorkflow({ api, walletAddress });
  const directory = resolve(env.ETHERFUSE_SANDBOX_STATE_DIR ?? 'experiments/hip4/.local-etherfuse', walletAddress.toLowerCase());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const bindingPath = resolve(directory, 'accounts.json');
  const accounts = await maybeRead(bindingPath);
  if (simple) {
    if (accounts) return { ...accounts, reused: true };
    const binding = await flow.setup(env.ETHERFUSE_SANDBOX_ORGANIZATION_ID);
    await writeNew(bindingPath, binding);
    return binding;
  }
  requireValue(accounts?.wallet === walletAddress.toLowerCase() && (!env.ETHERFUSE_SANDBOX_ORGANIZATION_ID ||
    accounts.orgId === env.ETHERFUSE_SANDBOX_ORGANIZATION_ID), 'run_sandbox_setup');
  if (quote) {
    const position = await flow.quote(accounts, argument, Number(amountMxn));
    await writeNew(resolve(directory, `${position.quote.quoteId}.quote.json`), position);
    return { ...position.quote, ticketMxn: position.ticketMxn, referenceMxnPerUsd: position.referenceMxnPerUsd,
      pronosFeeMxn: '0', pronosSubsidyMxn: '0', gasPayer: argument === 'withdrawal' ? 'wallet' : null };
  }
  const id = argument.toLowerCase();
  const position = await maybeRead(resolve(directory, `${id}.quote.json`));
  requireValue(position?.orgId === accounts.orgId && position?.wallet === accounts.wallet && position?.quote?.quoteId === id,
    'quote_not_found_for_wallet');
  if (command === 'open') return describeOrder(await flow.open(position));
  const signedPath = resolve(directory, `${id}.transfer.json`);
  const submittedPath = resolve(directory, `${id}.submitted.json`);
  const describeCurrent = async current => describeOrder(current, (await maybeRead(signedPath))?.txHash,
    (await maybeRead(submittedPath))?.txHash);
  if (command === 'status') return describeCurrent(await flow.order(position));
  if (command === 'simulate-deposit') {
    await locked(resolve(directory, `${id}.deposit.lock`), () => flow.simulateDeposit(position, async send => {
      const marker = resolve(directory, `${id}.simulated.json`);
      if (await maybeRead(marker)) return;
      await writeNew(marker, { orderId: id });
      try {
        await send();
      } catch (error) {
        // A timeout or gateway failure can occur after Etherfuse accepted the deposit.
        if (error.status >= 400 && error.status < 500 && error.status !== 408) await unlink(marker);
        throw error;
      }
    }));
    return describeOrder(await flow.settle(position));
  }
  await locked(resolve(directory, 'turnkey-transfer.lock'), async () => {
    if (await maybeRead(submittedPath)) return;
    const transfer = await flow.cashOutTransfer(position);
    if (!transfer) return;
    const signer = createMonadTestnetTransferClient({ env });
    let signed = await maybeRead(signedPath);
    if (!signed) {
      signed = await signer.signTransfer(await signer.prepareTransfer(transfer));
      await writeNew(signedPath, signed);
    }
    const latest = await flow.cashOutTransfer(position);
    if (!latest) return;
    requireValue(latest.destinationAddress.toLowerCase() === transfer.destinationAddress.toLowerCase() &&
      latest.tokenAddress === transfer.tokenAddress && latest.amountUnits === transfer.amountUnits,
    'sandbox_funding_instructions_changed');
    const submitted = await signer.broadcastTransfer({ ...transfer, rawTransaction: signed.rawTransaction });
    await writeNew(submittedPath, { txHash: submitted.txHash });
  });
  return describeCurrent(await flow.settle(position));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2));
  } catch (error) {
    const code = error?.code ?? '';
    const signerCode = /^(?:missing_ETHERFUSE_TEST_|(?:invalid_|unexpected_|insufficient_|missing_)?monad_)[a-z0-9_]{1,80}$/i;
    console.error(/^[a-z0-9_-]{1,80}$/i.test(code) || code.startsWith('usage:') ? code
      : signerCode.test(error?.message ?? '') ? error.message : 'etherfuse_sandbox_failed');
    process.exitCode = 1;
  }
}
