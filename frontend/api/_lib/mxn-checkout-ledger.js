export { MXN_CHECKOUT_LEDGER_SCHEMA } from './mxn-checkout-ledger-schema.js';

const ASSETS = Object.freeze({ hip4: 'USDC', polymarket: 'pUSD' });
const ENVIRONMENTS = ['testnet', 'mainnet'];
const TRANSFERS = ['deposit', 'withdrawal'];
const KINDS = [...TRANSFERS, 'fill', 'builder_payout'];
const STATUSES = ['pending', 'confirmed', 'failed'];
const IDENTIFIER = /^[a-zA-Z0-9._:/#-]{1,200}$/;
const SOURCE = /^[a-z][a-z0-9_-]{0,39}$/;
const EVENT_FIELDS = new Set([
  'environment', 'venue', 'accountId', 'source', 'reference', 'eventId', 'occurredAt', 'kind', 'status',
  'asset', 'amount', 'mxnAmount', 'quoteId', 'marketId', 'orderId', 'side', 'shares', 'venueFeeAmount',
  'builderFeeAmount',
]);

function ledgerError(code) {
  return Object.assign(new Error(code), { code });
}

function fieldError(field) {
  return ledgerError(`invalid_ledger_${field}`);
}

function identifier(value, field, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== 'string' || value.trim() !== value || !IDENTIFIER.test(value)) throw fieldError(field);
  return value;
}

function canonicalDecimal(value) {
  return value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function decimal(value, field, { required = false, allowZero = false, mxn = false } = {}) {
  if (!required && value == null) return null;
  const pattern = mxn ? /^(0|[1-9]\d{0,17})(\.\d{1,2})?$/ : /^(0|[1-9]\d{0,37})(\.\d{1,18})?$/;
  if (typeof value !== 'string' || value.trim() !== value || !pattern.test(value)) throw fieldError(field);
  const result = canonicalDecimal(value);
  if (!allowZero && result === '0') throw fieldError(field);
  return result;
}

function timestamp(value) {
  const match = typeof value === 'string'
    && /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,3}))?Z$/.exec(value);
  const millis = match ? Date.parse(value) : NaN;
  if (!Number.isFinite(millis) || match[1].startsWith('0000-')) throw fieldError('occurred_at');
  const iso = new Date(millis).toISOString();
  if (iso !== `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`) throw fieldError('occurred_at');
  return iso;
}

function scopeIdentity({ environment, venue, accountId }) {
  if (!ENVIRONMENTS.includes(environment)) throw fieldError('environment');
  if (typeof venue !== 'string' || !Object.hasOwn(ASSETS, venue)) throw fieldError('venue');
  return { environment, venue, accountId: identifier(accountId, 'account_id') };
}

// The caller supplies observed provider evidence and resolves the owning account.
// A source reference identifies an operation, while an event ID identifies one
// observation for that operation. Namespace IDs when a provider only guarantees
// uniqueness per chain, market, wallet, or data feed.
export function normalizeMxnCheckoutLedgerEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || Object.keys(event).some(key => !EVENT_FIELDS.has(key))) throw fieldError('event');

  const identity = scopeIdentity(event);
  const { source, kind, status, asset, side } = event;
  if (typeof source !== 'string' || source.trim() !== source || !SOURCE.test(source)) throw fieldError('source');
  if (!KINDS.includes(kind)) throw fieldError('kind');
  if (!STATUSES.includes(status)) throw fieldError('status');
  if (ASSETS[identity.venue] !== asset) throw fieldError('asset');

  const isTransfer = TRANSFERS.includes(kind);
  const isFill = kind === 'fill';
  if (!isTransfer && (status !== 'confirmed' || event.mxnAmount != null || event.quoteId != null)) {
    throw fieldError('event');
  }
  if (!isFill && [side, event.marketId, event.orderId, event.shares, event.venueFeeAmount, event.builderFeeAmount]
    .some(value => value != null)) throw fieldError('fill_fields');
  if (isFill && !['buy', 'sell'].includes(side)) throw fieldError('side');

  return {
    ...identity, source, kind, status, asset,
    reference: identifier(event.reference, 'reference'),
    eventId: identifier(event.eventId, 'event_id'),
    occurredAt: timestamp(event.occurredAt),
    amount: decimal(event.amount, 'amount', { required: status === 'confirmed' }),
    mxnAmount: decimal(event.mxnAmount, 'mxn_amount', { mxn: true }),
    quoteId: identifier(event.quoteId, 'quote_id', true),
    marketId: identifier(event.marketId, 'market_id', !isFill),
    orderId: identifier(event.orderId, 'order_id', !isFill),
    side: side ?? null,
    shares: decimal(event.shares, 'shares', { required: isFill }),
    venueFeeAmount: decimal(event.venueFeeAmount, 'venue_fee_amount', { allowZero: true }),
    builderFeeAmount: decimal(event.builderFeeAmount, 'builder_fee_amount', { allowZero: true }),
  };
}

function readScope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fieldError('scope');
  const { environment, venue, accountId } = scopeIdentity(input);
  const { accountType = 'user' } = input;
  if (!['user', 'builder'].includes(accountType)) throw fieldError('account_type');
  return [environment, venue, accountId, accountType === 'builder'];
}

function dbDecimal(value) {
  return value == null ? null : canonicalDecimal(String(value));
}

function shapeEvent(row, { venue, account_id, asset } = row) {
  return {
    environment: row.environment, venue, accountId: account_id,
    source: row.source, kind: row.kind, status: row.status, asset,
    reference: row.reference, eventId: row.event_id, occurredAt: new Date(row.occurred_at).toISOString(),
    amount: dbDecimal(row.amount), mxnAmount: dbDecimal(row.mxn_amount), quoteId: row.quote_id,
    marketId: row.market_id, orderId: row.order_id, side: row.side, shares: dbDecimal(row.shares),
    venueFeeAmount: dbDecimal(row.venue_fee_amount), builderFeeAmount: dbDecimal(row.builder_fee_amount),
  };
}

const EVENT_FIELDS_SQL = `e.environment, e.source, e.kind, e.reference, e.event_id, e.status, e.occurred_at,
  e.amount::text, e.mxn_amount::text, e.quote_id, e.market_id, e.order_id, e.side, e.shares::text,
  e.venue_fee_amount::text, e.builder_fee_amount::text`;

async function persistEvent(client, event) {
  const { environment, source, kind, reference, venue, accountId, asset, eventId, status, occurredAt } = event;
  const entryKey = [environment, source, kind, reference];
  await client.query(`
    INSERT INTO mxn_checkout_ledger_entries (environment, source, kind, reference, venue, account_id, asset)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT DO NOTHING`, [...entryKey, venue, accountId, asset]);
  const { rows: [entry] } = await client.query(`
    SELECT venue, account_id, asset FROM mxn_checkout_ledger_entries
    WHERE (environment, source, kind, reference) = ($1, $2, $3, $4) FOR UPDATE`, entryKey);
  if (entry.venue !== venue || entry.account_id !== accountId || entry.asset !== asset) {
    throw ledgerError('ledger_entry_conflict');
  }

  const { rows } = await client.query(`
    SELECT ${EVENT_FIELDS_SQL} FROM mxn_checkout_ledger_events e
    WHERE environment = $1 AND source = $2 AND ((kind = $3 AND reference = $4) OR event_id = $5)`,
  [...entryKey, eventId]);
  const priorEvent = rows.find(row => row.event_id === eventId);
  if (priorEvent) {
    if (JSON.stringify(shapeEvent(priorEvent, entry)) !== JSON.stringify(event)) {
      throw ledgerError('ledger_event_conflict');
    }
    return { recorded: false, event };
  }

  // The entry lock serializes state transitions. A historical pending event can
  // arrive after its terminal receipt during backfill.
  for (const row of rows) {
    if (row.status === status || (row.status !== 'pending' && status !== 'pending')) {
      throw ledgerError('ledger_status_conflict');
    }
    const priorTime = new Date(row.occurred_at).toISOString();
    if (status === 'pending' ? occurredAt > priorTime : occurredAt < priorTime) {
      throw ledgerError('ledger_event_out_of_order');
    }
    if (event.quoteId && row.quote_id && event.quoteId !== row.quote_id) {
      throw ledgerError('ledger_entry_conflict');
    }
  }

  const { rows: inserted } = await client.query(`
    INSERT INTO mxn_checkout_ledger_events
      (environment, source, kind, reference, event_id, status, occurred_at,
       amount, mxn_amount, quote_id, market_id, order_id, side, shares, venue_fee_amount, builder_fee_amount)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (environment, source, event_id) DO NOTHING RETURNING event_id`,
  [...entryKey, eventId, status, occurredAt, event.amount, event.mxnAmount, event.quoteId,
    event.marketId, event.orderId, event.side, event.shares, event.venueFeeAmount, event.builderFeeAmount]);
  if (!inserted.length) throw ledgerError('ledger_event_conflict');
  return { recorded: true, event };
}

const ACCOUNT_FILTER = `r.environment = $1 AND r.venue = $2 AND r.account_id = $3
  AND (r.kind = 'builder_payout') = $4`;
const EVENT_JOIN = 'JOIN mxn_checkout_ledger_events e USING (environment, source, kind, reference)';

async function defaultTransaction(callback) {
  const { withTransaction } = await import('./db-tx.js');
  return withTransaction(callback);
}

export function createMxnCheckoutLedger({ withTransaction = defaultTransaction } = {}) {
  return {
    async record(input) {
      const event = normalizeMxnCheckoutLedgerEvent(input);
      return withTransaction(client => persistEvent(client, event));
    },
    async list(input) {
      const scope = readScope(input);
      const { limit = 50 } = input;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw fieldError('limit');
      return withTransaction(async client => {
        const { rows } = await client.query(`
          SELECT r.venue, r.account_id, r.asset, ${EVENT_FIELDS_SQL}
          FROM mxn_checkout_ledger_entries r ${EVENT_JOIN}
          WHERE ${ACCOUNT_FILTER}
          ORDER BY e.occurred_at DESC, e.source DESC, e.event_id DESC LIMIT $5`, [...scope, limit]);
        return rows.map(row => shapeEvent(row));
      });
    },
    async totals(input) {
      const scope = readScope(input);
      return withTransaction(async client => {
        const { rows } = await client.query(`
          SELECT r.venue, r.asset,
            COALESCE(SUM(e.amount) FILTER (WHERE r.kind = 'deposit'), 0)::text AS deposits,
            COALESCE(SUM(e.amount) FILTER (WHERE r.kind = 'withdrawal'), 0)::text AS withdrawals,
            COALESCE(SUM(e.mxn_amount) FILTER (WHERE r.kind = 'deposit'), 0)::text AS "mxnDeposits",
            COALESCE(SUM(e.mxn_amount) FILTER (WHERE r.kind = 'withdrawal'), 0)::text AS "mxnWithdrawals",
            COUNT(*) FILTER (WHERE r.kind = 'deposit' AND e.mxn_amount IS NULL)::text AS "depositsWithUnknownMxn",
            COUNT(*) FILTER (WHERE r.kind = 'withdrawal' AND e.mxn_amount IS NULL)::text AS "withdrawalsWithUnknownMxn",
            COALESCE(SUM(e.amount) FILTER (WHERE r.kind = 'fill'), 0)::text AS "fillNotional",
            COALESCE(SUM(e.venue_fee_amount), 0)::text AS "venueFeesReported",
            COALESCE(SUM(e.builder_fee_amount), 0)::text AS "builderFeesReported",
            COALESCE(SUM(e.amount) FILTER (WHERE r.kind = 'builder_payout'), 0)::text AS "builderPayoutsCredited",
            COUNT(*) FILTER (WHERE r.kind = 'fill' AND e.venue_fee_amount IS NULL)::text AS "fillsWithUnknownVenueFee",
            COUNT(*) FILTER (WHERE r.kind = 'fill' AND e.builder_fee_amount IS NULL)::text AS "fillsWithUnknownBuilderFee"
          FROM mxn_checkout_ledger_entries r ${EVENT_JOIN}
          WHERE ${ACCOUNT_FILTER} AND e.status = 'confirmed'
          GROUP BY r.venue, r.asset`, scope);
        return rows.map(({ venue, asset, ...sums }) => ({
          venue, asset, ...Object.fromEntries(Object.entries(sums).map(([key, value]) => [key, dbDecimal(value)])),
        }));
      });
    },
  };
}
