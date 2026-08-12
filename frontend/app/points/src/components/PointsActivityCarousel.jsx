/**
 * "Más activos" carousel — the markets with the strongest recent flow,
 * one slide each, chart on the left and a live trade tape on the right.
 *
 * Reference: Polymarket's market page, where the price chart sits next to
 * a running feed of fills. Ours keeps the Pronos card language (mono
 * micro-labels, Bebas numbers, surface1 panels) and the trading palette
 * the rest of the app already uses — green (--yes) for buys, red
 * (--danger) for sells. Never --green, which is the brand orange here.
 *
 * Everything on screen is real data, all of it from /api/points/trade-activity
 * — the same anonymous, bucketed feed the market detail chart already uses.
 * That endpoint deliberately never exposes individual users, so the tape
 * shows hourly buy/sell flow rather than a per-user fill ticker.
 *   - slotting     → hidden editorial mix of 1h interaction, volume, 7d activity, BTC 5m
 *   - chart        → binary price history; parallel markets use parent flow
 *   - tape rows    → one row per hour that actually traded
 *   - pressure bar → buy vs sell volume across the window
 *
 * Admission is by real trading, not seed liquidity. Most slots require
 * recent fills, while the all-time volume slot uses `tradeVolume` to keep the
 * deepest market visible even if it has gone quiet in the last few hours.
 *
 * The tape re-staggers its rows on every slide change and re-polls every
 * 25s, so it reads as live without inventing flow that never happened.
 *
 * Props:
 *   markets — rows from /api/points/markets (the home grid's own list)
 *   count   — how many slides to build (default 6)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sparkline from '@app/components/Sparkline.jsx';
import MultiSparkline from '@app/components/MultiSparkline.jsx';
import { useIsMobile } from '@app/lib/useIsMobile.js';
import { useT } from '@app/lib/i18n.js';
import { ActivityCarouselSkeleton } from './PointsSkeleton.jsx';
import { fetchPriceHistory, fetchTradeActivity } from '../lib/pointsApi.js';

const SLIDE_MS = 8000;      // autoplay dwell per slide
const TAPE_POLL_MS = 25_000; // how often the visible slide refetches its flow
const TAPE_ROWS = 7;
// Largest window needed by the slot picker. The endpoint returns buckets for
// this whole window, then the UI derives 1h / 4h / 7d scores.
const WINDOW_HOURS = 24 * 7;
const WINDOW_BUCKETS = 120;
// Ask about a wide set so a newer, fast-moving market can beat older
// high-volume markets in the 1h / 4h slots.
const CANDIDATE_POOL = 120;
// The API bounds ids to 200. Parallel markets add one id per leg, so build
// requests in ranked order and let lower-volume candidates fall off first.
const MAX_ACTIVITY_IDS = 200;
const CHART_OUTCOME_LIMIT = 4;

const SLOT_DEFS = [
  { key: '1h-interactions', hours: 1, metric: 'count' },
  { key: '1h-volume', hours: 1, metric: 'volume' },
  { key: '4h-activity', hours: 4, metric: 'count' },
  { key: '4h-volume', hours: 4, metric: 'volume' },
  { key: 'total-volume', hours: null, metric: 'totalVolume' },
  { key: '7d-activity', hours: WINDOW_HOURS, metric: 'count' },
  { key: '7d-volume', hours: WINDOW_HOURS, metric: 'volume' },
];

const BUY_COLOR = 'var(--yes)';
const SELL_COLOR = 'var(--danger)';
const OUTCOME_COLORS = [
  'var(--yes)',
  'var(--gold)',
  '#ff3b3b',
  '#3b82f6',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
];

function displayCategory(category) {
  const key = String(category || 'general').trim().toLowerCase();
  if (key === 'musica') return 'Entretenimiento';
  return category || 'General';
}

function formatCompact(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

// Bucket start → compact local date + time. The tape now spans a week,
// so hour-only labels would be ambiguous.
function formatHour(unixSeconds) {
  if (!unixSeconds) return '';
  const d = new Date(Number(unixSeconds) * 1000);
  const date = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date}, ${time}`;
}

function marketIdKey(id) {
  return String(id);
}

function activityRequestForMarkets(markets, maxIds = MAX_ACTIVITY_IDS) {
  const ids = [];
  const ownerById = new Map();
  const parentIds = new Set();

  const add = (id, ownerId) => {
    if (id == null) return true;
    const key = marketIdKey(id);
    if (ownerById.has(key)) return true;
    if (ids.length >= maxIds) return false;
    ids.push(id);
    const parentId = marketIdKey(ownerId);
    ownerById.set(key, parentId);
    parentIds.add(parentId);
    return true;
  };

  for (const m of markets || []) {
    if (!m?.id) continue;
    const parentId = m.id;
    if (!add(parentId, parentId)) break;
    if (m.ammMode === 'parallel' && Array.isArray(m.legIds)) {
      for (const legId of m.legIds) {
        if (!add(legId, parentId)) break;
      }
    }
  }

  return { ids, ownerById, parentIds };
}

function rollupActivityByParent(activity, request) {
  const ownerById = request?.ownerById || new Map();
  const grouped = new Map();
  for (const parentId of request?.parentIds || []) grouped.set(parentId, new Map());

  for (const [sourceId, buckets] of Object.entries(activity || {})) {
    const parentId = ownerById.get(marketIdKey(sourceId));
    if (!parentId || !Array.isArray(buckets)) continue;
    if (!grouped.has(parentId)) grouped.set(parentId, new Map());
    const bucketMap = grouped.get(parentId);

    for (const b of buckets) {
      const t = Number(b.t || 0);
      if (!Number.isFinite(t) || t <= 0) continue;
      const current = bucketMap.get(t) || {
        t,
        count: 0,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
      };
      current.count += Number(b.count || 0);
      current.volume += Number(b.volume || 0);
      current.buyVolume += Number(b.buyVolume || 0);
      current.sellVolume += Number(b.sellVolume || 0);
      bucketMap.set(t, current);
    }
  }

  const rolled = {};
  for (const [parentId, bucketMap] of grouped.entries()) {
    rolled[parentId] = [...bucketMap.values()]
      .sort((a, b) => Number(a.t) - Number(b.t))
      .map(b => ({
        t: b.t,
        count: b.count,
        volume: Math.round(b.volume * 100) / 100,
        buyVolume: Math.round(b.buyVolume * 100) / 100,
        sellVolume: Math.round(b.sellVolume * 100) / 100,
      }));
  }
  return rolled;
}

function priceHistoryRequestForMarkets(markets) {
  const groups = new Map();
  const parentIds = new Set();

  const add = ({ sourceId, parentId, outcomeIndex, sourceOutcome }) => {
    if (sourceId == null || parentId == null) return;
    const groupKey = String(sourceOutcome || 0);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        outcome: Number(sourceOutcome || 0),
        ids: [],
        targets: [],
        seen: new Set(),
      });
    }
    const group = groups.get(groupKey);
    const sourceKey = marketIdKey(sourceId);
    const targetKey = `${sourceKey}:${marketIdKey(parentId)}:${outcomeIndex}`;
    if (group.seen.has(targetKey)) return;
    group.seen.add(targetKey);
    if (!group.ids.some(id => marketIdKey(id) === sourceKey)) group.ids.push(sourceId);
    parentIds.add(marketIdKey(parentId));
    group.targets.push({
      sourceKey,
      parentKey: marketIdKey(parentId),
      outcomeIndex,
    });
  };

  for (const m of markets || []) {
    if (!m?.id) continue;
    const entries = chartEntriesForMarket(m);
    if (m.ammMode === 'parallel') {
      if (!Array.isArray(m.legIds) || m.legIds.length === 0) continue;
      for (const entry of entries) {
        add({
          sourceId: m.legIds[entry.index],
          parentId: m.id,
          outcomeIndex: entry.index,
          sourceOutcome: 0,
        });
      }
      continue;
    }

    for (const entry of entries) {
      add({
        sourceId: m.id,
        parentId: m.id,
        outcomeIndex: entry.index,
        sourceOutcome: entry.index,
      });
    }
  }

  return {
    groups: [...groups.values()].map(group => ({
      outcome: group.outcome,
      ids: group.ids,
      targets: group.targets,
    })),
    parentIds,
  };
}

function remapHistoryByParent(results, request) {
  const mapped = {};
  for (const parentId of request?.parentIds || []) mapped[parentId] = [];

  for (const result of results || []) {
    const group = result?.group;
    const history = result?.history || {};
    for (const target of group?.targets || []) {
      if (!mapped[target.parentKey]) mapped[target.parentKey] = [];
      mapped[target.parentKey][target.outcomeIndex] = Array.isArray(history[target.sourceKey])
        ? history[target.sourceKey]
        : [];
    }
  }

  return mapped;
}

function seriesForSlide(m, history) {
  if (!m) return [];
  return history?.[marketIdKey(m.id)] || history?.[m.id] || [];
}

function outcomeEntriesForMarket(m, limit = 4) {
  const outcomes = Array.isArray(m?.outcomes) ? m.outcomes : ['Sí', 'No'];
  const prices = Array.isArray(m?.prices) ? m.prices : [];
  const legIds = Array.isArray(m?.legIds) && m.legIds.length === outcomes.length
    ? m.legIds
    : null;
  const legStatuses = Array.isArray(m?.legStatuses) && m.legStatuses.length === outcomes.length
    ? m.legStatuses
    : null;
  const legOutcomes = Array.isArray(m?.legOutcomes) && m.legOutcomes.length === outcomes.length
    ? m.legOutcomes
    : null;
  const entries = outcomes.map((label, index) => ({
    label,
    index,
    price: Number(prices[index] ?? 0),
    legId: legIds?.[index] ?? null,
    legStatus: legStatuses?.[index] || null,
    legOutcome: legOutcomes?.[index] ?? null,
  }));

  if (m?.ammMode === 'parallel') {
    const activeEntries = entries.filter(entry => (
      legStatuses
        ? String(entry.legStatus || '').toLowerCase() === 'active'
        : Number(entry.price) > 0
    ));
    const visible = activeEntries.length > 0 ? activeEntries : entries;
    return visible
      .sort((a, b) => b.price - a.price || a.index - b.index)
      .slice(0, limit);
  }

  if (entries.length <= 2) return entries.slice(0, limit);
  return [...entries]
    .sort((a, b) => b.price - a.price || a.index - b.index)
    .slice(0, limit);
}

function chartEntriesForMarket(m) {
  const outcomes = Array.isArray(m?.outcomes) ? m.outcomes : ['Sí', 'No'];
  if (m?.ammMode !== 'parallel' && outcomes.length <= 2) {
    return outcomeEntriesForMarket(m, 1);
  }
  return outcomeEntriesForMarket(m, CHART_OUTCOME_LIMIT);
}

function leadingOutcomeForMarket(m, tiedLabel = 'Empatado') {
  const entries = outcomeEntriesForMarket(m, Number.POSITIVE_INFINITY)
    .filter(entry => Number.isFinite(entry.price));
  if (entries.length === 0) return {
    label: tiedLabel,
    pct: 50,
    tied: true,
  };
  const topPct = Math.round((entries[0].price || 0) * 100);
  const tiedCount = entries.filter(entry => Math.round((entry.price || 0) * 100) === topPct).length;
  return {
    label: tiedCount > 1 ? tiedLabel : entries[0].label,
    pct: topPct,
    tied: tiedCount > 1,
  };
}

function bucketsForWindow(buckets, hours, nowSeconds) {
  if (!Array.isArray(buckets)) return [];
  if (!hours) return buckets;
  const cutoff = nowSeconds - (hours * 60 * 60);
  // Keep the overlapping floor bucket so the "last hour" slot does not
  // disappear for trades that happened just before the current hour mark.
  return buckets.filter(b => Number(b.t || 0) >= cutoff - 3600);
}

function bucketTotals(buckets) {
  return buckets.reduce((acc, b) => ({
    count: acc.count + Number(b.count || 0),
    volume: acc.volume + Number(b.volume || 0),
    buy: acc.buy + Number(b.buyVolume || 0),
    sell: acc.sell + Number(b.sellVolume || 0),
  }), { count: 0, volume: 0, buy: 0, sell: 0 });
}

function rankedByWindowMetric(markets, recent, slot, used, nowSeconds) {
  const metric = slot?.metric || 'volume';
  return markets
    .filter(m => !used.has(m.id))
    .map(m => {
      const buckets = bucketsForWindow(recent[m.id] || [], slot?.hours, nowSeconds);
      const totals = bucketTotals(buckets);
      return { market: m, buckets, totals };
    })
    .filter(entry => (metric === 'count' ? entry.totals.count > 0 : entry.totals.volume > 0))
    .sort((a, b) => {
      if (metric === 'count') {
        return (b.totals.count - a.totals.count) || (b.totals.volume - a.totals.volume);
      }
      return (b.totals.volume - a.totals.volume) || (b.totals.count - a.totals.count);
    });
}

function rankedByAllTimeVolume(markets, used) {
  return markets
    .filter(m => !used.has(m.id) && Number(m._vol || 0) > 0)
    .sort((a, b) => Number(b._vol || 0) - Number(a._vol || 0));
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function PointsActivityCarousel({ markets = [], count = 6 }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const t = useT();

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [history, setHistory] = useState({});
  // Bucketed fills for the last seven days, keyed by display market id.
  // Parallel legs are rolled back onto their parent before this lands.
  // One fetch feeds all three things on screen: who gets a slide, the
  // pressure bar, and the tape rows. Null until it lands — no slides
  // before we know who actually traded.
  const [recent, setRecent] = useState(null);
  // Bumped on every slide change so the tape rows remount and replay
  // their stagger — the panel reads as freshly filled, not static.
  const [tapeEpoch, setTapeEpoch] = useState(0);
  const touchStartX = useRef(null);

  // Candidates: markets with evidence of REAL trading at some point.
  // `tradeVolume` is the sum of actual fills — never `volume`, which is
  // seed liquidity and is non-zero on every market ever created, traded
  // or not. This is only the shortlist we ask about; the recency filter
  // below is what actually decides.
  const candidates = useMemo(() => {
    const now = Date.now();
    return markets
      .filter(m => m.status === 'active'
        && !m.seriesLocked
        // Pending = deadline passed, awaiting resolution. Nothing trades
        // there, so it has no business in an activity carousel.
        && !(m.endTime && new Date(m.endTime).getTime() < now))
      .map(m => ({
        ...m,
        _vol: Number(m.tradeVolume || 0),
      }))
      .filter(m => m._vol > 0)
      .sort((a, b) => b._vol - a._vol)
      .slice(0, CANDIDATE_POOL);
  }, [markets]);

  const activityRequest = useMemo(() => activityRequestForMarkets(candidates), [candidates]);
  const activityIds = activityRequest.ids;
  const activityKey = activityIds.join(',');

  // Ask the activity endpoint which of those actually traded inside the
  // window. The slot picker below then derives hidden 1h / 4h / 7d leaders
  // from these same buckets.
  useEffect(() => {
    if (activityIds.length === 0) {
      setRecent({});
      return undefined;
    }
    let cancelled = false;
    // outcome=all, not 0: on a binary market a buy on NO still moves the
    // YES price, so counting only outcome 0 would hide half the flow.
    // Parallel parents store fills on leg ids, so request parent + legs
    // and roll the activity back to the parent card.
    fetchTradeActivity(activityIds, {
      hours: WINDOW_HOURS,
      outcome: 'all',
      buckets: WINDOW_BUCKETS,
    }).then(a => {
      if (!cancelled) setRecent(rollupActivityByParent(a || {}, activityRequest));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityKey, activityRequest]);

  // Pinned slot: the live BTC market earns its place on price movement,
  // not on fills — the 5-minute rollovers tick constantly from Chainlink
  // but often carry zero user trades. It is the one market allowed in
  // without clearing the fills bar, so its flow panel states plainly
  // that nobody has traded it rather than implying activity.
  const pinned = useMemo(() => {
    const now = Date.now();
    return markets.find(m => m.status === 'active'
      && m.live
      && m.crypto5min
      && /bitcoin|btc/i.test(m.question || '')
      && !(m.endTime && new Date(m.endTime).getTime() < now)) || null;
  }, [markets]);

  const slides = useMemo(() => {
    if (!recent) return [];
    const nowSeconds = Math.floor(Date.now() / 1000);
    const used = new Set();
    const picked = [];
    const nonPinnedLimit = pinned ? Math.max(0, count - 1) : count;

    const addWindowSlot = (slot) => {
      if (picked.length >= nonPinnedLimit) return;
      const [entry] = rankedByWindowMetric(candidates, recent, slot, used, nowSeconds);
      if (!entry) return;
      used.add(entry.market.id);
      const historyBuckets = bucketsForWindow(recent[entry.market.id] || [], WINDOW_HOURS, nowSeconds);
      const historyTotals = bucketTotals(historyBuckets);
      picked.push({
        ...entry.market,
        _slotKey: slot.key,
        _slotMetric: slot.metric,
        _windowHours: slot.hours,
        // Selection can be 1H or 4H, but the visible tape should tell
        // the whole recent story for that market, not only the narrow
        // signal that got it into the carousel.
        _buckets: [...historyBuckets].sort((a, b) => Number(b.t) - Number(a.t)),
        _count: historyTotals.count,
        _displayVolume: historyTotals.volume,
        _buyWindow: historyTotals.buy,
        _sellWindow: historyTotals.sell,
      });
    };

    const addTotalSlot = (slot) => {
      if (picked.length >= nonPinnedLimit) return;
      const [m] = rankedByAllTimeVolume(candidates, used);
      if (!m) return;
      const buckets = bucketsForWindow(recent[m.id] || [], WINDOW_HOURS, nowSeconds);
      const totals = bucketTotals(buckets);
      used.add(m.id);
      picked.push({
        ...m,
        _slotKey: slot.key,
        _slotMetric: slot.metric,
        _windowHours: WINDOW_HOURS,
        _buckets: [...buckets].sort((a, b) => Number(b.t) - Number(a.t)),
        _count: totals.count,
        _displayVolume: Number(m._vol || 0),
        _buyWindow: totals.buy,
        _sellWindow: totals.sell,
      });
    };

    for (const slot of SLOT_DEFS) {
      if (slot.metric === 'totalVolume') addTotalSlot(slot);
      else addWindowSlot(slot);
    }

    // If one of the fixed slots had no eligible market, fill the empty
    // space with the next strongest 7d volume leader so the carousel
    // still feels alive without duplicating a market.
    while (picked.length < nonPinnedLimit) {
      const [entry] = rankedByWindowMetric(
        candidates,
        recent,
        { key: '7d-volume-extra', hours: WINDOW_HOURS, metric: 'volume' },
        used,
        nowSeconds,
      );
      if (!entry) break;
      used.add(entry.market.id);
      const totals = entry.totals;
      picked.push({
        ...entry.market,
        _slotKey: '7d-volume-extra',
        _slotMetric: 'volume',
        _windowHours: WINDOW_HOURS,
        _buckets: [...entry.buckets].sort((a, b) => Number(b.t) - Number(a.t)),
        _count: totals.count,
        _displayVolume: totals.volume,
        _buyWindow: totals.buy,
        _sellWindow: totals.sell,
      });
    }

    // Pinned market takes the final slot. It earns its place on price
    // movement, not fills, so its flow panel states plainly when nobody
    // has traded it.
    if (pinned && picked.length < count && !used.has(pinned.id)) {
      picked.push({
        ...pinned,
        _pinned: true,
        _slotKey: 'btc5m',
        _slotMetric: 'price',
        _windowHours: null,
        _buckets: [],
        _count: 0,
        _displayVolume: 0,
        _buyWindow: 0,
        _sellWindow: 0,
      });
    }

    return picked.slice(0, count);
  }, [candidates, recent, count, pinned]);

  const priceHistoryRequest = useMemo(() => priceHistoryRequestForMarkets(slides), [slides]);
  const priceHistoryGroups = priceHistoryRequest.groups;
  const idsKey = priceHistoryGroups
    .map(group => `${group.outcome}:${group.ids.map(marketIdKey).join('|')}`)
    .join(';');

  // Clamp the cursor when the ranking shrinks under it (markets resolve,
  // search narrows the list) so we never park on a removed slide.
  useEffect(() => {
    setIndex(i => (slides.length === 0 ? 0 : Math.min(i, slides.length - 1)));
  }, [slides.length]);

  // Charts for the markets that made the cut. fetchPriceHistory swallows
  // its own errors and resolves to {}, so a cold snapshot table degrades
  // to the Sparkline's flat state instead of taking down home.
  useEffect(() => {
    if (priceHistoryGroups.length === 0) {
      setHistory({});
      return undefined;
    }
    let cancelled = false;
    Promise.all(
      priceHistoryGroups.map(group =>
        fetchPriceHistory(group.ids, { days: 30, outcome: group.outcome, limit: 120 })
          .then(history => ({ group, history: history || {} })),
      ),
    ).then(results => {
      if (!cancelled) setHistory(remapHistoryByParent(results, priceHistoryRequest));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, priceHistoryRequest]);

  const active = slides[index] || null;

  // Keep the visible slide's flow warm. Only the market on screen polls —
  // refreshing every slide would multiply the load for rows nobody sees.
  useEffect(() => {
    if (!active || paused) return undefined;
    const request = activityRequestForMarkets([active]);
    if (request.ids.length === 0) return undefined;
    const id = setInterval(() => {
      fetchTradeActivity(request.ids, {
        hours: WINDOW_HOURS,
        outcome: 'all',
        buckets: WINDOW_BUCKETS,
      }).then(a => {
        const rolled = rollupActivityByParent(a || {}, request);
        const buckets = rolled?.[active.id];
        // An empty poll (endpoint hiccup, cache miss) must not blank out
        // a slide the user is looking at — keep the flow we already have.
        if (!Array.isArray(buckets) || buckets.length === 0) return;
        setRecent(prev => {
          const prevBuckets = prev?.[active.id] || [];
          const prevTop = prevBuckets[prevBuckets.length - 1];
          const nextTop = buckets[buckets.length - 1];
          // Same newest bucket with the same count = nothing traded since
          // the last poll, so don't replay the stagger for no reason.
          if (prevTop && nextTop
            && Number(prevTop.t) === Number(nextTop.t)
            && Number(prevTop.count) === Number(nextTop.count)) return prev;
          setTapeEpoch(e => e + 1);
          return { ...prev, [active.id]: buckets };
        });
      });
    }, TAPE_POLL_MS);
    return () => clearInterval(id);
  }, [active, paused]);

  const go = useCallback((next) => {
    if (slides.length === 0) return;
    const wrapped = ((next % slides.length) + slides.length) % slides.length;
    setIndex(wrapped);
    setTapeEpoch(e => e + 1);
  }, [slides.length]);

  // Autoplay. Pauses on hover / focus / touch, and never runs for users
  // who asked for reduced motion.
  useEffect(() => {
    if (paused || slides.length <= 1 || prefersReducedMotion()) return undefined;
    const id = setInterval(() => go(index + 1), SLIDE_MS);
    return () => clearInterval(id);
  }, [paused, slides.length, index, go]);

  // Still asking who traded: hold the space so the hero below doesn't
  // jump once the answer arrives. Once we know and nobody qualifies,
  // collapse to nothing rather than showing an empty frame.
  if (recent === null) return <ActivityCarouselSkeleton isMobile={isMobile} />;
  if (slides.length === 0) return null;

  // Pressure comes from the bucketed activity, not from the tape rows —
  // the tape only holds the last handful of fills, while these are the
  // real buy/sell totals across the whole window.
  const buyPressure = active?._buyWindow || 0;
  const sellPressure = active?._sellWindow || 0;
  const pressureTotal = buyPressure + sellPressure;
  const buyPct = pressureTotal > 0 ? (buyPressure / pressureTotal) * 100 : 50;

  const chipStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--fs-2xs)',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    padding: '4px 8px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    background: 'var(--surface2)',
    whiteSpace: 'nowrap',
  };

  const arrowStyle = {
    width: 34,
    height: 34,
    borderRadius: '50%',
    border: '1px solid var(--border)',
    background: 'var(--surface1)',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--fs-sm)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'border-color 0.16s, color 0.16s',
  };

  return (
    <section
      className="points-activity"
      aria-roledescription="carousel"
      aria-label={t('points.activity.title')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      style={{
        padding: isMobile ? '24px 16px 8px' : '32px 48px 8px',
        maxWidth: 1280,
        margin: '0 auto',
      }}
    >
      {/* Section head — title left, position + arrows right */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 14,
        flexWrap: 'wrap',
      }}>
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 4 }}>
            {t('points.activity.eyebrow')}
          </div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: isMobile ? 26 : 32,
            letterSpacing: '0.02em',
            color: 'var(--text-primary)',
            textTransform: 'uppercase',
            lineHeight: 1,
          }}>
            {t('points.activity.title')}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {String(index + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
          </span>
          <button
            type="button"
            aria-label={t('points.activity.prev')}
            onClick={() => go(index - 1)}
            style={arrowStyle}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--orange)'; e.currentTarget.style.color = 'var(--orange)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            ←
          </button>
          <button
            type="button"
            aria-label={t('points.activity.next')}
            onClick={() => go(index + 1)}
            style={arrowStyle}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--orange)'; e.currentTarget.style.color = 'var(--orange)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            →
          </button>
        </div>
      </div>

      {/* Viewport. Slides live in a translated flex track so the browser
          animates one transform instead of six repaints. */}
      <div
        style={{ overflow: 'hidden', borderRadius: 16 }}
        onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; setPaused(true); }}
        onTouchEnd={(e) => {
          const start = touchStartX.current;
          touchStartX.current = null;
          setPaused(false);
          if (start === null) return;
          const dx = e.changedTouches[0].clientX - start;
          if (Math.abs(dx) > 45) go(index + (dx < 0 ? 1 : -1));
        }}
      >
        <div style={{
          display: 'flex',
          transform: `translateX(-${index * 100}%)`,
          transition: prefersReducedMotion() ? 'none' : 'transform 0.5s cubic-bezier(0.22,0.8,0.3,1)',
        }}>
          {slides.map((m, i) => {
            const isActive = i === index;
            const mOutcomes = Array.isArray(m.outcomes) ? m.outcomes : ['Sí', 'No'];
            const mPrices = Array.isArray(m.prices) ? m.prices : [];
            const isParallel = m.ammMode === 'parallel';
            const isMultiChart = isParallel || mOutcomes.length > 2;
            const mOutcomeSeries = seriesForSlide(m, history);
            const mSeries = Array.isArray(mOutcomeSeries?.[0]) ? mOutcomeSeries[0] : [];
            const mLeader = isMultiChart ? leadingOutcomeForMarket(m, t('points.activity.tied')) : null;
            const mLeadPct = isMultiChart ? mLeader.pct : Math.round((mPrices[0] ?? 0.5) * 100);
            const mDelta = mSeries.length >= 2 ? mSeries[mSeries.length - 1].p - mSeries[0].p : 0;
            const mDeltaColor = mDelta > 0.05 ? BUY_COLOR : mDelta < -0.05 ? SELL_COLOR : 'var(--text-muted)';
            const mOutcomeEntries = outcomeEntriesForMarket(m);
            const mChartEntries = chartEntriesForMarket(m);
            return (
              <div
                key={m.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} / ${slides.length}`}
                aria-hidden={!isActive}
                style={{
                  flex: '0 0 100%',
                  minWidth: 0,
                  padding: 1,
                  opacity: isActive ? 1 : 0.35,
                  transition: 'opacity 0.4s',
                  // Off-screen slides are aria-hidden, so their controls
                  // must leave the tab order too — a focusable node inside
                  // aria-hidden is a screen-reader trap.
                  pointerEvents: isActive ? 'auto' : 'none',
                }}
              >
                <article style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1.45fr) minmax(260px,1fr)',
                  background: 'var(--surface1)',
                  border: '1px solid var(--border)',
                  borderRadius: 16,
                  overflow: 'hidden',
                }}>

                  {/* ── Left: identity + chart ─────────────────── */}
                  <div style={{ padding: isMobile ? 18 : 24, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                      {/* The pinned market didn't earn a rank — it's here
                          for price movement — so it must not wear a
                          "#N más activo" badge it didn't win. */}
                      <span style={{
                        ...chipStyle,
                        color: 'var(--orange)',
                        borderColor: 'var(--border-active)',
                        background: 'var(--orange-dim)',
                      }}>
                        {m._pinned
                          ? t('points.activity.slotBtc')
                          : `#${i + 1} ${t('points.activity.rank')}`}
                      </span>
                      <span style={chipStyle}>{displayCategory(m.category)}</span>
                      {m.live && (
                        <span style={{
                          ...chipStyle,
                          color: 'var(--danger)',
                          background: 'var(--danger-dim)',
                          borderColor: 'rgba(212,32,32,0.3)',
                          animation: 'pronos-live-pulse 1.4s ease-in-out infinite',
                        }}>
                          {t('points.card.live')}
                        </span>
                      )}
                    </div>

                    <h3
                      role="link"
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => navigate(`/market?id=${encodeURIComponent(m.id)}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/market?id=${encodeURIComponent(m.id)}`);
                        }
                      }}
                      style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: isMobile ? 'var(--fs-lg)' : 'var(--fs-xl)',
                        fontWeight: 700,
                        lineHeight: 1.3,
                        color: 'var(--text-primary)',
                        margin: '0 0 16px',
                        cursor: 'pointer',
                      }}
                    >
                      {m.question}
                    </h3>

                    {/* Chart. Binary markets show outcome 0 price history.
                        Multi and parallel parents draw the leading outcome
                        lines on one shared axis; the right panel keeps the
                        parent-level money flow. */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                      <span style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 34,
                        lineHeight: 1,
                        color: 'var(--text-primary)',
                      }}>
                        {mLeadPct}%
                      </span>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-xs)',
                        color: 'var(--text-secondary)',
                        letterSpacing: '0.06em',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {isMultiChart ? mLeader.label : mOutcomes[0]}
                      </span>
                      {isActive && !isMultiChart && mSeries.length >= 2 && (
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--fs-xs)',
                          color: mDeltaColor,
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {mDelta >= 0 ? '▲' : '▼'} {Math.abs(mDelta).toFixed(1)} pp · 30d
                        </span>
                      )}
                    </div>

                    {isMultiChart ? (
                      <MultiSparkline
                        height={isMobile ? 138 : 164}
                        strokeWidth={2}
                        showActivity={false}
                        domainMin={0}
                        domainMax={100}
                        series={mChartEntries.map(entry => ({
                          key: `opt-${entry.index}`,
                          label: entry.label,
                          color: OUTCOME_COLORS[entry.index % OUTCOME_COLORS.length],
                          data: Array.isArray(mOutcomeSeries?.[entry.index])
                            ? mOutcomeSeries[entry.index]
                            : [],
                          targetPct: Math.round((entry.price || 0) * 100),
                        }))}
                        activity={[m._buckets || []]}
                        emptyLabel={t('points.activity.noHistory')}
                        emptySubLabel={t('points.activity.noHistorySub')}
                        legendNote={mOutcomes.length > mChartEntries.length ? (
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            color: 'var(--text-muted)',
                            letterSpacing: '0.04em',
                            alignSelf: 'center',
                          }}>
                            +{mOutcomes.length - mChartEntries.length}
                          </span>
                        ) : null}
                      />
                    ) : (
                      <Sparkline
                        height={isMobile ? 110 : 148}
                        color={BUY_COLOR}
                        strokeWidth={2.2}
                        fill
                        // The big % above the chart already states the
                        // level; Sparkline's auto y-axis (on at h>=100)
                        // would only collide with the end dot here.
                        showYAxis={false}
                        data={mSeries}
                        targetPct={mLeadPct}
                        emptyLabel={t('points.activity.noHistory')}
                        emptySubLabel={t('points.activity.noHistorySub')}
                      />
                    )}

                    {/* Outcome legend — leaders first on parallel markets. */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                      {mOutcomeEntries.map(({ label, index: oi, price }) => (
                        <span key={oi} style={{
                          ...chipStyle,
                          textTransform: 'none',
                          letterSpacing: '0.03em',
                          fontSize: 'var(--fs-xs)',
                          maxWidth: 190,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {label} <strong style={{ color: 'var(--text-primary)' }}>
                            {Math.round(price * 100)}%
                          </strong>
                        </span>
                      ))}
                      {mOutcomes.length > mOutcomeEntries.length && (
                        <span style={chipStyle}>+{mOutcomes.length - mOutcomeEntries.length}</span>
                      )}
                    </div>
                  </div>

                  {/* ── Right: live trade tape ─────────────────── */}
                  <div style={{
                    background: 'var(--surface2)',
                    borderLeft: isMobile ? 'none' : '1px solid var(--border)',
                    borderTop: isMobile ? '1px solid var(--border)' : 'none',
                    padding: isMobile ? 18 : 20,
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 12,
                    }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-2xs)',
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                      }}>
                        <span style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: BUY_COLOR,
                          animation: 'pronos-live-pulse 1.4s ease-in-out infinite',
                        }} />
                        {t('points.activity.flow')}
                      </span>
                      {/* Real traded volume for the signal that selected
                          the slide. We keep the actual signal hidden and
                          only show a compact volume cue. */}
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-2xs)',
                        color: 'var(--text-muted)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {`${t('points.activity.volumeShort')} · ${formatCompact(m._displayVolume)} MXNP`}
                      </span>
                    </div>

                    {/* Buy/sell pressure across the loaded fills. */}
                    {isActive && pressureTotal > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--fs-2xs)',
                          fontVariantNumeric: 'tabular-nums',
                          marginBottom: 5,
                        }}>
                          <span style={{ color: BUY_COLOR }}>
                            {t('points.activity.buys')} {formatCompact(buyPressure)}
                          </span>
                          <span style={{ color: SELL_COLOR }}>
                            {formatCompact(sellPressure)} {t('points.activity.sells')}
                          </span>
                        </div>
                        <div style={{
                          height: 4,
                          borderRadius: 999,
                          background: SELL_COLOR,
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            width: `${buyPct}%`,
                            height: '100%',
                            background: BUY_COLOR,
                            transition: 'width 0.5s ease',
                          }} />
                        </div>
                      </div>
                    )}

                    {/* The tape. One row per hour that actually traded,
                        newest first. The feed is anonymous by design, so a
                        row is aggregate flow — not a named user's fill. */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                      {(m._buckets || []).slice(0, TAPE_ROWS).map((b, ti) => {
                        const buy = Number(b.buyVolume || 0);
                        const sell = Number(b.sellVolume || 0);
                        // Which side dominated this hour decides the row's
                        // tint; both numbers are still printed.
                        const buyLed = buy >= sell;
                        return (
                          <div
                            key={`${tapeEpoch}-${b.t}`}
                            className="points-tape-row"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '6px 8px',
                              borderRadius: 7,
                              background: buyLed ? 'var(--yes-dim)' : 'var(--danger-dim)',
                              animationDelay: `${ti * 70}ms`,
                            }}
                          >
                            <span style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--fs-2xs)',
                              fontWeight: 700,
                              color: buyLed ? BUY_COLOR : SELL_COLOR,
                              letterSpacing: '0.06em',
                              flexShrink: 0,
                            }}>
                              {buyLed ? '\u25b2' : '\u25bc'}
                            </span>
                            <span style={{
                              flex: 1,
                              minWidth: 0,
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--fs-2xs)',
                              color: 'var(--text-secondary)',
                              fontVariantNumeric: 'tabular-nums',
                              whiteSpace: 'nowrap',
                            }}>
                              {formatHour(b.t)}
                            </span>
                            <span style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--fs-2xs)',
                              color: 'var(--text-muted)',
                              fontVariantNumeric: 'tabular-nums',
                              flexShrink: 0,
                            }}>
                              {b.count}×
                            </span>
                            {buy > 0 && (
                              <span style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: 'var(--fs-md)',
                                color: BUY_COLOR,
                                fontVariantNumeric: 'tabular-nums',
                                letterSpacing: '0.02em',
                                flexShrink: 0,
                                textAlign: 'right',
                              }}>
                                +{formatCompact(buy)}
                              </span>
                            )}
                            {sell > 0 && (
                              <span style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: 'var(--fs-md)',
                                color: SELL_COLOR,
                                fontVariantNumeric: 'tabular-nums',
                                letterSpacing: '0.02em',
                                flexShrink: 0,
                                textAlign: 'right',
                              }}>
                                -{formatCompact(sell)}
                              </span>
                            )}
                          </div>
                        );
                      })}

                      {/* Only the pinned market can land here: it's in the
                          carousel for price movement, not for fills. Say
                          exactly that instead of leaving a blank panel
                          that implies activity nobody produced. */}
                      {(m._buckets || []).length === 0 && (
                        <div style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          textAlign: 'center',
                          padding: '18px 6px',
                        }}>
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--fs-xs)',
                            color: 'var(--text-secondary)',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                          }}>
                            {m._pinned ? t('points.activity.noBuys') : t('points.activity.noRecent')}
                          </span>
                          <span style={{
                            fontFamily: 'var(--font-body)',
                            fontSize: 'var(--fs-sm)',
                            color: 'var(--text-muted)',
                          }}>
                            {m._pinned ? t('points.activity.noBuysSub') : t('points.activity.noRecentSub')}
                          </span>
                        </div>
                      )}
                    </div>

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      marginTop: 14,
                      paddingTop: 12,
                      borderTop: '1px solid var(--border)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--fs-2xs)',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                    }}>
                      <span>
                        VOL <strong style={{ color: 'var(--text-primary)' }}>
                          {formatCompact(m._displayVolume)}
                        </strong> MXNP
                      </span>
                      <button
                        type="button"
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => navigate(`/market?id=${encodeURIComponent(m.id)}`)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--fs-2xs)',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--orange)',
                        }}
                      >
                        {t('points.activity.open')} →
                      </button>
                    </div>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 14 }}>
        {slides.map((m, i) => (
          <button
            key={m.id}
            type="button"
            aria-label={`${t('points.activity.goTo')} ${i + 1}`}
            aria-current={i === index}
            onClick={() => go(i)}
            style={{
              width: i === index ? 22 : 8,
              height: 8,
              padding: 0,
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              background: i === index ? 'var(--orange)' : 'var(--border)',
              transition: 'width 0.25s, background 0.25s',
            }}
          />
        ))}
      </div>
    </section>
  );
}
