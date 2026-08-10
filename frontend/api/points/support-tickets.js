/**
 * User support tickets for the points app.
 *
 * GET  /api/points/support-tickets
 * POST /api/points/support-tickets
 *   body: { type: 'socials'|'markets'|'other', subject, message, attachments? }
 *   body: { action: 'reply', id, message, attachments? }
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { withTransaction } from '../_lib/db-tx.js';
import { notifySupportTicketCreated, notifySupportTicketUserReply } from '../_lib/support-email.js';
import {
  normalizeSupportAttachments,
  serializeSupportAttachments,
} from '../_lib/support-attachments.js';

const schemaSql = neon(process.env.DATABASE_URL);
const readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const SUPPORT_TYPES = new Set(['socials', 'markets', 'other']);

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

function cleanText(value, { min = 1, max = 2000 } = {}) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) return null;
  return text;
}

async function markSupportMessageEmailed(messageId) {
  try {
    await schemaSql`
      UPDATE points_support_messages
      SET emailed = true
      WHERE id = ${messageId}
    `;
    return true;
  } catch (e) {
    console.warn('[points/support-tickets] email mark failed', {
      messageId,
      message: e?.message,
      code: e?.code,
    });
    return false;
  }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  try {
    await ensurePointsSchema(schemaSql);
    if (req.method === 'GET') return listTickets(req, res, session);
    if (req.method === 'POST') {
      if (String(req.body?.action || '').trim() === 'reply' || req.body?.id) {
        return replyTicket(req, res, session);
      }
      return createTicket(req, res, session);
    }
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    if (e?.status) {
      return res.status(e.status).json({ error: e.message || 'support_failed', detail: e.detail || null });
    }
    console.error('[points/support-tickets] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'support_failed', detail: e?.message?.slice(0, 240) || null });
  }
}

async function listTickets(req, res, session) {
  const ticketRows = await readSql`
    SELECT *
    FROM points_support_tickets
    WHERE LOWER(username) = LOWER(${session.username})
    ORDER BY updated_at DESC
    LIMIT 50
  `;
  if (!ticketRows.length) return res.status(200).json({ tickets: [] });

  const ids = ticketRows.map(t => t.id);
  const messageRows = await readSql`
    SELECT *
    FROM points_support_messages
    WHERE ticket_id = ANY(${ids}::int[])
    ORDER BY created_at ASC
  `;
  const byTicket = new Map();
  for (const msg of messageRows) {
    if (!byTicket.has(msg.ticket_id)) byTicket.set(msg.ticket_id, []);
    byTicket.get(msg.ticket_id).push(msg);
  }

  return res.status(200).json({
    tickets: ticketRows.map(t => serializeTicket(t, byTicket.get(t.id) || [])),
  });
}

async function replyTicket(req, res, session) {
  const id = parseInt(req.body?.id, 10);
  const message = cleanText(req.body?.message, { min: 2, max: 4000 });
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_id' });
  if (!message) return res.status(400).json({ error: 'invalid_message' });

  let attachments = [];
  try {
    attachments = normalizeSupportAttachments(req.body?.attachments);
  } catch (e) {
    return res.status(400).json({ error: e.code || 'invalid_attachments', detail: e.detail || null });
  }

  const result = await withTransaction(async (client) => {
    const ticketRes = await client.query(
      `SELECT *
       FROM points_support_tickets
       WHERE id = $1 AND LOWER(username) = LOWER($2)
       FOR UPDATE`,
      [id, session.username],
    );
    if (ticketRes.rows.length === 0) {
      return null;
    }
    const ticket = ticketRes.rows[0];
    if (ticket.status !== 'open') {
      const err = new Error('ticket_closed');
      err.status = 409;
      throw err;
    }
    const msg = await client.query(
      `INSERT INTO points_support_messages
         (ticket_id, sender_type, sender_username, body, attachments)
       VALUES ($1, 'user', $2, $3, $4::jsonb)
       RETURNING *`,
      [ticket.id, session.username, message, JSON.stringify(attachments)],
    );
    const updated = await client.query(
      `UPDATE points_support_tickets
          SET last_user_message_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [ticket.id],
    );
    return { ticket: updated.rows[0], message: msg.rows[0] };
  });

  if (!result) return res.status(404).json({ error: 'ticket_not_found' });

  const emailed = await notifySupportTicketUserReply(result.ticket, message);
  if (emailed && await markSupportMessageEmailed(result.message.id)) {
    result.message.emailed = true;
  }

  return res.status(200).json({
    ticket: serializeTicket(result.ticket, [result.message]),
  });
}

async function createTicket(req, res, session) {
  const type = SUPPORT_TYPES.has(req.body?.type) ? req.body.type : 'other';
  const subject = cleanText(req.body?.subject, { min: 4, max: 160 });
  const message = cleanText(req.body?.message, { min: 8, max: 4000 });
  if (!subject) return res.status(400).json({ error: 'invalid_subject' });
  if (!message) return res.status(400).json({ error: 'invalid_message' });
  let attachments = [];
  try {
    attachments = normalizeSupportAttachments(req.body?.attachments);
  } catch (e) {
    return res.status(400).json({ error: e.code || 'invalid_attachments', detail: e.detail || null });
  }

  const result = await withTransaction(async (client) => {
    const ticket = await client.query(
      `INSERT INTO points_support_tickets
         (username, email, type, subject, status, last_user_message_at, updated_at)
       VALUES ($1, $2, $3, $4, 'open', NOW(), NOW())
       RETURNING *`,
      [session.username, session.email || null, type, subject],
    );
    const msg = await client.query(
      `INSERT INTO points_support_messages
         (ticket_id, sender_type, sender_username, body, attachments)
       VALUES ($1, 'user', $2, $3, $4::jsonb)
       RETURNING *`,
      [ticket.rows[0].id, session.username, message, JSON.stringify(attachments)],
    );
    return { ticket: ticket.rows[0], message: msg.rows[0] };
  });

  const emailed = await notifySupportTicketCreated(result.ticket, message);
  if (emailed && await markSupportMessageEmailed(result.message.id)) {
    result.message.emailed = true;
  }

  return res.status(201).json({
    ticket: serializeTicket(result.ticket, [result.message]),
  });
}
