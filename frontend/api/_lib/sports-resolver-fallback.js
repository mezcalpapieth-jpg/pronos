import { buildEspnLiveScoreConfig } from './espn-live-score.js';

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function buildFootballDataEspnFallbackConfig({
  resolverConfig,
  sourceData,
  sport,
  league,
  startTime,
}) {
  const cfg = parseJsonb(resolverConfig, null);
  if (cfg?.source !== 'football-data') return null;

  const fallback = buildEspnLiveScoreConfig({
    resolverType: null,
    resolverConfig: null,
    sourceData,
    sport,
    league,
    startTime,
  });
  if (!fallback?.leaguePath) return null;

  return {
    ...fallback,
    shape: cfg.shape || null,
    originalSource: 'football-data',
    originalMatchId: cfg.matchId == null ? null : String(cfg.matchId),
  };
}
