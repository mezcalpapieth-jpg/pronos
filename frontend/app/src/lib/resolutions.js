// ─── RESOLUTIONS API ──────────────────────────────────────────────────────────
// Fetches and submits market resolutions from our backend DB.
// Works independently of on-chain contracts — will layer on top later.

const API_BASE = '/api/resolutions';

/**
 * Fetch all market resolutions.
 * @returns {Promise<Array>} Array of resolution objects
 */
export async function fetchResolutions() {
  const res = await fetch(API_BASE);
  if (!res.ok) throw new Error(`Resolutions API ${res.status}`);
  const data = await res.json();
  return data.resolutions || [];
}

/**
 * Resolve a market (admin only).
 * @param {string} privyId - Admin's Privy ID
 * @param {object} params - { marketId, outcome, winner, winnerShort, resolvedBy, description }
 * @returns {Promise<object>} The created resolution
 */
export async function resolveMarket(privyId, { marketId, outcome, winner, winnerShort, resolvedBy, description }) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      privyId,
      marketId,
      outcome,
      winner,
      winnerShort: winnerShort || winner,
      resolvedBy: resolvedBy || 'Admin',
      description,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return (await res.json()).resolution;
}
