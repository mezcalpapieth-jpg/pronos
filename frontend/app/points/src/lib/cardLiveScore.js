import { findTeamByName } from '../../../src/lib/teamProfiles.js';
import { normalizeSportsTeamName } from '../../../../shared/sports-team-names.js';

const cache = new Map();
const CACHE_MS = 20_000;

export function cardScoreWindowOpen(market, now = Date.now()) {
  if (market?.status !== 'active' || !market.liveScoreConfig || market.seriesLocked) return false;
  const start = new Date(market.startTime || '').getTime();
  const end = new Date(market.endTime || '').getTime();
  return Number.isFinite(start) && start <= now
    && Number.isFinite(end) && end > start && end - start <= 14 * 86_400_000
    && now <= end + 6 * 3600_000;
}

export function cardLiveScoreUrl(config) {
  if (!config?.leaguePath || (!config.eventId && !(config.homeName && config.awayName))) return null;
  const params = new URLSearchParams({ source: config.source || 'espn', leaguePath: config.leaguePath });
  for (const key of ['eventId', 'dateYmd', 'homeName', 'awayName']) {
    if (config[key]) params.set(key, config[key]);
  }
  return `/api/sports/live-score?${params}`;
}

// Several cards can refer to the same game. Share both in-flight requests and
// recent responses; never make a separate provider request for each outcome.
export function loadCardLiveScore(url, { fetchImpl = fetch, now = Date.now() } = {}) {
  const cached = cache.get(url);
  if (cached?.pending) return cached.pending;
  if (cached && now - cached.at < CACHE_MS) return Promise.resolve(cached.score);
  for (const [key, entry] of cache) {
    if (!entry.pending && now - entry.at > 5 * 60_000) cache.delete(key);
  }
  const pending = Promise.resolve().then(async () => {
    try {
      // Revalidate the browser cache on each poll; the endpoint's shared-cache
      // stale-while-revalidate policy must not suppress our scheduled refresh.
      const response = await fetchImpl(url, { cache: 'no-cache', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('live_score_unavailable');
      const score = (await response.json())?.liveScore || null;
      cache.set(url, { at: Date.now(), score });
      return score;
    } catch {
      cache.set(url, { at: Date.now(), score: null });
      return null;
    }
  });
  cache.set(url, { at: now, pending });
  return pending;
}

function teamKey(sport, name) {
  return findTeamByName(sport, name)?.slug || normalizeSportsTeamName(name);
}

function abbreviation(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map(word => word[0]).join('') : words[0] || '').slice(0, 3).toUpperCase();
}

export function compactCardScore(market, score, now = Date.now()) {
  if (!score || !cardScoreWindowOpen(market, now)) return null;
  if (market.liveScoreConfig.eventId && String(score.eventId) !== String(market.liveScoreConfig.eventId)) return null;
  if (score.state !== 'in' && !(score.completed === true && score.state === 'post')) return null;
  const updated = new Date(score.lastUpdatedAt || '').getTime();
  if (!Number.isFinite(updated) || now - updated > 90_000 || updated - now > 60_000) return null;
  const validTeam = team => team?.name && typeof team.score === 'number' && Number.isFinite(team.score) && team.score >= 0;
  if (!validTeam(score.home) || !validTeam(score.away)) return null;
  const sport = market.sport || score.sport;
  const homeKey = teamKey(sport, score.home.name);
  const awayKey = teamKey(sport, score.away.name);
  const firstKey = (market.outcomes || []).map(name => teamKey(sport, name))
    .find(key => key === homeKey || key === awayKey);
  // Follow the card's team order; binary Sí/No cards retain the detail page's
  // away/home order and show team abbreviations to make the order explicit.
  const teams = firstKey === homeKey ? [score.home, score.away] : [score.away, score.home];
  return {
    left: { ...teams[0], abbreviation: abbreviation(teams[0].name) },
    right: { ...teams[1], abbreviation: abbreviation(teams[1].name) },
    status: score.completed ? 'Final' : score.statusLabel || score.clock || '',
    completed: score.completed === true,
  };
}
