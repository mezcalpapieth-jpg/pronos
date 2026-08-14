export function isDatabaseQuotaError(error) {
  if (!error) return false;
  const status = Number(error.status || error.statusCode || error.response?.status || 0);
  const message = String(error.message || '');
  return status === 402
    || /\bHTTP status 402\b/i.test(message)
    || /exceeded the compute time quota/i.test(message);
}

export function socialTasksUnavailablePayload() {
  return {
    tasks: [],
    unavailable: true,
    error: 'db_quota_exceeded',
  };
}
