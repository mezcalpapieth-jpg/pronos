/**
 * GET  /api/points/admin/social-tasks?status=pending|approved|rejected|history|campaigns
 * POST /api/points/admin/social-tasks
 *   { id, action: 'approve' | 'reject', note? }
 *   { action: 'create_campaign', platform, targetUrl, reward?, expiresInDays?, label? }
 *   { action: 'deactivate_campaign', campaignId }
 *
 * Admin queue for reviewing user-submitted social tasks. GET lists rows
 * with user + task key + proof URL. POST either approves (credits MXNP
 * atomically) or rejects (stores rejection reason so the user can fix
 * their proof and re-submit).
 */
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { isDatabaseQuotaError, socialTasksUnavailablePayload } from '../../_lib/db-errors.js';

let readSql;
let schemaSql;

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'history', 'campaigns']);
const VALID_PLATFORMS = new Set(['x', 'instagram', 'tiktok']);

function normalizePlatform(platform) {
  const value = String(platform || '').trim().toLowerCase();
  return value === 'twitter' ? 'x' : value;
}

function platformLabel(platform) {
  return platform === 'x' ? 'X' : platform === 'instagram' ? 'Instagram' : 'TikTok';
}

function makeTaskKey(platform) {
  return `${platform}_post_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function normalizeTargetUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  try {
    return await handleSocialTasks(req, res);
  } catch (e) {
    console.error('[admin/social-tasks] unhandled error', {
      message: e?.message,
      code: e?.code,
      status: e?.status || e?.statusCode,
    });
    return res.status(500).json({ error: 'server_error' });
  }
}

function getReadSql() {
  if (!readSql) {
    const databaseUrl = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
    if (!databaseUrl) {
      const err = new Error('DATABASE_URL not configured');
      err.status = 500;
      throw err;
    }
    readSql = neon(databaseUrl);
  }
  return readSql;
}

function getSchemaSql() {
  if (!schemaSql) {
    if (!process.env.DATABASE_URL) {
      const err = new Error('DATABASE_URL not configured');
      err.status = 500;
      throw err;
    }
    schemaSql = neon(process.env.DATABASE_URL);
  }
  return schemaSql;
}

async function handleSocialTasks(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  try {
    await ensurePointsSchema(getSchemaSql());
  } catch (e) {
    if (req.method === 'GET' && isDatabaseQuotaError(e)) {
      console.warn('[admin/social-tasks] schema unavailable from DB quota', {
        message: e?.message,
        status: e?.status || e?.statusCode,
      });
      return res.status(200).json(socialTasksUnavailablePayload());
    }
    console.error('[admin/social-tasks] schema error', {
      message: e?.message,
      code: e?.code,
      status: e?.status || e?.statusCode,
    });
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
    const sql = getReadSql();
    if (status === 'campaigns') {
      const campaigns = await sql`
        SELECT id, task_key, platform, target_url, label, description, reward,
               hidden, active, expires_at, created_by, created_at, updated_at
        FROM social_task_campaigns
        ORDER BY active DESC, expires_at DESC, created_at DESC
        LIMIT 100
      `;
      return res.status(200).json({ campaigns });
    }
    const rows = status === 'history'
      ? await sql`
          SELECT s.id, s.username, s.task_key, s.status, s.reward, s.proof_url,
                 s.reviewer, s.reviewed_at, s.rejection_note, s.created_at,
                 c.platform, c.target_url, c.label AS task_label,
                 c.expires_at AS task_expires_at
          FROM social_tasks s
          LEFT JOIN social_task_campaigns c ON c.task_key = s.task_key
          WHERE s.status IN ('approved', 'rejected')
          ORDER BY COALESCE(s.reviewed_at, s.created_at) DESC
          LIMIT 100
        `
      : await sql`
          SELECT s.id, s.username, s.task_key, s.status, s.reward, s.proof_url,
                 s.reviewer, s.reviewed_at, s.rejection_note, s.created_at,
                 c.platform, c.target_url, c.label AS task_label,
                 c.expires_at AS task_expires_at
          FROM social_tasks s
          LEFT JOIN social_task_campaigns c ON c.task_key = s.task_key
          WHERE s.status = ${status}
          ORDER BY s.created_at DESC
          LIMIT 100
        `;
    return res.status(200).json({ tasks: rows });
  } catch (e) {
    if (isDatabaseQuotaError(e)) {
      console.warn('[admin/social-tasks] list unavailable from DB quota', {
        message: e?.message,
        status: e?.status || e?.statusCode,
      });
      return res.status(200).json(socialTasksUnavailablePayload());
    }
    console.error('[admin/social-tasks] list error', {
      message: e?.message,
      code: e?.code,
      status: e?.status || e?.statusCode,
    });
    return res.status(500).json({ error: 'list_failed' });
  }
}

async function handleReview(req, res, adminUsername) {
  const { id, action, note } = req.body || {};
  if (action === 'create_campaign') {
    return handleCreateCampaign(req, res, adminUsername);
  }
  if (action === 'deactivate_campaign') {
    return handleDeactivateCampaign(req, res, adminUsername);
  }
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

async function handleCreateCampaign(req, res, adminUsername) {
  const platform = normalizePlatform(req.body?.platform);
  const targetUrl = normalizeTargetUrl(req.body?.targetUrl);
  const reward = Number(req.body?.reward ?? 10);
  const expiresInDays = Number(req.body?.expiresInDays ?? 7);
  const customLabel = String(req.body?.label || '').trim();

  if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'invalid_platform' });
  if (!targetUrl) return res.status(400).json({ error: 'invalid_target_url' });
  if (!Number.isFinite(reward) || reward <= 0 || reward > 500) {
    return res.status(400).json({ error: 'invalid_reward' });
  }
  if (!Number.isFinite(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) {
    return res.status(400).json({ error: 'invalid_expiry' });
  }

  const key = makeTaskKey(platform);
  const label = customLabel.slice(0, 140) || `Interactuar con post en ${platformLabel(platform)}`;
  const description = `Abre el post exacto, completa la interacción solicitada y marca la tarea para revisión.`;
  const expiresAt = new Date(Date.now() + Math.round(expiresInDays * 24 * 60 * 60 * 1000));

  try {
    const sql = getSchemaSql();
    const rows = await sql`
      INSERT INTO social_task_campaigns (
        task_key, platform, target_url, label, description, reward,
        hidden, active, expires_at, created_by
      )
      VALUES (
        ${key}, ${platform}, ${targetUrl}, ${label}, ${description}, ${reward},
        TRUE, TRUE, ${expiresAt.toISOString()}, ${adminUsername}
      )
      RETURNING id, task_key, platform, target_url, label, description, reward,
                hidden, active, expires_at, created_by, created_at, updated_at
    `;
    return res.status(200).json({
      ok: true,
      campaign: rows[0],
      sharePath: `/earn?task=${encodeURIComponent(key)}`,
    });
  } catch (e) {
    console.error('[admin/social-tasks] create campaign error', { message: e?.message });
    return res.status(500).json({ error: 'create_campaign_failed' });
  }
}

async function handleDeactivateCampaign(req, res) {
  const campaignId = parseInt(req.body?.campaignId, 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).json({ error: 'invalid_campaign_id' });
  }
  try {
    const sql = getSchemaSql();
    const rows = await sql`
      UPDATE social_task_campaigns
         SET active = FALSE, updated_at = NOW()
       WHERE id = ${campaignId}
       RETURNING id, task_key, active
    `;
    if (!rows[0]) return res.status(404).json({ error: 'campaign_not_found' });
    return res.status(200).json({ ok: true, campaign: rows[0] });
  } catch (e) {
    console.error('[admin/social-tasks] deactivate campaign error', { message: e?.message });
    return res.status(500).json({ error: 'deactivate_campaign_failed' });
  }
}
