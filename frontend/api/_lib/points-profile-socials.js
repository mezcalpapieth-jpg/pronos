const SOCIAL_TASK_META = {
  instagram_follow: {
    label: 'Seguir @pronos.latam en Instagram',
    network: 'instagram',
  },
  tiktok_follow: {
    label: 'Seguir @pronos.io en TikTok',
    network: 'tiktok',
  },
  twitter_follow: {
    label: 'Seguir @pronos_io en X (Twitter)',
    network: 'twitter',
  },
  instagram_repost: {
    label: 'Repostear una historia de @pronos.latam',
    network: 'instagram',
  },
  tiktok_like: {
    label: 'Dar me-gusta a un video de @pronos.io',
    network: 'tiktok',
  },
};

export function buildAdminProfileSocials(rows) {
  return (rows || []).map((row) => {
    const taskKey = String(row.task_key || '');
    const meta = SOCIAL_TASK_META[taskKey] || {};
    const proofUrl = typeof row.proof_url === 'string' && row.proof_url.trim()
      ? row.proof_url.trim()
      : null;

    return {
      id: Number(row.id),
      taskKey,
      label: meta.label || taskKey,
      network: meta.network || 'social',
      status: row.status || 'pending',
      reward: Number(row.reward || 0),
      proofUrl,
      reviewer: row.reviewer || null,
      reviewedAt: row.reviewed_at || null,
      rejectionNote: row.rejection_note || null,
      createdAt: row.created_at || null,
    };
  });
}
