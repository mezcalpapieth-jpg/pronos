/**
 * POST /api/points/social-tasks/submit
 * Body: { taskKey, proofUrl? }
 *
 * User marks a social task as completed. Creates a pending row in
 * social_tasks which an admin will approve or reject later via the
 * admin panel. No MXNP is credited until approval.
 *
 * Re-submits are allowed only if the previous submission was rejected —
 * the user had to go back, fix the issue, and re-upload proof.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requireSession } from '../../_lib/session.js';
import { rateLimit, clientIp } from '../../_lib/rate-limit.js';
import { TASK_CATALOG } from './catalog.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `social-submit:${clientIp(req)}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const { taskKey, proofUrl } = req.body || {};
  const key = String(taskKey || '').trim();
  const task = TASK_CATALOG.find(t => t.key === key);
  if (!task) return res.status(400).json({ error: 'invalid_task_key' });

  if (proofUrl && typeof proofUrl === 'string' && proofUrl.length > 2048) {
    return res.status(400).json({ error: 'proof_url_too_long' });
  }

  try {
    await ensurePointsSchema(sql);

    const username = session.username.toLowerCase();
    // UPSERT: first-time inserts a pending row. Re-submissions only
    // allowed if the existing row was previously rejected (the user
    // can fix their mistake and try again).
    const result = await sql`
      INSERT INTO social_tasks (username, task_key, status, reward, proof_url)
      VALUES (${username}, ${task.key}, 'pending', ${task.reward}, ${proofUrl || null})
      ON CONFLICT (username, task_key) DO UPDATE
      SET status = CASE
            WHEN social_tasks.status = 'rejected' THEN 'pending'
            ELSE social_tasks.status
          END,
          proof_url = CASE
            WHEN social_tasks.status = 'rejected' THEN EXCLUDED.proof_url
            ELSE social_tasks.proof_url
          END,
          rejection_note = CASE
            WHEN social_tasks.status = 'rejected' THEN NULL
            ELSE social_tasks.rejection_note
          END
      RETURNING status, id
    `;
    const { status, id } = result[0] || {};

    if (status === 'approved') {
      return res.status(409).json({ error: 'already_approved' });
    }
    return res.status(200).json({ ok: true, id, status });
  } catch (e) {
    console.error('[social-tasks/submit] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'submit_failed' });
  }
}
