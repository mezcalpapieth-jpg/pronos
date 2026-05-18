async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export async function adminListMvpTaskCounts() {
  const [pendingResult, resolutionResult, socialResult] = await Promise.allSettled([
    getJson('/api/protocol/admin/pending-markets?status=pending'),
    getJson('/api/protocol/admin/resolution-candidates?status=pending'),
    getJson('/api/points/admin/social-tasks?status=pending'),
  ]);

  const pendingData = pendingResult.status === 'fulfilled' ? pendingResult.value : null;
  const resolutionData = resolutionResult.status === 'fulfilled' ? resolutionResult.value : null;
  const socialData = socialResult.status === 'fulfilled' ? socialResult.value : null;

  const counts = {
    pending: pendingData?.ok && Array.isArray(pendingData.data?.pending)
      ? pendingData.data.pending.length
      : 0,
    markets: resolutionData?.ok
      ? Number(resolutionData.data?.pendingCount || 0) + Number(resolutionData.data?.overdueCount || 0)
      : 0,
    social: socialData?.ok && Array.isArray(socialData.data?.tasks)
      ? socialData.data.tasks.length
      : 0,
  };

  return {
    ...counts,
    total: counts.pending + counts.markets + counts.social,
  };
}
