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
import LivePriceChart from './LivePriceChart.jsx';
import PointsBuyModal from './PointsBuyModal.jsx';

function fmt(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Shared style for the Prev/Next sibling-navigation buttons. Borderless,
// monospace, low contrast so they don't compete with the SUBE/BAJA CTAs.
const navBtnStyle = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: 10,
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  transition: 'border-color 0.15s, color 0.15s',
};

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

export default function Crypto5MinDetail({ market, userPositions = [] }) {
  const navigate = useNavigate();
  const meta = market?.cryptoMeta || {};
  const productId = meta.coinbaseProductId || (meta.asset === 'eth' ? 'ETH-USD' : 'BTC-USD');
  const { currentPrice, history, status: wsStatus } = useCryptoTicker(productId);

  // Re-render once per second so the countdown ticks. Cheap.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Buy modal state — same shape as other binary markets so PointsBuyModal
  // works without modification.
  const [buyState, setBuyState] = useState(null);

  const status = market.status;
  const closesAt = useMemo(() => meta.closesAt ? new Date(meta.closesAt) : (market.endTime ? new Date(market.endTime) : null), [meta.closesAt, market.endTime]);
  const opensAt = useMemo(() => market.startTime ? new Date(market.startTime) : null, [market.startTime]);

  const canTrade = status === 'active' && closesAt && closesAt.getTime() > Date.now();
  const isPending = status === 'pending' || (status === 'active' && opensAt && opensAt.getTime() > Date.now());
  const isResolved = status === 'resolved';

  // Backfill price history. Server-recorded ticks are the source of
  // truth — /api/cron/crypto-ticker snapshots Coinbase's ticker every
  // ~5s for BTC/ETH, so /api/points/crypto-history returns the same
  // dense curve regardless of who's viewing and when. We use the
  // server endpoint first; for brand-new markets that haven't
  // accumulated ticks yet (cron hasn't run since open, or the very
  // first window after deploy) we fall back to Coinbase's public
  // per-trade endpoint so the chart isn't blank.
  //
  // Anchor with openPrice@openedAt so the line starts exactly at the
  // threshold-stamping moment even if the first recorded tick landed
  // a few seconds later.
  const [backfill, setBackfill] = useState([]);
  const openedAtMs = meta.openedAt ? new Date(meta.openedAt).getTime() : null;
  const chartWindowStart = openedAtMs ?? (opensAt ? opensAt.getTime() : null);
  const chartWindowEnd = closesAt ? closesAt.getTime() : null;
  useEffect(() => {
    if (!openedAtMs || !Number.isFinite(meta.openPrice)) { setBackfill([]); return; }
    let cancelled = false;
    const endMs = (status === 'resolved' && closesAt)
      ? closesAt.getTime()
      : Date.now();

    function decimate(points) {
      // Keep one point per 200ms — anything denser is wasted at ~800px
      // chart width and hurts framerate when the WS layers ticks on
      // top. Within a bucket, prefer the latest tick so the chart
      // hugs the freshest price.
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

    function anchor(points) {
      const sorted = [...points].sort((a, b) => a.t - b.t);
      const head = { t: openedAtMs, price: Number(meta.openPrice) };
      if (sorted.length === 0 || sorted[0].t > openedAtMs) {
        return [head, ...sorted];
      }
      return sorted;
    }

    async function loadFromServer() {
      const res = await fetch(
        `/api/points/crypto-history?marketId=${encodeURIComponent(market.id)}`,
        { credentials: 'omit' },
      );
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      const points = Array.isArray(json?.points) ? json.points : null;
      if (!points || points.length === 0) return null;
      return points;
    }

    async function loadFromCoinbase() {
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

    async function run() {
      let points = await loadFromServer().catch(() => null);
      if (!points || points.length < 5) {
        // Server has nothing useful yet — fill the gap from Coinbase
        // so the first user on a brand-new market doesn't see a blank
        // chart. Merge with whatever the server did return.
        const fallback = await loadFromCoinbase();
        points = [...(points || []), ...fallback];
      }
      if (cancelled) return;
      setBackfill(anchor(decimate(points)));
    }

    run();
    return () => { cancelled = true; };
  }, [market.id, productId, openedAtMs, meta.openPrice, status, closesAt]);

  const snapshotWindow = useMemo(() => ({
    minT: chartWindowStart,
    maxT: chartWindowEnd,
  }), [chartWindowStart, chartWindowEnd]);
  const [storedSnapshot, setStoredSnapshot] = useState(() => loadStoredSnapshot(market.id, snapshotWindow));
  const snapshotRef = useRef(storedSnapshot);
  const lastSnapshotPersistRef = useRef(0);

  useEffect(() => {
    const stored = loadStoredSnapshot(market.id, snapshotWindow);
    snapshotRef.current = stored;
    setStoredSnapshot(stored);
    lastSnapshotPersistRef.current = 0;
  }, [market.id, snapshotWindow]);

  // Active/pending curve = union of every source we have:
  //   - live WS ticker accumulated in-tab
  //   - server backfill (global truth, but can be sparse early on)
  //   - stored per-market snapshot from this browser
  //   - explicit open anchor
  //
  // This avoids the old failure mode where a thin backfill response
  // arrived after mount and replaced a richer live curve with a nearly
  // straight line. Unioning the sources preserves the densest history
  // we have at any moment instead of choosing one winner.
  const liveChartHistory = useMemo(() => normalizeChartPoints(
    [
      ...storedSnapshot,
      ...backfill,
      ...history,
      ...(Number.isFinite(openedAtMs) && meta.openPrice != null
        ? [{ t: openedAtMs, price: Number(meta.openPrice) }]
        : []),
    ],
    snapshotWindow,
  ), [storedSnapshot, backfill, history, openedAtMs, meta.openPrice, snapshotWindow]);

  useEffect(() => {
    if (status === 'resolved' || liveChartHistory.length < 2) return;
    snapshotRef.current = liveChartHistory;
    const now = Date.now();
    if (now - lastSnapshotPersistRef.current < SNAPSHOT_PERSIST_MS) return;
    lastSnapshotPersistRef.current = now;
    persistSnapshot(market.id, liveChartHistory);
  }, [status, liveChartHistory, market.id]);

  const chartHistory = useMemo(() => {
    if (status === 'resolved') {
      const base = normalizeChartPoints(
        [
          ...liveChartHistory,
          ...(snapshotRef.current || []),
        ],
        snapshotWindow,
      );
      if (closesAt && meta.closePrice != null) {
        const closeT = closesAt.getTime();
        const closePrice = Number(meta.closePrice);
        const lastT = base.length ? base[base.length - 1].t : 0;
        // Don't double-stamp if the last curve point already sits at
        // closesAt — just overwrite its price to match the settlement
        // value (which can drift by a few cents from the closing candle).
        if (lastT >= closeT - 30_000) {
          base[base.length - 1] = { t: closeT, price: closePrice };
        } else {
          base.push({ t: closeT, price: closePrice });
        }
      }
      return base;
    }
    return liveChartHistory;
  }, [status, liveChartHistory, storedSnapshot, backfill, openedAtMs, meta.openPrice, meta.closePrice, closesAt, snapshotWindow]);

  useEffect(() => {
    if (status !== 'resolved' || chartHistory.length < 2) return;
    snapshotRef.current = chartHistory;
    persistSnapshot(market.id, chartHistory);
  }, [status, chartHistory, market.id]);

  // Buy handler — opens the existing PointsBuyModal pre-targeted on the
  // chosen outcome. We pass the same shape it expects from non-crypto
  // markets so its internals stay unchanged.
  function openBuy(outcomeIndex) {
    if (!canTrade) return;
    setBuyState({
      market,
      outcomeIndex,
      outcomeLabel: market.outcomes?.[outcomeIndex] || (outcomeIndex === 0 ? 'SUBE' : 'BAJA'),
    });
  }

  const subePrice = market.prices?.[0] ?? 0.5;
  const bajaPrice = market.prices?.[1] ?? 0.5;
  const direction = currentPrice != null && meta.threshold != null
    ? (currentPrice > meta.threshold ? 'sube' : currentPrice < meta.threshold ? 'baja' : 'flat')
    : null;

  return (
    <div style={{
      maxWidth: 980, margin: '0 auto',
      padding: 'clamp(16px, 4vw, 32px)',
    }}>
      {/* Header — back button is provided by the page-level nav above. */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--text-muted)', letterSpacing: '0.12em',
          textTransform: 'uppercase', marginBottom: 6,
        }}>
          {meta.symbol || '—'} · 5 min · Chainlink
        </div>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 4vw, 32px)',
          color: 'var(--text-primary)', margin: 0, letterSpacing: '0.02em',
        }}>
          {market.question}
        </h1>
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
          // Anchor the X axis to the market's actual window so the
          // chart shows open-on-left, close-on-right regardless of
          // when the user opens the page. Falls back to LivePriceChart's
          // sliding 5-min window when these are absent (e.g. pending
          // pre-open state).
          xStart={chartWindowStart ?? undefined}
          xEnd={closesAt ? closesAt.getTime() : undefined}
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
              color: market.outcome === 0 ? 'var(--yes, #00C96B)' : 'var(--red, #FF4545)',
            }}>
              {market.outcomes?.[market.outcome] || (market.outcome === 0 ? 'SUBE' : 'BAJA')}
            </strong>
            {' · '}
            <span style={{ color: 'var(--text-secondary)' }}>
              {market.finalScore || (meta.openPrice != null && meta.closePrice != null
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
          El mercado abre cuando cierre el actual. El umbral se fija con el precio de Chainlink en ese momento.
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

      {/* Prev / next navigation row — lets users hop between consecutive
          5-min windows without bouncing out to the grid. Keep it visible
          after resolution too so the user can inspect the settled result
          and still move through the sequence without losing context. */}
      {(meta.prevMarketId || meta.nextMarketId) && (
        <div style={{
          marginBottom: 16,
          display: 'grid',
          gridTemplateColumns: meta.prevMarketId && meta.nextMarketId
            ? '1fr 1fr'
            : '1fr',
          gap: 10,
        }}>
          {meta.prevMarketId && (
            <button
              onClick={() => navigate(`/market?id=${encodeURIComponent(meta.prevMarketId)}`)}
              style={navBtnStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--text-muted)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <span aria-hidden="true">←</span>
              <span>Anterior ({meta.symbol || ''} · 5 min)</span>
            </button>
          )}
          {meta.nextMarketId && (
            <button
              onClick={() => navigate(`/market?id=${encodeURIComponent(meta.nextMarketId)}`)}
              style={navBtnStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--green)';
                e.currentTarget.style.color = 'var(--green)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <span>Próximo ({meta.symbol || ''} · 5 min)</span>
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}

      {/* User position panel — minimal display matching the rest of detail */}
      {userPositions.length > 0 && (
        <div style={{
          padding: 12, borderRadius: 8,
          background: 'var(--surface2)', border: '1px solid var(--border)',
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--text-secondary)',
          marginBottom: 12,
        }}>
          Tu posición:
          {userPositions.map((p, i) => (
            <span key={i} style={{ marginLeft: 10 }}>
              {market.outcomes?.[p.outcomeIndex] ?? `Outcome ${p.outcomeIndex}`} · {fmt(p.shares, 2)} acciones
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
