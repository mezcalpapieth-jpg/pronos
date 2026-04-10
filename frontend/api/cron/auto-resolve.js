import { neon } from '@neondatabase/serverless';
import MARKETS from '../../app/src/lib/markets.js';
import { resolveEndDate } from '../../app/src/lib/deadline.js';

/**
 * Auto-resolve expired markets.
 *
 * Runs on a Vercel cron (see vercel.json, currently every 30 minutes). Flow:
 *   1. Load every market Pronos tracks:
 *        - hardcoded MARKETS (may carry _polyId/_conditionId for live ones)
 *        - approved rows from generated_markets
 *   2. Skip anything already present in market_resolutions.
 *   3. For each market whose deadline is in the past:
 *        a. Polymarket-backed → query Gamma API for `closed` + outcomePrices.
 *           If Polymarket reports a winning outcome, write it to
 *           market_resolutions so the client shows the winner instantly.
 *        b. Non-Polymarket (local mock or AI-generated without oracle)
 *           → insert a "closed, awaiting manual resolution" row so the UI
 *           surfaces it in the Resueltos tab with a distinct state. An admin
 *           can still override via /api/resolutions.
 *
 * Env vars:
 *   DATABASE_URL   (required)
 *   CRON_SECRET    (optional — if set, request must carry ?key= or Authorization)
 *
 * GET /api/cron/auto-resolve          — runs the resolver
 * GET /api/cron/auto-resolve?dry=1    — logs candidates without writing
 */

const sql = neon(process.env.DATABASE_URL);

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

// Any outcome priced ≥ this is treated as the confirmed winner by Polymarket.
const WIN_THRESHOLD = 0.97;

// ── Gamma lookup ───────────────────────────────────────────────────────────
async function fetchGammaMarket({ polyId, conditionId, slug }) {
  // Try every identifier we have — Gamma exposes lookup by id, condition_ids, and slug.
  const candidates = [];
  if (polyId) candidates.push(`${GAMMA_BASE}/markets/${encodeURIComponent(polyId)}`);
  if (conditionId) candidates.push(`${GAMMA_BASE}/markets?condition_ids=${encodeURIComponent(conditionId)}&limit=1`);
  if (slug) candidates.push(`${GAMMA_BASE}/markets?slug=${encodeURIComponent(slug)}&limit=1`);

  for (const url of candidates) {
    try {
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'pronos.io/1.0' },
      });
      if (!r.ok) continue;
      const data = await r.json();
      const pm = Array.isArray(data) ? data[0] : (data?.markets ? data.markets[0] : data);
      if (pm && typeof pm === 'object') return pm;
    } catch (_) { /* next candidate */ }
  }
  return null;
}

function extractWinner(pm) {
  if (!pm) return null;
  const prices = (pm.outcomePrices || []).map(Number);
  const outcomes = pm.outcomes || [];
  if (prices.length !== outcomes.length || outcomes.length === 0) return null;

  // Polymarket flags explicit resolution via `closed` + price convergence.
  if (!pm.closed) return null;

  let bestIdx = -1;
  let bestPct = 0;
  for (let i = 0; i < prices.length; i++) {
    if (prices[i] > bestPct) { bestPct = prices[i]; bestIdx = i; }
  }
  if (bestIdx === -1 || bestPct < WIN_THRESHOLD) return null;

  return {
    winner: outcomes[bestIdx],
    winnerShort: outcomes[bestIdx],
    outcome: bestPct >= 0.99 ? 'confirmed' : 'settled',
    description: pm.resolutionSource
      ? `Resuelto por Polymarket (${bestIdx === 0 ? outcomes[0] : outcomes[bestIdx]} ganó). Fuente: ${pm.resolutionSource}`
      : `Resuelto por Polymarket: ${outcomes[bestIdx]} ganó con ${Math.round(bestPct * 100)}%.`,
  };
}

// ── Candidate builder ──────────────────────────────────────────────────────
async function loadCandidates() {
  const out = [];
  const now = Date.now();

  // Local hardcoded markets
  for (const m of MARKETS) {
    const end = resolveEndDate(m);
    if (!end || end.getTime() >= now) continue;
    out.push({
      id: m.id,
      source: m._source || 'local',
      polyId: m._polyId || null,
      conditionId: m._conditionId || null,
      slug: m.id,
      options: m.options || [],
      endDate: end,
    });
  }

  // Approved AI-generated markets
  try {
    const rows = await sql`
      SELECT slug, options, deadline_date, deadline, generated_at
      FROM generated_markets
      WHERE status = 'approved'
    `;
    for (const row of rows) {
      const end = row.deadline_date ? new Date(row.deadline_date) : resolveEndDate({ deadline: row.deadline });
      if (!end || isNaN(end) || end.getTime() >= now) continue;
      out.push({
        id: row.slug,
        source: 'ai',
        polyId: null,
        conditionId: null,
        slug: row.slug,
        options: Array.isArray(row.options) ? row.options : JSON.parse(row.options || '[]'),
        endDate: end,
      });
    }
  } catch (e) {
    console.warn('auto-resolve: generated_markets query failed:', e.message);
  }

  return out;
}

async function alreadyResolvedSet() {
  try {
    const rows = await sql`SELECT market_id FROM market_resolutions`;
    return new Set(rows.map(r => r.market_id));
  } catch (e) {
    console.warn('auto-resolve: market_resolutions query failed:', e.message);
    return new Set();
  }
}

async function insertResolution({ marketId, outcome, winner, winnerShort, resolvedBy, description }) {
  await sql`
    INSERT INTO market_resolutions (market_id, outcome, winner, winner_short, resolved_by, description)
    VALUES (${marketId}, ${outcome}, ${winner}, ${winnerShort || winner}, ${resolvedBy || 'auto-resolver'}, ${description || null})
    ON CONFLICT (market_id) DO NOTHING
  `;
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Optional secret gate (Vercel cron requests carry ?key= or the auth header)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.query.key || (req.headers.authorization || '').replace('Bearer ', '');
    if (provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  }

  const dryRun = req.query.dry === '1' || req.query.dry === 'true';
  const started = Date.now();

  try {
    const [candidates, resolvedIds] = await Promise.all([
      loadCandidates(),
      alreadyResolvedSet(),
    ]);

    const pending = candidates.filter(c => !resolvedIds.has(c.id));
    const report = { checked: candidates.length, pending: pending.length, resolved: [], awaiting: [], errors: [] };

    for (const cand of pending) {
      try {
        // Polymarket-backed: ask Gamma for the real outcome
        if (cand.polyId || cand.conditionId) {
          const pm = await fetchGammaMarket(cand);
          const winner = extractWinner(pm);
          if (winner) {
            if (!dryRun) {
              await insertResolution({
                marketId: cand.id,
                outcome: winner.outcome,
                winner: winner.winner,
                winnerShort: winner.winnerShort,
                resolvedBy: 'Polymarket UMA',
                description: winner.description,
              });
            }
            report.resolved.push({ id: cand.id, winner: winner.winner, source: 'polymarket' });
            continue;
          }
        }

        // Fallback: mark as closed pending manual resolution so the UI
        // doesn't keep it in active tabs. Admin can override via /api/resolutions.
        if (!dryRun) {
          await insertResolution({
            marketId: cand.id,
            outcome: 'pending',
            winner: 'Pendiente de resolución',
            winnerShort: 'Pendiente',
            resolvedBy: 'auto-resolver',
            description: `Mercado cerrado el ${cand.endDate.toISOString().slice(0, 10)}. Esperando resolución manual.`,
          });
        }
        report.awaiting.push({ id: cand.id, source: cand.source });
      } catch (e) {
        report.errors.push({ id: cand.id, error: e.message });
      }
    }

    return res.status(200).json({
      ok: true,
      dryRun,
      tookMs: Date.now() - started,
      ...report,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
