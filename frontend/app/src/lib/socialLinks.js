const EMPTY_LINKS = {
  x: null,
  instagram: null,
  tiktok: null,
};

function normalizeProvider(provider) {
  return provider === 'twitter' ? 'x' : provider;
}

async function handleJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.code = data?.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function getJson(url) {
  return handleJson(await fetch(url, { method: 'GET', credentials: 'include' }));
}

export async function postJson(url, body) {
  return handleJson(await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }));
}

export function normalizeSocialLinks(payload) {
  const out = { ...EMPTY_LINKS };
  const links = payload?.links;

  if (Array.isArray(links)) {
    for (const link of links) {
      const provider = normalizeProvider(link?.provider);
      if (provider && provider in out) out[provider] = link;
    }
    return out;
  }

  if (links && typeof links === 'object') {
    for (const [providerKey, link] of Object.entries(links)) {
      const provider = normalizeProvider(providerKey);
      if (provider && provider in out) out[provider] = link;
    }
  }

  return out;
}

export async function fetchSocialLinks() {
  return normalizeSocialLinks(await getJson('/api/points/social-links'));
}

export async function unlinkSocial(provider) {
  return postJson('/api/points/unlink-social', { provider: normalizeProvider(provider) });
}

export function socialLinkStartUrl(provider, returnTo = '/earn') {
  const normalized = normalizeProvider(provider);
  const q = new URLSearchParams({ returnTo }).toString();
  return `/api/social/${encodeURIComponent(normalized)}/start?${q}`;
}
