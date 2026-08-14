import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import {
  ensureJunoFundingSchema,
  normalizeJunoTransactionEvent,
} from '../../_lib/juno-funding.js';

const sql = neon(process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body;
}

function hasValidWebhookSecret(req) {
  const secret = process.env.JUNO_WEBHOOK_SECRET;
  if (!secret) return true;
  const explicit = req.headers?.['x-juno-webhook-secret'];
  const auth = req.headers?.authorization || '';
  return explicit === secret || auth === `Bearer ${secret}`;
}

async function findFundingAccount(event) {
  const rows = await sql`
    SELECT turnkey_sub_org_id, wallet_address, clabe
    FROM juno_funding_accounts
    WHERE (${event.receiverClabe}::text IS NOT NULL AND clabe = ${event.receiverClabe})
       OR (${event.destinationAddress}::text IS NOT NULL AND LOWER(wallet_address) = LOWER(${event.destinationAddress}))
    LIMIT 1
  `;
  return rows[0] || null;
}

async function storeEvent(event, account) {
  await sql`
    INSERT INTO juno_transaction_events (
      provider,
      provider_event_id,
      event_type,
      transaction_type,
      transaction_status,
      turnkey_sub_org_id,
      wallet_address,
      clabe,
      amount,
      asset,
      network,
      tx_hash,
      external_ref,
      raw_event
    )
    VALUES (
      'juno',
      ${event.providerEventId},
      ${event.eventType},
      ${event.type},
      ${event.status},
      ${account?.turnkey_sub_org_id || null},
      ${event.destinationAddress || account?.wallet_address || null},
      ${event.receiverClabe || account?.clabe || null},
      ${event.amount},
      ${event.asset},
      ${event.network},
      ${event.txHash},
      ${event.externalRef},
      ${JSON.stringify(event.raw)}
    )
    ON CONFLICT (provider, provider_event_id, transaction_status) DO NOTHING
  `;
}

async function updateFundingAccount(event, account) {
  if (!account?.turnkey_sub_org_id) return;
  const isDeposit = event.type === 'issuance' || event.type === 'deposit';
  if (isDeposit) {
    await sql`
      UPDATE juno_funding_accounts
      SET last_deposit_status = ${event.status},
          last_juno_transaction_id = COALESCE(${event.providerEventId}, last_juno_transaction_id),
          updated_at = NOW()
      WHERE turnkey_sub_org_id = ${account.turnkey_sub_org_id}
    `;
    return;
  }
  await sql`
    UPDATE juno_funding_accounts
    SET last_withdrawal_status = ${event.status},
        last_juno_transaction_id = COALESCE(${event.providerEventId}, last_juno_transaction_id),
        updated_at = NOW()
    WHERE turnkey_sub_org_id = ${account.turnkey_sub_org_id}
  `;
}

async function updateWithdrawalRequest(event) {
  const isWithdrawal = event.type === 'redemption' || event.type === 'withdrawal';
  if (!isWithdrawal) return;
  await sql`
    UPDATE juno_withdrawal_requests
    SET status = COALESCE(${event.status}, status),
        provider_request_id = COALESCE(${event.providerEventId}, provider_request_id),
        provider_response = ${JSON.stringify(event.raw)},
        processed_at = CASE
          WHEN ${event.status} IN ('complete', 'completed', 'failed', 'rejected') THEN NOW()
          ELSE processed_at
        END,
        updated_at = NOW()
    WHERE (${event.externalRef}::text IS NOT NULL AND ('pronos-withdraw-' || id::text) = ${event.externalRef})
       OR (${event.providerEventId}::text IS NOT NULL AND provider_request_id = ${event.providerEventId})
  `;
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: false });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!hasValidWebhookSecret(req)) return res.status(401).json({ error: 'invalid_webhook_secret' });

    await ensurePointsSchema(schemaSql);
    await ensureJunoFundingSchema(schemaSql);

    const event = normalizeJunoTransactionEvent(parseBody(req.body));
    const account = await findFundingAccount(event);
    await storeEvent(event, account);
    await updateFundingAccount(event, account);
    await updateWithdrawalRequest(event);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[protocol/onboarding/juno-webhook] unhandled', { message: error?.message });
    return res.status(500).json({ error: 'juno_webhook_failed' });
  }
}
