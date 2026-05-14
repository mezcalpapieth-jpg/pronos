/**
 * Crypto5MinDetail — specialized detail-page layout for the 5-min
 * BTC/ETH direction markets.
 *
 * Replaces the standard PointsMarketDetail body for any market whose
 * cryptoMeta is non-null (i.e. resolver_config.shape === 'binary-direction').
 * The standard detail layout doesn't fit this product — these markets are
 * 5 min long, settle on a price comparison, and need a live chart with
 * threshold rule + countdown more than the usual question + outcome list.
 *
 * Renders three states:
 *   - status='pending'   "Próximo mercado" — chart of recent prices, no
 *                        threshold yet, countdown to open, no buy buttons.
 *   - status='active'    Live ticker + threshold line, SUBE/BAJA buttons,
 *                        countdown to close.
 *   - status='resolved'  Historical chart with threshold line, locked
 *                        outcome label, no buy buttons.
 *
 * The buy buttons reuse the existing PointsBuyModal for consistency with
 * every other binary market on the platform — same balance check, same
 * confirmation, same error handling.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCryptoTicker } from '../lib/useCryptoTicker.js';
import {
  buildCryptoMarketSequence,
  computeCryptoGraphFrame,
  cryptoMarketSequenceSignature,
  getSelectedCryptoMarket,
} from '../lib/cryptoMarketHub.js';
import LivePriceChart from '@app/components/LivePriceChart.jsx';
import PointsBuyModal from './PointsBuyModal.jsx';

function fmt(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const SNAPSHOT_STORAGE_PREFIX = 'pronos-crypto-chart:';
const SNAPSHOT_PERSIST_MS = 5_000;

// Compute MM:SS until a target Date. Returns '0:00' if past.
function formatCountdown(target) {
  if (!target) return '—';
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function normalizeChartPoints(points, { minT, maxT } = {}) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const out = [];
  for (const p of points) {
    const t = Number(p?.t);
    const price = Number(p?.price);
    if (!Number.isFinite(t) || !Number.isFinite(price)) continue;
    if (Number.isFinite(minT) && t < minT) continue;
    if (Number.isFinite(maxT) && t > maxT) continue;
    out.push({ t, price });
  }
  out.sort((a, b) => a.t - b.t);
  const deduped = [];
  for (const p of out) {
    if (deduped.length > 0 && deduped[deduped.length - 1].t === p.t) {
      deduped[deduped.length - 1] = p;
    } else {
      deduped.push(p);
    }
  }
  return deduped;
}

function snapshotStorageKey(marketId) {
  return marketId ? `${SNAPSHOT_STORAGE_PREFIX}${marketId}` : null;
}

function loadStoredSnapshot(marketId, windowBounds) {
  if (typeof window === 'undefined') return [];
  const key = snapshotStorageKey(marketId);
  if (!key) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const points = Array.isArray(parsed?.points) ? parsed.points : [];
    return normalizeChartPoints(points, windowBounds);
  } catch {
    return [];
  }
}

function persistSnapshot(marketId, points) {
  if (typeof window === 'undefined') return;
  const key = snapshotStorageKey(marketId);
  if (!key) return;
  const normalized = normalizeChartPoints(points);
  if (normalized.length < 2) return;
  try {
    window.localStorage.setItem(key, JSON.stringify({
      savedAt: Date.now(),
      points: normalized,
    }));
  } catch { /* best-effort */ }
}

function dateMs(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function marketWindowBounds(market) {
  const meta = market?.cryptoMeta || {};
  const start = dateMs(meta.openedAt || market?.startTime);
  const end = dateMs(meta.closesAt || market?.endTime);
  return { start, end };
}

function formatMarketChipTime(market) {
  const { end } = marketWindowBounds(market);
  if (!end) return '—';
  return new Date(end).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function marketChipKicker(market, nowMs) {
  if (market?.status === 'resolved') return 'Past';
  const meta = market?.cryptoMeta || {};
  const start = dateMs(market?.startTime);
  if (market?.status === 'pending' || meta.threshold == null || (start && start > nowMs)) {
    return 'Awaiting';
  }
  return 'Live';
}

function decimate(points) {
  const out = [];
  let lastT = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.price)) continue;
    if (p.t - lastT >= 200) {
      out.push(p);
      lastT = p.t;
    } else if (out.length > 0) {
      out[out.length - 1] = p;
    }
  }
  return out;
}

function anchorMarketPoints(market, points) {
  const meta = market?.cryptoMeta || {};
  const openedAtMs = dateMs(meta.openedAt);
  if (!openedAtMs || !Number.isFinite(Number(meta.openPrice))) {
    return normalizeChartPoints(points);
  }
  const sorted = normalizeChartPoints(points);
  const head = { t: openedAtMs, price: Number(meta.openPrice) };
  if (sorted.length === 0 || sorted[0].t > openedAtMs) {
    return [head, ...sorted];
  }
  return sorted;
}

function pointsForMarketWindow(points, market) {
  const { start, end } = marketWindowBounds(market);
  return normalizeChartPoints(points, {
    minT: start ?? undefined,
    maxT: end ?? undefined,
  });
}

export default function Crypto5MinDetail({ market, userPositions = [] }) {
  const navigate = useNavigate();
  const baseMeta = market?.cryptoMeta || {};
  const productId = baseMeta.coinbaseProductId || (baseMeta.asset === 'eth' ? 'ETH-USD' : 'BTC-USD');
  const { currentPrice, history, status: wsStatus } = useCryptoTicker(productId);
  const sequence = useMemo(() => buildCryptoMarketSequence(market), [market]);
  const sequenceSig = useMemo(() => cryptoMarketSequenceSignature(sequence), [sequence]);
  const [selectedMarketId, setSelectedMarketId] = useState(market.id);
  const selectedMarket = useMemo(
    () => getSelectedCryptoMarket(market, selectedMarketId),
    [market, selectedMarketId],
  );
  const meta = selectedMarket?.cryptoMeta || {};

  // Re-render once per second so the countdown ticks. Cheap.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Buy modal state — same shape as other binary markets so PointsBuyModal
  // works without modification.
  const [buyState, setBuyState] = useState(null);

  useEffect(() => {
    if (sequence.length === 0) return;
    const stillPresent = sequence.some((item) => String(item.id) === String(selectedMarketId));
    if (!stillPresent) setSelectedMarketId(market.id);
  }, [market.id, selectedMarketId, sequenceSig, sequence]);

  const nowMs = Date.now();
  const status = selectedMarket.status;
  const closesAt = useMemo(() => meta.closesAt ? new Date(meta.closesAt) : (selectedMarket.endTime ? new Date(selectedMarket.endTime) : null), [meta.closesAt, selectedMarket.endTime]);
  const opensAt = useMemo(() => selectedMarket.startTime ? new Date(selectedMarket.startTime) : null, [selectedMarket.startTime]);

  const canTrade = status === 'active' && closesAt && closesAt.getTime() > Date.now();
  const isPending = status === 'pending' || (status === 'active' && opensAt && opensAt.getTime() > Date.now());
  const isResolved = status === 'resolved';

  const graphFrame = useMemo(
    () => computeCryptoGraphFrame(sequence, { nowMs, history }),
    [sequenceSig, history, nowMs],
  );
  const selectedWindow = useMemo(() => marketWindowBounds(selectedMarket), [selectedMarket]);

  // Backfill price history for the nearby BTC/ETH windows, but cache it
  // by market id. Selecting another chip changes the threshold/controls;
  // it does not blank the asset graph or force a new chart source.
  const [backfillByMarketId, setBackfillByMarketId] = useState({});
  const loadingBackfillRef = useRef(new Set());
  const loadedBackfillRef = useRef(new Set());
  useEffect(() => {
    let cancelled = false;
    async function loadFromServer(target) {
      const res = await fetch(
        `/api/points/crypto-history?marketId=${encodeURIComponent(target.id)}`,
        { credentials: 'omit' },
      );
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      const points = Array.isArray(json?.points) ? json.points : null;
      if (!points || points.length === 0) return null;
      return points;
    }

    async function loadFromCoinbase(target, openedAtMs, endMs) {
      // Fallback path — only used when the server hasn't accumulated
      // any ticks for this window yet. Paginates the public trades
      // endpoint until the window is covered or the page cap fires.
      const collected = [];
      let cursor = null;
      const MAX_PAGES = 8; // softer cap than before — server is primary now
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          if (cancelled) return collected;
          let url = `https://api.exchange.coinbase.com/products/${productId}/trades?limit=1000`;
          if (cursor != null) url += `&after=${cursor}`;
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) break;
          const batch = await res.json();
          if (!Array.isArray(batch) || batch.length === 0) break;
          let oldestTs = Number.POSITIVE_INFINITY;
          let oldestTradeId = null;
          for (const tr of batch) {
            const ts = new Date(tr.time).getTime();
            const price = Number(tr.price);
            if (!Number.isFinite(price) || !Number.isFinite(ts)) continue;
            if (ts < oldestTs) {
              oldestTs = ts;
              oldestTradeId = tr.trade_id ?? tr.tradeId ?? null;
            }
            if (ts >= openedAtMs && ts <= endMs) {
              collected.push({ t: ts, price });
            }
          }
          if (oldestTs <= openedAtMs) break;
          if (oldestTradeId == null) break;
          cursor = oldestTradeId;
        }
      } catch { /* network blip — surface what we got */ }
      return collected;
    }

    async function loadTarget(target) {
      const key = String(target.id);
      if (loadedBackfillRef.current.has(key) || loadingBackfillRef.current.has(key)) return;
      const targetMeta = target.cryptoMeta || {};
      const openedAtMs = dateMs(targetMeta.openedAt);
      if (!openedAtMs || !Number.isFinite(Number(targetMeta.openPrice))) return;
      const closesAtMs = dateMs(targetMeta.closesAt || target.endTime);
      const endMs = target.status === 'resolved' && closesAtMs
        ? closesAtMs
        : Math.min(Date.now(), closesAtMs || Date.now());
      loadingBackfillRef.current.add(key);

      let points = await loadFromServer(target).catch(() => null);
      if (!points || points.length < 5) {
        const allowCoinbaseFallback = key === String(selectedMarket.id) || target.status === 'active';
        if (allowCoinbaseFallback) {
          // Server has nothing useful yet — fill the active/selected
          // gap from Coinbase so the first user on a brand-new market
          // doesn't see a blank chart. Avoid doing this for every
          // historical chip in the sequence.
          const fallback = await loadFromCoinbase(target, openedAtMs, endMs);
          points = [...(points || []), ...fallback];
        }
      }
      loadingBackfillRef.current.delete(key);
      loadedBackfillRef.current.add(key);
      if (cancelled) return;
      setBackfillByMarketId((prev) => ({
        ...prev,
        [key]: anchorMarketPoints(target, decimate(points || [])),
      }));
    }

    for (const target of sequence) {
      loadTarget(target);
    }
    return () => { cancelled = true; };
  }, [sequence, sequenceSig, selectedMarket.id, productId]);

  const snapshotWindow = useMemo(() => ({
    minT: graphFrame.xStart,
    maxT: graphFrame.xEnd,
  }), [graphFrame.xStart, graphFrame.xEnd]);
  const [storedSnapshotsByMarketId, setStoredSnapshotsByMarketId] = useState({});
  const lastSnapshotPersistRef = useRef(0);

  useEffect(() => {
    const next = {};
    for (const item of sequence) {
      next[String(item.id)] = loadStoredSnapshot(item.id, snapshotWindow);
    }
    setStoredSnapshotsByMarketId(next);
    lastSnapshotPersistRef.current = 0;
  }, [sequenceSig, snapshotWindow]);

  // Active/pending curve = union of every source we have:
  //   - live WS ticker accumulated in-tab
  //   - cached server backfills for nearby 5-min windows
  //   - stored per-market snapshots from this browser
  //   - explicit open/close anchors from market lifecycle metadata
  //
  // This avoids the old failure mode where a thin backfill response
  // arrived after mount and replaced a richer live curve with a nearly
  // straight line. The graph is now asset-level: switching chips changes
  // the selected threshold and controls, not the accumulated curve.
  const liveChartHistory = useMemo(() => normalizeChartPoints(
    [
      ...Object.values(storedSnapshotsByMarketId).flat(),
      ...Object.values(backfillByMarketId).flat(),
      ...history,
      ...sequence.flatMap((item) => {
        const itemMeta = item.cryptoMeta || {};
        const openedAtMs = dateMs(itemMeta.openedAt);
        if (!openedAtMs || itemMeta.openPrice == null) return [];
        return [{ t: openedAtMs, price: Number(itemMeta.openPrice) }];
      }),
    ],
    snapshotWindow,
  ), [storedSnapshotsByMarketId, backfillByMarketId, history, sequence, snapshotWindow]);

  useEffect(() => {
    if (status === 'resolved' || liveChartHistory.length < 2) return;
    const selectedPoints = pointsForMarketWindow(liveChartHistory, selectedMarket);
    if (selectedPoints.length < 2) return;
    const now = Date.now();
    if (now - lastSnapshotPersistRef.current < SNAPSHOT_PERSIST_MS) return;
    lastSnapshotPersistRef.current = now;
    persistSnapshot(selectedMarket.id, selectedPoints);
  }, [status, liveChartHistory, selectedMarket]);

  const chartHistory = useMemo(() => {
    const closeAnchors = sequence.flatMap((item) => {
      const itemMeta = item.cryptoMeta || {};
      const closeT = dateMs(itemMeta.closesAt || item.endTime);
      if (item.status !== 'resolved' || !closeT || itemMeta.closePrice == null) return [];
      return [{ t: closeT, price: Number(itemMeta.closePrice) }];
    });
    return normalizeChartPoints([...liveChartHistory, ...closeAnchors], snapshotWindow);
  }, [sequence, liveChartHistory, snapshotWindow]);

  useEffect(() => {
    if (status !== 'resolved' || chartHistory.length < 2) return;
    const selectedPoints = pointsForMarketWindow(chartHistory, selectedMarket);
    if (selectedPoints.length < 2) return;
    persistSnapshot(selectedMarket.id, selectedPoints);
  }, [status, chartHistory, selectedMarket]);

  // Buy handler — opens the existing PointsBuyModal pre-targeted on the
  // chosen outcome. We pass the same shape it expects from non-crypto
  // markets so its internals stay unchanged.
  function openBuy(outcomeIndex) {
    if (!canTrade) return;
    setBuyState({
      market: selectedMarket,
      outcomeIndex,
      outcomeLabel: selectedMarket.outcomes?.[outcomeIndex] || (outcomeIndex === 0 ? 'SUBE' : 'BAJA'),
    });
  }

  const subePrice = selectedMarket.prices?.[0] ?? 0.5;
  const bajaPrice = selectedMarket.prices?.[1] ?? 0.5;
  const direction = currentPrice != null && meta.threshold != null
    ? (currentPrice > meta.threshold ? 'sube' : currentPrice < meta.threshold ? 'baja' : 'flat')
    : null;
  const selectedPositions = userPositions.filter((p) => Number(p.marketId) === Number(selectedMarket.id));
  const selectedTimeLabel = formatMarketChipTime(selectedMarket);
  const alternateAssetMarket = baseMeta.alternateAssetMarket || null;

  return (
    <div style={{
      maxWidth: 980, margin: '0 auto',
      padding: 'clamp(16px, 4vw, 32px)',
    }}>
      {/* Header — back button is provided by the page-level nav above. */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 6,
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--text-muted)', letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}>
            {meta.symbol || '—'} · 5 min · Chainlink
          </div>
          {alternateAssetMarket && (
            <button
              onClick={() => navigate(`/market?id=${encodeURIComponent(alternateAssetMarket.id)}`)}
              style={{
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                borderRadius: 8,
                padding: '7px 10px',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {alternateAssetMarket.asset === 'eth' ? 'ETH' : 'BTC'}
            </button>
          )}
        </div>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 4vw, 32px)',
          color: 'var(--text-primary)', margin: 0, letterSpacing: '0.02em',
        }}>
          {meta.asset === 'eth' ? 'Ethereum: sube o baja en 5 minutos' : 'Bitcoin: sube o baja en 5 minutos'}
        </h1>
        <div style={{
          marginTop: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-secondary)',
          letterSpacing: '0.04em',
        }}>
          {selectedTimeLabel} · {selectedMarket.question}
        </div>
      </div>

      {/* Live price strip */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 24,
        alignItems: 'baseline',
        marginBottom: 16,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.12em', color: 'var(--text-muted)',
            textTransform: 'uppercase', marginBottom: 4,
          }}>
            Precio actual
          </div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px, 6vw, 44px)',
            color: direction === 'sube' ? 'var(--yes, #00C96B)'
                 : direction === 'baja' ? 'var(--red, #FF4545)'
                 : 'var(--text-primary)',
            letterSpacing: '0.02em',
            transition: 'color 0.4s',
          }}>
            ${fmt(currentPrice, 2)}
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--text-muted)', marginTop: 2,
          }}>
            {wsStatus === 'open' ? '● en vivo · Coinbase' : wsStatus === 'connecting' ? 'conectando…' : 'sin conexión'}
          </div>
        </div>

        <div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.12em', color: 'var(--text-muted)',
            textTransform: 'uppercase', marginBottom: 4,
          }}>
            Umbral
          </div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(20px, 4vw, 28px)',
            color: meta.threshold != null ? 'var(--text-primary)' : 'var(--text-muted)',
            letterSpacing: '0.02em',
          }}>
            {meta.threshold != null ? `$${fmt(meta.threshold, 0)}` : 'al abrir'}
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--text-muted)', marginTop: 2,
          }}>
            redondeado al $1 · sin empate
          </div>
        </div>

        <div style={{ marginLeft: 'auto' }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.12em', color: 'var(--text-muted)',
            textTransform: 'uppercase', marginBottom: 4,
            textAlign: 'right',
          }}>
            {isPending ? 'Abre en' : isResolved ? 'Cerró' : 'Cierra en'}
          </div>
          <div
            key={tick /* re-render each second */}
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(24px, 5vw, 36px)',
              color: 'var(--text-primary)',
              letterSpacing: '0.04em',
              textAlign: 'right',
            }}
          >
            {isResolved
              ? closesAt?.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
              : isPending
                ? formatCountdown(opensAt)
                : formatCountdown(closesAt)}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div style={{ marginBottom: 20 }}>
        <LivePriceChart
          history={chartHistory}
          threshold={meta.threshold ?? null}
          height={260}
          xStart={graphFrame.xStart ?? undefined}
          xEnd={graphFrame.xEnd ?? undefined}
          highlightStart={selectedWindow.start ?? undefined}
          highlightEnd={selectedWindow.end ?? undefined}
        />
      </div>

      {/* Resolved banner OR buy buttons OR pending message */}
      {isResolved && (
        <div style={{
          padding: '14px 18px',
          borderRadius: 10,
          background: 'var(--surface1)',
          border: '1px solid var(--border)',
          marginBottom: 18,
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.12em', color: 'var(--text-muted)',
            textTransform: 'uppercase', marginBottom: 4,
          }}>
            Resuelto
          </div>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 16,
            color: 'var(--text-primary)',
          }}>
            <strong style={{
              color: selectedMarket.outcome === 0 ? 'var(--yes, #00C96B)' : 'var(--red, #FF4545)',
            }}>
              {selectedMarket.outcomes?.[selectedMarket.outcome] || (selectedMarket.outcome === 0 ? 'SUBE' : 'BAJA')}
            </strong>
            {' · '}
            <span style={{ color: 'var(--text-secondary)' }}>
              {selectedMarket.finalScore || (meta.openPrice != null && meta.closePrice != null
                ? `$${fmt(meta.openPrice, 2)} → $${fmt(meta.closePrice, 2)}`
                : '')}
            </span>
          </div>
        </div>
      )}

      {isPending && !isResolved && (
        <div style={{
          padding: '14px 18px',
          borderRadius: 10,
          background: 'var(--surface1)',
          border: '1px solid var(--border)',
          marginBottom: 18,
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: 'var(--text-secondary)',
          letterSpacing: '0.04em',
          textAlign: 'center',
        }}>
          Awaiting previous market. El umbral se publica al abrir, justo cuando cierre la ventana anterior.
        </div>
      )}

      {canTrade && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 16,
        }}>
          <button
            onClick={() => openBuy(0)}
            style={{
              padding: '18px 16px',
              borderRadius: 12,
              background: 'var(--yes-dim, rgba(0,201,107,0.1))',
              border: '1px solid var(--yes, #00C96B)',
              color: 'var(--yes, #00C96B)',
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              letterSpacing: '0.04em',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              alignItems: 'flex-start',
            }}
          >
            <span style={{ fontSize: 22, fontWeight: 700 }}>↑ SUBE</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.85 }}>
              {(subePrice * 100).toFixed(0)}¢ por acción
            </span>
          </button>
          <button
            onClick={() => openBuy(1)}
            style={{
              padding: '18px 16px',
              borderRadius: 12,
              background: 'var(--red-dim, rgba(255,69,69,0.1))',
              border: '1px solid var(--red, #FF4545)',
              color: 'var(--red, #FF4545)',
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              letterSpacing: '0.04em',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              alignItems: 'flex-start',
            }}
          >
            <span style={{ fontSize: 22, fontWeight: 700 }}>↓ BAJA</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.85 }}>
              {(bajaPrice * 100).toFixed(0)}¢ por acción
            </span>
          </button>
        </div>
      )}

      {sequence.length > 1 && (
        <div style={{
          marginBottom: 16,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 2,
        }}>
          <div style={{
            display: 'flex',
            gap: 8,
            minWidth: 'max-content',
          }}>
            {sequence.map((item) => {
              const selected = String(item.id) === String(selectedMarket.id);
              const itemMeta = item.cryptoMeta || {};
              const kicker = marketChipKicker(item, nowMs);
              const itemAbove = currentPrice != null && itemMeta.threshold != null && currentPrice > itemMeta.threshold;
              const itemBelow = currentPrice != null && itemMeta.threshold != null && currentPrice < itemMeta.threshold;
              const accent = item.status === 'resolved'
                ? (item.outcome === 0 ? 'var(--yes, #00C96B)' : 'var(--red, #FF4545)')
                : itemAbove
                  ? 'var(--yes, #00C96B)'
                  : itemBelow
                    ? 'var(--red, #FF4545)'
                    : 'var(--text-secondary)';
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedMarketId(item.id)}
                  style={{
                    width: 112,
                    minHeight: 66,
                    borderRadius: 8,
                    border: selected ? `1px solid ${accent}` : '1px solid var(--border)',
                    background: selected ? 'var(--surface1)' : 'transparent',
                    color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '9px 10px',
                    textAlign: 'left',
                    fontFamily: 'var(--font-mono)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 6,
                  }}
                >
                  <span style={{
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: selected ? accent : 'var(--text-muted)',
                  }}>
                    {kicker}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 19,
                    lineHeight: 1,
                    color: selected ? accent : 'var(--text-primary)',
                  }}>
                    {formatMarketChipTime(item)}
                  </span>
                  <span style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {itemMeta.threshold != null ? `$${fmt(itemMeta.threshold, 0)}` : 'Awaiting'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* User position panel — minimal display matching the rest of detail */}
      {selectedPositions.length > 0 && (
        <div style={{
          padding: 12, borderRadius: 8,
          background: 'var(--surface2)', border: '1px solid var(--border)',
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--text-secondary)',
          marginBottom: 12,
        }}>
          Tu posición:
          {selectedPositions.map((p, i) => (
            <span key={i} style={{ marginLeft: 10 }}>
              {selectedMarket.outcomes?.[p.outcomeIndex] ?? `Outcome ${p.outcomeIndex}`} · {fmt(p.shares, 2)} acciones
            </span>
          ))}
        </div>
      )}

      {buyState && (
        <PointsBuyModal
          open
          market={buyState.market}
          outcomeIndex={buyState.outcomeIndex}
          outcomeLabel={buyState.outcomeLabel}
          onClose={() => setBuyState(null)}
          onSuccess={() => setBuyState(null)}
        />
      )}
    </div>
  );
}
