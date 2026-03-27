const USER_API = '/api/user';
const usernameCache = new Map();

function cacheResolved(privyId, username) {
  usernameCache.set(privyId, Promise.resolve(username));
  return username;
}

export async function fetchUsername(privyId, { signal } = {}) {
  if (!privyId) return null;

  if (usernameCache.has(privyId)) {
    return usernameCache.get(privyId);
  }

  const request = fetch(`${USER_API}?privyId=${encodeURIComponent(privyId)}`, { signal })
    .then(async (response) => {
      if (response.status === 404) {
        return cacheResolved(privyId, null);
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo cargar el username');
      }

      return cacheResolved(privyId, data.username || null);
    })
    .catch((error) => {
      usernameCache.delete(privyId);
      throw error;
    });

  usernameCache.set(privyId, request);
  return request;
}

export async function createUsername(privyId, username) {
  const response = await fetch(USER_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privyId, username }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Error al guardar');
  }

  return cacheResolved(privyId, data.username || null);
}
