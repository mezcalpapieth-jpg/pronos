async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export async function adminListMvpTaskCounts() {
  const [pendingResult, resolutionResult, disputedResult, socialResult] = await Promise.allSettled([
    getJson('/api/protocol/admin/pending-markets?status=pending'),
    getJson('/api/protocol/admin/resolution-candidates?status=pending'),
    getJson('/api/protocol/markets?status=disputed&limit=200'),
    getJson('/api/points/admin/social-tasks?status=pending'),
  ]);

  const pendingData = pendingResult.status === 'fulfilled' ? pendingResult.value : null;
  const resolutionData = resolutionResult.status === 'fulfilled' ? resolutionResult.value : null;
  const disputedData = disputedResult.status === 'fulfilled' ? disputedResult.value : null;
  const socialData = socialResult.status === 'fulfilled' ? socialResult.value : null;
  const pendingResolve = resolutionData?.ok
    ? Number(resolutionData.data?.pendingCount || 0) + Number(resolutionData.data?.overdueCount || 0)
    : 0;
  const disputed = disputedData?.ok && Array.isArray(disputedData.data?.markets)
    ? disputedData.data.markets.length
    : 0;

  const counts = {
    pending: pendingData?.ok && Array.isArray(pendingData.data?.pending)
      ? pendingData.data.pending.length
      : 0,
    pendingResolve,
    disputed,
    markets: pendingResolve + disputed,
    social: socialData?.ok && Array.isArray(socialData.data?.tasks)
      ? socialData.data.tasks.length
      : 0,
  };

  return {
    ...counts,
    total: counts.pending + counts.markets + counts.social,
  };
}
