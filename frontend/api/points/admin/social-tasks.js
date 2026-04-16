/**
 * GET  /api/points/admin/social-tasks?status=pending|approved|rejected
 * POST /api/points/admin/social-tasks  { id, action: 'approve' | 'reject', note? }
 *
 * Admin queue for reviewing user-submitted social tasks. GET lists rows
 * with user + task key + proof URL. POST either approves (credits MXNP
 * atomically) or rejects (stores rejection reason so the user can fix
 * their proof and re-submit).
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  try {
    await ensurePointsSchema(schemaSql);
  } catch (e) {
    console.error('[admin/social-tasks] schema error', { message: e?.message });
    return res.status(500).json({ error: 'schema_failed' });
  }

  if (req.method === 'GET') {
    return await handleList(req, res);
  }
  if (req.method === 'POST') {
    return await handleReview(req, res, admin.username);
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}

async function handleList(req, res) {
  const status = VALID_STATUSES.has(req.query.status) ? req.query.status : 'pending';
  try {
    const rows = await sql`
      SELECT id, username, task_key, status, reward, proof_url,
             reviewer, reviewed_at, rejection_note, created_at
      FROM social_tasks
      WHERE status = ${status}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return res.status(200).json({ tasks: rows });
  } catch (e) {
    console.error('[admin/social-tasks] list error', { message: e?.message });
    return res.status(500).json({ error: 'list_failed' });
  }
}

async function handleReview(req, res, adminUsername) {
  const { id, action, note } = req.body || {};
  const taskId = parseInt(id, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: 'invalid_action' });
  }
  if (action === 'reject' && (!note || typeof note !== 'string' || note.trim().length === 0)) {
    return res.status(400).json({ error: 'rejection_note_required' });
  }

  try {
    const result = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT id, username, task_key, status, reward
         FROM social_tasks
         WHERE id = $1
         FOR UPDATE`,
        [taskId],
      );
      if (current.rows.length === 0) {
        const err = new Error('task_not_found'); err.status = 404; throw err;
      }
      const task = current.rows[0];
      if (task.status !== 'pending') {
        const err = new Error('already_reviewed'); err.status = 409; throw err;
      }

      if (action === 'approve') {
        await client.query(
          `UPDATE social_tasks
           SET status = 'approved', reviewer = $1, reviewed_at = NOW()
           WHERE id = $2`,
          [adminUsername, taskId],
        );

        // Credit the user their reward + audit entry.
        await client.query(
          `INSERT INTO points_balances (username, balance)
           VALUES ($1, $2)
           ON CONFLICT (username) DO UPDATE
           SET balance = points_balances.balance + EXCLUDED.balance,
               updated_at = NOW()`,
          [task.username, Number(task.reward)],
        );
        await client.query(
          `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
           VALUES ($1, $2, 'social_task', $3, $4)`,
          [
            task.username,
            Number(task.reward),
            taskId,
            `Tarea social aprobada: ${task.task_key}`,
          ],
        );
      } else {
        await client.query(
          `UPDATE social_tasks
           SET status = 'rejected',
               reviewer = $1,
               reviewed_at = NOW(),
               rejection_note = $2
           WHERE id = $3`,
          [adminUsername, note.trim().slice(0, 500), taskId],
        );
      }

      return { username: task.username, taskKey: task.task_key, action };
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('[admin/social-tasks] review error', { message: e?.message });
    return res.status(500).json({ error: 'review_failed' });
  }
}
