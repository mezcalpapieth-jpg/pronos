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
import { withTransaction } from '../../_lib/db-tx.js';
import {
  DEFAULT_X_FOLLOW_TARGET_USERNAME,
  xUserFollowsTarget,
} from '../../_lib/x-oauth.js';
import { findSocialTaskByKey } from './catalog.js';

const sql = neon(process.env.DATABASE_URL);
const X_AUTO_REVIEWER = 'x:auto';

function isAutoXFollowTask(task) {
  return task?.verification === 'x_follow'
    || task?.key === 'twitter_follow';
}

function xFollowErrorResponse(res, error) {
  const code = error?.code || error?.message || 'x_follow_lookup_failed';
  const status = Number(error?.status || 503);
  return res.status(status >= 400 && status < 600 ? status : 503).json({
    error: code,
    detail: error?.detail || null,
  });
}

async function handleAutoXFollowTask(res, { username, task }) {
  const targetHandle = String(task.targetHandle || DEFAULT_X_FOLLOW_TARGET_USERNAME).replace(/^@+/, '');
  const linkRows = await sql`
    SELECT provider_user_id, handle, profile_url
    FROM points_social_links
    WHERE username = ${username}
      AND provider = 'x'
    LIMIT 1
  `;
  const link = linkRows[0] || null;
  if (!link?.provider_user_id) {
    return res.status(409).json({
      error: 'x_account_required',
      hint: 'connect_x',
    });
  }

  let verification;
  try {
    verification = await xUserFollowsTarget({
      userId: link.provider_user_id,
      username: link.handle,
      targetUsername: targetHandle,
    });
  } catch (error) {
    return xFollowErrorResponse(res, error);
  }

  if (!verification.follows) {
    return res.status(409).json({
      error: verification.checkedAll ? 'x_follow_not_verified' : 'x_follow_verification_limited',
      hint: verification.checkedAll ? `follow_${targetHandle}` : 'manual_review_needed',
    });
  }

  const proofUrl = `https://x.com/${targetHandle}`;
  const result = await withTransaction(async (client) => {
    const current = await client.query(
      `SELECT id, status, reward
       FROM social_tasks
       WHERE username = $1 AND task_key = $2
       FOR UPDATE`,
      [username, task.key],
    );
    const existing = current.rows[0] || null;
    if (existing?.status === 'approved') {
      return { id: existing.id, status: 'approved', credited: false };
    }

    let taskId = existing?.id || null;
    if (taskId) {
      const updated = await client.query(
        `UPDATE social_tasks
         SET status = 'approved',
             reward = $1,
             proof_url = $2,
             reviewer = $3,
             reviewed_at = NOW(),
             rejection_note = NULL
         WHERE id = $4
         RETURNING id`,
        [Number(task.reward), proofUrl, X_AUTO_REVIEWER, taskId],
      );
      taskId = updated.rows[0].id;
    } else {
      const inserted = await client.query(
        `INSERT INTO social_tasks (
           username, task_key, status, reward, proof_url, reviewer, reviewed_at
         )
         VALUES ($1, $2, 'approved', $3, $4, $5, NOW())
         RETURNING id`,
        [username, task.key, Number(task.reward), proofUrl, X_AUTO_REVIEWER],
      );
      taskId = inserted.rows[0].id;
    }

    await client.query(
      `INSERT INTO social_task_reviews (
         social_task_id, username, task_key, action, reward, proof_url, reviewer
       )
       VALUES ($1, $2, $3, 'approved', $4, $5, $6)`,
      [taskId, username, task.key, Number(task.reward), proofUrl, X_AUTO_REVIEWER],
    );

    const prior = await client.query(
      `SELECT 1
       FROM points_distributions
       WHERE username = $1
         AND kind = 'social_task'
         AND reference_id = $2
       LIMIT 1`,
      [username, taskId],
    );
    if (prior.rows.length > 0) {
      return { id: taskId, status: 'approved', credited: false };
    }

    await client.query(
      `INSERT INTO points_balances (username, balance)
       VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE
       SET balance = points_balances.balance + EXCLUDED.balance,
           updated_at = NOW()`,
      [username, Number(task.reward)],
    );
    await client.query(
      `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
       VALUES ($1, $2, 'social_task', $3, $4)`,
      [
        username,
        Number(task.reward),
        taskId,
        `Tarea social verificada automáticamente: ${task.key}`,
      ],
    );

    return { id: taskId, status: 'approved', credited: true };
  });

  return res.status(200).json({
    ok: true,
    ...result,
    autoVerified: true,
    targetHandle,
  });
}

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
  if (proofUrl && typeof proofUrl === 'string' && proofUrl.length > 2048) {
    return res.status(400).json({ error: 'proof_url_too_long' });
  }

  try {
    await ensurePointsSchema(sql);
    const task = await findSocialTaskByKey(sql, key);
    if (!task) return res.status(400).json({ error: 'invalid_task_key' });

    const username = session.username.toLowerCase();
    if (isAutoXFollowTask(task)) {
      return await handleAutoXFollowTask(res, { username, task });
    }

    const storedProofUrl = proofUrl || task.url || null;
    // UPSERT: first-time inserts a pending row. Re-submissions only
    // allowed if the existing row was previously rejected (the user
    // can fix their mistake and try again).
    const result = await sql`
      INSERT INTO social_tasks (username, task_key, status, reward, proof_url)
      VALUES (${username}, ${task.key}, 'pending', ${task.reward}, ${storedProofUrl})
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
          END,
          reviewer = CASE
            WHEN social_tasks.status = 'rejected' THEN NULL
            ELSE social_tasks.reviewer
          END,
          reviewed_at = CASE
            WHEN social_tasks.status = 'rejected' THEN NULL
            ELSE social_tasks.reviewed_at
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
