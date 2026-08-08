/**
 * Admin support queue.
 *
 * GET  /api/points/admin/support-tickets?status=open|closed|all
 * POST /api/points/admin/support-tickets
 *   body: { id, action: 'reply'|'close'|'reopen', message? }
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { notifySupportTicketReply } from '../../_lib/support-email.js';
import { serializeSupportAttachments } from '../../_lib/support-attachments.js';

const schemaSql = neon(process.env.DATABASE_URL);
const readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

function serializeTicket(row, messages = []) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    type: row.type,
    subject: row.subject,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUserMessageAt: row.last_user_message_at,
    lastAdminMessageAt: row.last_admin_message_at,
    messages: messages.map(m => ({
      id: m.id,
      senderType: m.sender_type,
      senderUsername: m.sender_username,
      body: m.body,
      attachments: serializeSupportAttachments(m.attachments),
      emailed: m.emailed,
      createdAt: m.created_at,
    })),
  };
}

function cleanMessage(value) {
  const text = String(value || '').trim();
  return text.length >= 2 && text.length <= 4000 ? text : null;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;
  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  try {
    await ensurePointsSchema(schemaSql);
    if (req.method === 'GET') return list(req, res);
    if (req.method === 'POST') return mutate(req, res, admin);
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    if (e?.status) {
      return res.status(e.status).json({ error: e.message || 'support_admin_error', detail: e.detail || null });
    }
    console.error('[admin/support-tickets] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'support_admin_failed', detail: e?.message?.slice(0, 240) || null });
  }
}

async function list(req, res) {
  const status = ['open', 'closed', 'all'].includes(req.query.status) ? req.query.status : 'open';
  const tickets = status === 'all'
    ? await readSql`
        SELECT *
        FROM points_support_tickets
        ORDER BY updated_at DESC
        LIMIT 200
      `
    : await readSql`
        SELECT *
        FROM points_support_tickets
        WHERE status = ${status}
        ORDER BY updated_at DESC
        LIMIT 200
      `;
  if (!tickets.length) return res.status(200).json({ tickets: [], count: 0 });

  const ids = tickets.map(t => t.id);
  const messages = await readSql`
    SELECT *
    FROM points_support_messages
    WHERE ticket_id = ANY(${ids}::int[])
    ORDER BY created_at ASC
  `;
  const byTicket = new Map();
  for (const msg of messages) {
    if (!byTicket.has(msg.ticket_id)) byTicket.set(msg.ticket_id, []);
    byTicket.get(msg.ticket_id).push(msg);
  }

  return res.status(200).json({
    count: tickets.length,
    tickets: tickets.map(t => serializeTicket(t, byTicket.get(t.id) || [])),
  });
}

async function mutate(req, res, admin) {
  const id = parseInt(req.body?.id, 10);
  const action = String(req.body?.action || '').trim();
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_id' });
  if (!['reply', 'close', 'reopen'].includes(action)) return res.status(400).json({ error: 'invalid_action' });

  if (action === 'reply') {
    const message = cleanMessage(req.body?.message);
    if (!message) return res.status(400).json({ error: 'invalid_message' });
    const result = await withTransaction(async (client) => {
      const ticketRes = await client.query(
        `SELECT * FROM points_support_tickets WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (ticketRes.rows.length === 0) {
        const err = new Error('ticket_not_found'); err.status = 404; throw err;
      }
      const msgRes = await client.query(
        `INSERT INTO points_support_messages
           (ticket_id, sender_type, sender_username, body)
         VALUES ($1, 'admin', $2, $3)
         RETURNING *`,
        [id, admin.username || 'admin', message],
      );
      const ticketUpdate = await client.query(
        `UPDATE points_support_tickets
            SET status = 'open',
                last_admin_message_at = NOW(),
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [id],
      );
      return { ticket: ticketUpdate.rows[0], message: msgRes.rows[0] };
    });

    const emailed = await notifySupportTicketReply(result.ticket, message);
    if (emailed) {
      await schemaSql`
        UPDATE points_support_messages
        SET emailed = true
        WHERE id = ${result.message.id}
      `;
      result.message.emailed = true;
    }
    return res.status(200).json({ ticket: serializeTicket(result.ticket, [result.message]) });
  }

  const nextStatus = action === 'close' ? 'closed' : 'open';
  const updated = await schemaSql`
    UPDATE points_support_tickets
      SET status = ${nextStatus},
          updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  if (!updated.length) return res.status(404).json({ error: 'ticket_not_found' });
  return res.status(200).json({ ticket: serializeTicket(updated[0], []) });
}
