export async function authFetch(getAccessToken, url, options = {}) {
  const headers = new Headers(options.headers || {});

  if (typeof getAccessToken === 'function') {
    const token = await getAccessToken().catch(() => null);
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(url, { ...options, headers });
}
