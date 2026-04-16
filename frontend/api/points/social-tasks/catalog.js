/**
 * GET /api/points/social-tasks/catalog
 *
 * Returns the catalog of available social tasks plus the caller's status
 * for each (pending / approved / rejected / not_submitted). No auth
 * required — lets logged-out users see the tasks before signing up.
 *
 * The catalog itself is hardcoded here so admins don't need to create
 * every task row. The `social_tasks` table only records *submissions*.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { readSession } from '../../_lib/session.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

// Keep this in sync with the campaign document. Adding a task here is
// enough — users can submit proof immediately; admins approve via
// /api/points/admin/social-tasks.
export const TASK_CATALOG = [
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
  {
    key: 'instagram_repost',
    label: 'Repostear una historia de @pronos.latam',
    description: 'Comparte cualquier historia de Pronos en tu Instagram y sube captura.',
    reward: 10,
    network: 'instagram',
  },
  {
    key: 'tiktok_like',
    label: 'Dar me-gusta a un video de @pronos.io',
    description: 'Dale like a cualquier video reciente y comparte captura con usuario visible.',
    reward: 5,
    network: 'tiktok',
  },
];

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = readSession(req, res);

  let submissions = {};
  if (session?.username) {
    try {
      await ensurePointsSchema(schemaSql);
      const rows = await sql`
        SELECT task_key, status, reviewed_at, rejection_note
        FROM social_tasks
        WHERE username = ${session.username.toLowerCase()}
      `;
      for (const r of rows) submissions[r.task_key] = r;
    } catch (e) {
      console.error('[social-tasks/catalog] db error', { message: e?.message });
    }
  }

  return res.status(200).json({
    tasks: TASK_CATALOG.map(t => ({
      ...t,
      status: submissions[t.key]?.status || 'not_submitted',
      reviewedAt: submissions[t.key]?.reviewed_at || null,
      rejectionNote: submissions[t.key]?.rejection_note || null,
    })),
  });
}
