import { useEffect, useState } from 'react';
import { findTeamByName } from './teamProfiles.js';

export const FEATURED_TEAMS_STORAGE_KEY = 'pronos-featured-teams-v1';
const FEATURED_TEAMS_EVENT = 'pronos:featured-teams';

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function featuredTeamKey(team) {
  if (!team?.sport || !team?.slug) return null;
  return `${team.sport}:${team.slug}`;
}

export function readFeaturedTeamKeys() {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FEATURED_TEAMS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

function writeFeaturedTeamKeys(keys) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(FEATURED_TEAMS_STORAGE_KEY, JSON.stringify([...new Set(keys)]));
  window.dispatchEvent(new CustomEvent(FEATURED_TEAMS_EVENT));
}

export function isFeaturedTeam(team, keys = readFeaturedTeamKeys()) {
  const key = featuredTeamKey(team);
  return !!key && keys.includes(key);
}

export function toggleFeaturedTeam(team) {
  const key = featuredTeamKey(team);
  if (!key) return false;
  const keys = readFeaturedTeamKeys();
  const next = keys.includes(key)
    ? keys.filter(item => item !== key)
    : [...keys, key];
  writeFeaturedTeamKeys(next);
  return next.includes(key);
}

export function useFeaturedTeamKeys() {
  const [keys, setKeys] = useState(() => readFeaturedTeamKeys());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refresh = () => setKeys(readFeaturedTeamKeys());
    window.addEventListener('storage', refresh);
    window.addEventListener(FEATURED_TEAMS_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(FEATURED_TEAMS_EVENT, refresh);
    };
  }, []);

  return keys;
}

export function marketMatchesFeaturedTeam(market, keys = []) {
  if (!Array.isArray(keys) || keys.length === 0) return false;
  const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
  const sport = market?.sport || market?.league || '';
  return outcomes.some(label => {
    const team = findTeamByName(sport, label);
    const key = featuredTeamKey(team);
    return !!key && keys.includes(key);
  });
}

export function prioritizeFeaturedMarkets(markets = [], keys = []) {
  const decorated = markets.map((market, index) => {
    const userFeaturedTeam = marketMatchesFeaturedTeam(market, keys);
    return {
      market: userFeaturedTeam
        ? { ...market, trending: true, userFeaturedTeam: true }
        : market,
      index,
      userFeaturedTeam,
    };
  });

  decorated.sort((a, b) => {
    if (a.userFeaturedTeam !== b.userFeaturedTeam) return a.userFeaturedTeam ? -1 : 1;
    return a.index - b.index;
  });

  return decorated.map(item => item.market);
}
