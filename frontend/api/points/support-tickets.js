/**
 * User support tickets for the points app.
 *
 * GET  /api/points/support-tickets
 * POST /api/points/support-tickets
 *   body: { type: 'socials'|'markets'|'other', subject, message }
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { withTransaction } from '../_lib/db-tx.js';
import { notifySupportTicketCreated } from '../_lib/support-email.js';

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

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  try {
    await ensurePointsSchema(schemaSql);
    if (req.method === 'GET') return listTickets(req, res, session);
    if (req.method === 'POST') return createTicket(req, res, session);
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[points/support-tickets] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'support_failed', detail: e?.message?.slice(0, 240) || null });
  }
}

async function listTickets(req, res, session) {
  const ticketRows = await readSql`
    SELECT *
    FROM points_support_tickets
    WHERE username = ${session.username}
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

async function createTicket(req, res, session) {
  const type = SUPPORT_TYPES.has(req.body?.type) ? req.body.type : 'other';
  const subject = cleanText(req.body?.subject, { min: 4, max: 160 });
  const message = cleanText(req.body?.message, { min: 8, max: 4000 });
  if (!subject) return res.status(400).json({ error: 'invalid_subject' });
  if (!message) return res.status(400).json({ error: 'invalid_message' });

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
         (ticket_id, sender_type, sender_username, body)
       VALUES ($1, 'user', $2, $3)
       RETURNING *`,
      [ticket.rows[0].id, session.username, message],
    );
    return { ticket: ticket.rows[0], message: msg.rows[0] };
  });

  const emailed = await notifySupportTicketCreated(result.ticket, message);
  if (emailed) {
    await schemaSql`
      UPDATE points_support_messages
      SET emailed = true
      WHERE id = ${result.message.id}
    `;
    result.message.emailed = true;
  }

  return res.status(201).json({
    ticket: serializeTicket(result.ticket, [result.message]),
  });
}
