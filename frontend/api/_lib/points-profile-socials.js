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
};

const SOCIAL_LINK_META = {
  instagram: {
    label: 'Instagram',
    network: 'instagram',
  },
  tiktok: {
    label: 'TikTok',
    network: 'tiktok',
  },
  twitter: {
    label: 'X (Twitter)',
    network: 'twitter',
  },
  x: {
    label: 'X',
    network: 'twitter',
  },
};

function cleanHandle(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^@+/, '');
  return trimmed || null;
}

export function buildAdminProfileSocials(rows) {
  return (rows || []).map((row) => {
    const taskKey = String(row.task_key || '');
    const meta = SOCIAL_TASK_META[taskKey] || {};
    const proofUrl = typeof row.proof_url === 'string' && row.proof_url.trim()
      ? row.proof_url.trim()
      : null;
    const targetUrl = typeof row.target_url === 'string' && row.target_url.trim()
      ? row.target_url.trim()
      : null;
    const network = row.platform ? String(row.platform).trim().toLowerCase() : null;

    return {
      id: Number(row.id),
      taskKey,
      label: row.task_label || meta.label || taskKey,
      network: network || meta.network || 'social',
      status: row.status || 'pending',
      reward: Number(row.reward || 0),
      proofUrl,
      targetUrl,
      reviewer: row.reviewer || null,
      reviewedAt: row.reviewed_at || null,
      rejectionNote: row.rejection_note || null,
      createdAt: row.created_at || null,
    };
  });
}

export function buildAdminProfileSocialLinks(rows) {
  return (rows || []).map((row) => {
    const provider = String(row.provider || '').trim().toLowerCase();
    const meta = SOCIAL_LINK_META[provider] || {};
    const profileUrl = typeof row.profile_url === 'string' && row.profile_url.trim()
      ? row.profile_url.trim()
      : null;

    return {
      provider,
      label: meta.label || provider || 'Social',
      network: meta.network || provider || 'social',
      providerUserId: row.provider_user_id || null,
      handle: cleanHandle(row.handle),
      profileUrl,
      rewardCredited: Boolean(row.reward_credited),
      linkedAt: row.linked_at || null,
    };
  });
}
