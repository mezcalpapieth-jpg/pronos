let junoFundingSchemaReady = false;

export const JUNO_FUNDING_SCHEMA_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS juno_funding_accounts (
    id                              SERIAL PRIMARY KEY,
    turnkey_sub_org_id              TEXT UNIQUE NOT NULL REFERENCES points_users(turnkey_sub_org_id) ON DELETE CASCADE,
    wallet_address                  TEXT NOT NULL,
    clabe                           TEXT UNIQUE,
    juno_account_id                 TEXT,
    blockchain_account_registered   BOOLEAN NOT NULL DEFAULT false,
    kyc_status                      TEXT NOT NULL DEFAULT 'unknown',
    provider                        TEXT NOT NULL DEFAULT 'juno',
    last_deposit_status             TEXT,
    last_withdrawal_status          TEXT,
    last_juno_transaction_id        TEXT,
    created_at                      TIMESTAMPTZ DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_juno_funding_accounts_wallet ON juno_funding_accounts(wallet_address)`,
  `CREATE INDEX IF NOT EXISTS idx_juno_funding_accounts_clabe ON juno_funding_accounts(clabe)`,
  `CREATE TABLE IF NOT EXISTS juno_transaction_events (
    id                    SERIAL PRIMARY KEY,
    provider              TEXT NOT NULL DEFAULT 'juno',
    provider_event_id     TEXT,
    event_type            TEXT,
    transaction_type      TEXT,
    transaction_status    TEXT,
    turnkey_sub_org_id    TEXT,
    wallet_address        TEXT,
    clabe                 TEXT,
    amount                NUMERIC(30,6),
    asset                 TEXT,
    network               TEXT,
    tx_hash               TEXT,
    external_ref          TEXT,
    raw_event             JSONB NOT NULL,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider, provider_event_id, transaction_status)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_juno_transaction_events_suborg ON juno_transaction_events(turnkey_sub_org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_juno_transaction_events_wallet ON juno_transaction_events(wallet_address)`,
  `CREATE INDEX IF NOT EXISTS idx_juno_transaction_events_clabe ON juno_transaction_events(clabe)`,
  `CREATE INDEX IF NOT EXISTS idx_juno_transaction_events_tx_hash ON juno_transaction_events(tx_hash)`,
  `CREATE TABLE IF NOT EXISTS juno_withdrawal_requests (
    id                    SERIAL PRIMARY KEY,
    turnkey_sub_org_id    TEXT NOT NULL REFERENCES points_users(turnkey_sub_org_id) ON DELETE CASCADE,
    wallet_address        TEXT NOT NULL,
    destination_clabe     TEXT,
    destination_name      TEXT,
    amount                NUMERIC(30,6) NOT NULL,
    asset                 TEXT NOT NULL DEFAULT 'MXNB',
    status                TEXT NOT NULL DEFAULT 'pending',
    provider              TEXT NOT NULL DEFAULT 'juno',
    provider_request_id   TEXT,
    provider_response     JSONB,
    note                  TEXT,
    requested_at          TIMESTAMPTZ DEFAULT NOW(),
    processed_at          TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_juno_withdrawal_requests_suborg ON juno_withdrawal_requests(turnkey_sub_org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_juno_withdrawal_requests_status ON juno_withdrawal_requests(status)`,
  `CREATE INDEX IF NOT EXISTS idx_juno_withdrawal_requests_requested ON juno_withdrawal_requests(requested_at DESC)`,
];

const IDEMPOTENT_ERROR_CODES = new Set([
  '42P06',
  '42P07',
  '42710',
  '42701',
  '42P16',
]);

function isIdempotentError(error) {
  if (!error) return false;
  if (IDEMPOTENT_ERROR_CODES.has(error.code)) return true;
  return String(error.message || '').toLowerCase().includes('already exists');
}

export async function ensureJunoFundingSchema(sql) {
  if (junoFundingSchemaReady) return;
  for (const migration of JUNO_FUNDING_SCHEMA_MIGRATIONS) {
    try {
      await sql.query(migration);
    } catch (error) {
      if (isIdempotentError(error)) continue;
      throw error;
    }
  }
  junoFundingSchemaReady = true;
}

function envFlag(env, name) {
  return String(env?.[name] || '').trim().toLowerCase() === 'true';
}

export function buildDepositMethods(env = process.env) {
  const cardEnabled = envFlag(env, 'JUNO_CARD_CHECKOUT_ENABLED');
  const applePayEnabled = envFlag(env, 'JUNO_APPLE_PAY_ENABLED');
  return [
    {
      id: 'spei',
      label: 'SPEI',
      enabled: true,
      comingSoon: false,
      description: 'Transferencia bancaria a tu CLABE.',
    },
    {
      id: 'card',
      label: 'Tarjeta',
      enabled: cardEnabled,
      comingSoon: !cardEnabled,
      description: cardEnabled ? 'Pago con tarjeta vía proveedor.' : 'Pendiente de proveedor.',
    },
    {
      id: 'apple_pay',
      label: 'Apple Pay',
      enabled: applePayEnabled,
      comingSoon: !applePayEnabled,
      description: applePayEnabled ? 'Pago con Apple Pay vía proveedor.' : 'Pendiente de proveedor.',
    },
  ];
}

function toCamelFundingAccount(account = null) {
  if (!account) return null;
  return {
    clabe: account.clabe || null,
    junoAccountId: account.juno_account_id || account.junoAccountId || null,
    blockchainAccountRegistered: Boolean(
      account.blockchain_account_registered ?? account.blockchainAccountRegistered,
    ),
    kycStatus: account.kyc_status || account.kycStatus || 'unknown',
    lastDepositStatus: account.last_deposit_status || account.lastDepositStatus || null,
    lastWithdrawalStatus: account.last_withdrawal_status || account.lastWithdrawalStatus || null,
  };
}

export function buildFundingStatusPayload({
  user = {},
  fundingAccount = null,
  balance = {},
  junoConfigured = false,
  depositMethods = buildDepositMethods(),
  history = [],
}) {
  const account = toCamelFundingAccount(fundingAccount);
  const walletAddress = user.walletAddress || user.wallet_address || null;
  const clabe = account?.clabe || null;
  const onchainBalance = Number(balance?.balance || 0);
  let status = 'ready';
  if (!walletAddress) status = 'wallet_missing';
  else if (!junoConfigured) status = 'juno_not_configured';
  else if (!clabe) status = 'clabe_pending';
  else if (!account?.blockchainAccountRegistered) status = 'wallet_registration_pending';
  else if (account?.kycStatus && ['blocked', 'rejected'].includes(String(account.kycStatus).toLowerCase())) {
    status = 'kyc_blocked';
  }

  const depositEnabled = status === 'ready';
  const withdrawEnabled = junoConfigured && Boolean(walletAddress) && onchainBalance > 0;

  return {
    status,
    provider: 'juno',
    walletAddress,
    clabe,
    kycStatus: account?.kycStatus || 'unknown',
    balance: {
      balance: onchainBalance,
      symbol: balance?.symbol || 'MXNB',
      chainId: Number(balance?.chainId || process.env.ONCHAIN_CHAIN_ID || 42161),
      decimals: Number(balance?.decimals || 18),
    },
    deposit: {
      label: 'Depositar',
      enabled: depositEnabled,
      methods: depositMethods,
    },
    depositMethods,
    withdraw: {
      label: 'Retirar',
      enabled: withdrawEnabled,
    },
    history,
    lastDepositStatus: account?.lastDepositStatus || null,
    lastWithdrawalStatus: account?.lastWithdrawalStatus || null,
  };
}

function readPayload(raw = {}) {
  return raw.payload || raw.data || raw.transaction || raw;
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
  }
  return null;
}

export function normalizeJunoTransactionEvent(raw = {}) {
  const payload = readPayload(raw);
  const type = lower(payload.type || payload.transaction_type || payload.kind || raw.type || raw.event);
  const detail = payload.issuance
    || payload.redemption
    || payload.withdrawal
    || payload.deposit
    || payload.transfer
    || {};

  return {
    provider: 'juno',
    eventType: pick(raw.event, raw.type, payload.event) || 'transaction',
    providerEventId: pick(payload.id, raw.id, raw.event_id, payload.transaction_id),
    type: type || 'transaction',
    status: lower(payload.status || payload.transaction_status || detail.status),
    amount: pick(detail.amount, payload.amount),
    asset: pick(detail.asset, payload.asset),
    network: pick(detail.network, payload.network),
    receiverClabe: pick(detail.deposit_receiver_clabe, detail.receiver_clabe, payload.clabe),
    destinationAddress: pick(
      detail.crypto_destination_address,
      detail.destination_address,
      detail.address,
      payload.wallet_address,
    ),
    txHash: pick(detail.crypto_tx_hash, detail.tx_hash, payload.tx_hash),
    externalRef: pick(payload.external_ref, detail.external_ref),
    raw,
  };
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isDepositType(value) {
  const type = normalizeStatus(value);
  return type === 'issuance' || type === 'deposit';
}

function isWithdrawalType(value) {
  const type = normalizeStatus(value);
  return type === 'redemption' || type === 'withdrawal';
}

function depositLabel(status) {
  const s = normalizeStatus(status);
  if (s === 'complete' || s === 'completed' || s === 'settled') return 'Depósito recibido';
  if (s === 'failed' || s === 'error' || s === 'rejected') return 'Depósito con error';
  return 'Depósito en proceso';
}

function withdrawalLabel(status) {
  const s = normalizeStatus(status);
  if (s === 'complete' || s === 'completed' || s === 'settled' || s === 'submitted') return 'Retiro completado';
  if (s === 'failed' || s === 'error' || s === 'rejected' || s === 'provider_error') return 'Retiro con error';
  return 'Retiro solicitado';
}

function eventTime(row = {}) {
  return row.created_at || row.createdAt || row.requested_at || row.requestedAt || row.updated_at || row.updatedAt || null;
}

function toHistoryDeposit(row = {}) {
  const status = row.transaction_status || row.status || row.transactionStatus;
  return {
    id: row.id ? `deposit-${row.id}` : `deposit-${row.provider_event_id || row.tx_hash || eventTime(row) || 'event'}`,
    kind: 'deposit',
    label: depositLabel(status),
    status: normalizeStatus(status),
    amount: row.amount == null ? null : Number(row.amount),
    asset: row.asset || 'MXN',
    createdAt: eventTime(row),
    txHash: row.tx_hash || row.txHash || null,
    destinationClabe: row.clabe || row.receiverClabe || null,
  };
}

function toHistoryWithdrawal(row = {}) {
  const status = row.status || row.transaction_status || row.transactionStatus;
  return {
    id: row.id ? `withdrawal-${row.id}` : `withdrawal-${row.provider_request_id || eventTime(row) || 'request'}`,
    kind: 'withdrawal',
    label: withdrawalLabel(status),
    status: normalizeStatus(status),
    amount: row.amount == null ? null : Number(row.amount),
    asset: row.asset || 'MXNB',
    createdAt: row.requested_at || row.requestedAt || row.created_at || row.createdAt || row.updated_at || null,
    txHash: row.tx_hash || row.txHash || null,
    destinationClabe: row.destination_clabe || row.destinationClabe || row.clabe || null,
  };
}

export function buildFundingHistory({
  transactionEvents = [],
  withdrawalRequests = [],
} = {}) {
  const eventRows = Array.isArray(transactionEvents) ? transactionEvents : [];
  const deposits = eventRows
    .filter(row => isDepositType(row.transaction_type || row.type || row.transactionType))
    .map(toHistoryDeposit);
  const withdrawalEvents = eventRows
    .filter(row => isWithdrawalType(row.transaction_type || row.type || row.transactionType))
    .map(row => toHistoryWithdrawal({
      ...row,
      status: row.transaction_status || row.status || row.transactionStatus,
      requested_at: row.created_at || row.createdAt,
      destination_clabe: row.clabe || row.destination_clabe,
    }));
  const withdrawals = (Array.isArray(withdrawalRequests) ? withdrawalRequests : [])
    .map(toHistoryWithdrawal);
  return [...deposits, ...withdrawalEvents, ...withdrawals]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}

function hasClabe(account = {}) {
  return Boolean(account.clabe || account.deposit_receiver_clabe || account.receiverClabe);
}

function isRegistered(account = {}) {
  return Boolean(account.blockchain_account_registered ?? account.blockchainAccountRegistered);
}

function isPendingStatus(value) {
  const s = normalizeStatus(value);
  return s === 'pending' || s === 'requested' || s === 'processing' || s === 'created';
}

function isFailedStatus(value) {
  const s = normalizeStatus(value);
  return s === 'failed' || s === 'error' || s === 'rejected' || s === 'provider_error';
}

export function buildAdminFundingMonitorPayload({
  accounts = [],
  withdrawals = [],
  events = [],
} = {}) {
  const accountRows = Array.isArray(accounts) ? accounts : [];
  const withdrawalRows = Array.isArray(withdrawals) ? withdrawals : [];
  const eventRows = Array.isArray(events) ? events : [];
  const counts = {
    missingClabe: accountRows.filter(account => !hasClabe(account)).length,
    pendingWalletRegistration: accountRows.filter(account => !isRegistered(account)).length,
    pendingWithdrawals: withdrawalRows.filter(row => isPendingStatus(row.status)).length,
    stuckDeposits: eventRows.filter(row => (
      isDepositType(row.transaction_type || row.type || row.transactionType)
      && isPendingStatus(row.transaction_status || row.status || row.transactionStatus)
    )).length,
    failedEvents: eventRows.filter(row => isFailedStatus(row.transaction_status || row.status || row.transactionStatus)).length,
  };
  counts.total = counts.missingClabe
    + counts.pendingWalletRegistration
    + counts.pendingWithdrawals
    + counts.stuckDeposits
    + counts.failedEvents;

  return {
    counts,
    accounts: accountRows,
    withdrawals: withdrawalRows,
    events: eventRows,
  };
}
