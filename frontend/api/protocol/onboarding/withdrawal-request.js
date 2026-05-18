/**
 * POST /api/protocol/onboarding/withdrawal-request
 *
 * Creates a withdrawal request row first. When Juno withdrawals are enabled
 * and configured, the same endpoint can submit the provider movement; until
 * then it is an admin-visible queue item.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requireSession } from '../../_lib/session.js';
import {
  isJunoConfigured,
  requestJunoWithdrawal,
} from '../../_lib/juno.js';
import { ensureJunoFundingSchema } from '../../_lib/juno-funding.js';

const sql = neon(process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body;
}

function normalizeClabe(value) {
  return String(value || '').replace(/\D/g, '');
}

function pickProviderRequestId(response) {
  const data = response?.payload || response?.data || response || {};
  return data.id || data.request_id || data.transaction_id || data.external_ref || null;
}

function serializeRequest(row = {}) {
  return {
    id: row.id,
    status: row.status,
    amount: row.amount == null ? null : Number(row.amount),
    asset: row.asset || 'MXNB',
    destinationClabe: row.destination_clabe || null,
    destinationName: row.destination_name || null,
    providerRequestId: row.provider_request_id || null,
    requestedAt: row.requested_at || null,
    processedAt: row.processed_at || null,
    note: row.note || null,
  };
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const session = requireSession(req, res);
    if (!session) return;

    const body = parseBody(req.body);
    const amount = Number(body.amount);
    const destinationClabe = normalizeClabe(body.destinationClabe || body.destination_clabe);
    const destinationName = String(body.destinationName || body.destination_name || '').trim().slice(0, 120) || null;
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'invalid_amount' });
    }
    if (destinationClabe.length !== 18) {
      return res.status(400).json({ error: 'invalid_destination_clabe' });
    }

    await ensurePointsSchema(schemaSql);
    await ensureJunoFundingSchema(schemaSql);

    const userRows = await sql`
      SELECT turnkey_sub_org_id, wallet_address
      FROM points_users
      WHERE turnkey_sub_org_id = ${session.sub}
      LIMIT 1
    `;
    const user = userRows[0];
    if (!user?.wallet_address) {
      return res.status(400).json({ error: 'wallet_missing' });
    }

    const created = await sql`
      INSERT INTO juno_withdrawal_requests (
        turnkey_sub_org_id,
        wallet_address,
        destination_clabe,
        destination_name,
        amount,
        asset,
        status
      )
      VALUES (
        ${session.sub},
        ${user.wallet_address},
        ${destinationClabe},
        ${destinationName},
        ${amount},
        'MXNB',
        'pending'
      )
      RETURNING *
    `;
    let request = created[0];

    if (process.env.JUNO_WITHDRAWALS_ENABLED === 'true' && isJunoConfigured(process.env)) {
      try {
        const response = await requestJunoWithdrawal({
          amount,
          walletAddress: user.wallet_address,
          clabe: destinationClabe,
          externalRef: `pronos-withdraw-${request.id}`,
        });
        const providerRequestId = pickProviderRequestId(response);
        const rows = await sql`
          UPDATE juno_withdrawal_requests
          SET status = 'submitted',
              provider_request_id = ${providerRequestId},
              provider_response = ${JSON.stringify(response)},
              updated_at = NOW()
          WHERE id = ${request.id}
          RETURNING *
        `;
        request = rows[0] || request;
      } catch (error) {
        const rows = await sql`
          UPDATE juno_withdrawal_requests
          SET status = 'provider_error',
              note = ${String(error?.message || 'provider_error').slice(0, 500)},
              updated_at = NOW()
          WHERE id = ${request.id}
          RETURNING *
        `;
        request = rows[0] || request;
      }
    }

    return res.status(200).json({ ok: true, request: serializeRequest(request) });
  } catch (error) {
    console.error('[protocol/onboarding/withdrawal-request] unhandled', { message: error?.message });
    return res.status(500).json({ error: 'withdrawal_request_failed' });
  }
}
