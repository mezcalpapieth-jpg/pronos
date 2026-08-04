/**
 * GET /api/points/social-tasks/catalog
 *
 * Returns available social tasks plus the caller's status for each
 * (pending / approved / rejected / not_submitted). Admin-created post
 * tasks are hidden unless the caller opens their expiring ?task=<key>
 * link.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { readSession } from '../../_lib/session.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export const STATIC_TASK_CATALOG = [
  {
    key: 'instagram_follow',
    label: 'Seguir @pronos.latam en Instagram',
    description: 'Sigue nuestra cuenta de Instagram y sube captura del perfil con tu usuario visible.',
    reward: 25,
    network: 'instagram',
    url: 'https://instagram.com/pronos.latam',
  },
  {
    key: 'tiktok_follow',
    label: 'Seguir @pronos.io en TikTok',
    description: 'Sigue nuestra cuenta de TikTok y sube captura del perfil con tu usuario visible.',
    reward: 25,
    network: 'tiktok',
    url: 'https://tiktok.com/@pronos.io',
  },
  {
    key: 'twitter_follow',
    label: 'Seguir @pronos_io en X (Twitter)',
    description: 'Sigue nuestra cuenta de X y sube captura del perfil con tu usuario visible.',
    reward: 25,
    network: 'twitter',
    url: 'https://twitter.com/pronos_io',
  },
];

const PLATFORM_LABELS = {
  x: 'X',
  twitter: 'X',
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

function normalizePlatform(platform) {
  const value = String(platform || '').trim().toLowerCase();
  return value === 'twitter' ? 'x' : value;
}

export function campaignTaskFromRow(row) {
  const platform = normalizePlatform(row?.platform);
  const platformLabel = PLATFORM_LABELS[platform] || 'Red social';
  return {
    key: row.task_key,
    label: row.label || `Interactuar con post en ${platformLabel}`,
    description: row.description || `Abre el enlace exacto de ${platformLabel}, completa la tarea y márcala para revisión.`,
    reward: Number(row.reward || 0),
    network: platform,
    url: row.target_url,
    expiresAt: row.expires_at || null,
    hidden: Boolean(row.hidden),
    source: 'campaign',
  };
}

export async function findSocialTaskByKey(sqlClient, key) {
  const normalizedKey = String(key || '').trim();
  const staticTask = STATIC_TASK_CATALOG.find(t => t.key === normalizedKey);
  if (staticTask) return staticTask;
  if (!normalizedKey || !sqlClient) return null;

  const rows = await sqlClient`
    SELECT task_key, platform, target_url, label, description, reward,
           hidden, expires_at
    FROM social_task_campaigns
    WHERE task_key = ${normalizedKey}
      AND active = TRUE
      AND expires_at > NOW()
    LIMIT 1
  `;
  return rows[0] ? campaignTaskFromRow(rows[0]) : null;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = readSession(req, res);
  const requestedTaskKey = String(req.query.task || '').trim();

  let submissions = {};
  let campaignTasks = [];
  let schemaReady = false;
  try {
    await ensurePointsSchema(schemaSql);
    schemaReady = true;
    const rows = await sql`
      SELECT task_key, platform, target_url, label, description, reward,
             hidden, expires_at
      FROM social_task_campaigns
      WHERE active = TRUE
        AND expires_at > NOW()
        AND (hidden = FALSE OR task_key = ${requestedTaskKey || null})
      ORDER BY created_at DESC
      LIMIT 50
    `;
    campaignTasks = rows.map(campaignTaskFromRow);
  } catch (e) {
    console.error('[social-tasks/catalog] campaign db error', { message: e?.message });
  }

  if (session?.username) {
    try {
      if (schemaReady) {
        const rows = await sql`
          SELECT task_key, status, reviewed_at, rejection_note
          FROM social_tasks
          WHERE username = ${session.username.toLowerCase()}
        `;
        for (const r of rows) submissions[r.task_key] = r;
      }
    } catch (e) {
      console.error('[social-tasks/catalog] db error', { message: e?.message });
    }
  }

  const tasks = requestedTaskKey ? [...campaignTasks, ...STATIC_TASK_CATALOG] : [...STATIC_TASK_CATALOG, ...campaignTasks];
  return res.status(200).json({
    tasks: tasks.map(t => ({
      ...t,
      status: submissions[t.key]?.status || 'not_submitted',
      reviewedAt: submissions[t.key]?.reviewed_at || null,
      rejectionNote: submissions[t.key]?.rejection_note || null,
    })),
  });
}
