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

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCryptoTicker } from '../lib/useCryptoTicker.js';
import LivePriceChart from './LivePriceChart.jsx';
import PointsBuyModal from './PointsBuyModal.jsx';

function fmt(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

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

  // Backfill price history from Coinbase. The naive approach — 1-min
  // candles — only gives ~5 points per 5-min window, and the chart
  // ends up rendering as straight slopes between candle closes (Fran's
  // complaint: "it still only remembers the last minute, when you get
  // out and get back in you dont get the true graphs"). We paginate
  // the public trades feed instead, which has per-fill granularity
  // (often 1–5 trades/sec on BTC/ETH), so every fresh page open shows
  // the same dense curve the live WebSocket would build up if the user
  // had been on the page the whole window.
  //
  // For resolved markets the window is fixed [openedAt, closesAt]; for
  // active/pending we extend to NOW. Trades come back newest-first; we
  // walk backward via ?after=<oldest_trade_id> until either (a) the
  // batch goes older than openedAt or (b) the page cap kicks in. The
  // cap keeps a tab-thrash scenario from running 60+ requests in a
  // row on a network where the user's already shipped.
  const [backfill, setBackfill] = useState([]);
  const openedAtMs = meta.openedAt ? new Date(meta.openedAt).getTime() : null;
  useEffect(() => {
    if (!openedAtMs || !Number.isFinite(meta.openPrice)) { setBackfill([]); return; }
    let cancelled = false;
    const endMs = (status === 'resolved' && closesAt)
      ? closesAt.getTime()
      : Date.now();

    async function run() {
      const collected = [];
      let cursor = null;
      const MAX_PAGES = 12;        // 12 * 1000 = ~50 min worth of trades, hard cap.
      const PAGE_SIZE = 1000;
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          if (cancelled) return;
          let url = `https://api.exchange.coinbase.com/products/${productId}/trades?limit=${PAGE_SIZE}`;
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
          // Walked past the open of our window — no more pages needed.
          if (oldestTs <= openedAtMs) break;
          // No usable cursor to walk further — give up.
          if (oldestTradeId == null) break;
          cursor = oldestTradeId;
        }
      } catch {
        // network blip: fall through to whatever we collected, even if 0
      }

      if (cancelled) return;

      // Subsample if very dense — the chart only has ~800 px of width,
      // so >800 points is wasted rendering and harms framerate when
      // the WS is also pushing ticks. Keep one point per 200ms.
      collected.sort((a, b) => a.t - b.t);
      const decimated = [];
      let lastT = -Infinity;
      for (const p of collected) {
        if (p.t - lastT >= 200) {
          decimated.push(p);
          lastT = p.t;
        } else if (decimated.length > 0) {
          // Replace the in-bucket point with the latest one so the
          // chart hugs the most recent price within each bucket.
          decimated[decimated.length - 1] = p;
        }
      }

      // Anchor the series with openPrice@openedAt so the chart's left
      // edge always lines up with the threshold-stamping moment, even
      // if Coinbase's first trade in-window happened a few hundred ms
      // after the cron's openedAt timestamp.
      const head = { t: openedAtMs, price: Number(meta.openPrice) };
      if (decimated.length === 0 || decimated[0].t > openedAtMs) {
        setBackfill([head, ...decimated]);
      } else {
        setBackfill(decimated);
      }
    }

    run();
    return () => { cancelled = true; };
  }, [market.id, productId, openedAtMs, meta.openPrice, status, closesAt]);

  // Build the chart's history depending on lifecycle stage.
  //   resolved: backfill (1-min candles spanning the full window) +
  //             a final point anchored at (closesAt, closePrice) so
  //             the rightmost point exactly matches the settlement.
  //   active:   backfill (open + 1-min candles) + live ticker on top.
  //   pending:  just whatever the live ticker has accumulated.
  const chartHistory = useMemo(() => {
    if (status === 'resolved') {
      const base = backfill.length > 0
        ? [...backfill]
        : (meta.openedAt && meta.openPrice != null
            ? [{ t: new Date(meta.openedAt).getTime(), price: Number(meta.openPrice) }]
            : []);
      if (closesAt && meta.closePrice != null) {
        const lastT = base.length ? base[base.length - 1].t : 0;
        // Don't double-stamp if the last candle already sits at
        // closesAt — just overwrite its price to match the settlement
        // value (which can drift by a few cents from the closing candle).
        if (lastT >= closesAt.getTime() - 30_000) {
          base[base.length - 1] = { t: closesAt.getTime(), price: Number(meta.closePrice) };
        } else {
          base.push({ t: closesAt.getTime(), price: Number(meta.closePrice) });
        }
      }
      return base;
    }
    if (backfill.length === 0) return history;
    // Splice: backfill ends ~1 min ago (candle resolution); the live
    // ticker provides everything newer. Avoid double-counting any
    // overlap by cutting live history at the last backfill timestamp.
    const lastBackfillT = backfill[backfill.length - 1].t;
    const liveAfter = history.filter(p => p.t > lastBackfillT);
    return [...backfill, ...liveAfter];
  }, [status, backfill, history, meta.openedAt, meta.openPrice, meta.closePrice, closesAt]);

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
          xStart={opensAt ? opensAt.getTime() : undefined}
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

      {/* "Próximo mercado" — the cron pre-creates the next 5-min window
          as a pending market when the current one opens, so the user
          can place an early bet (the threshold gets stamped at the
          activation tick, until then prices stay at 50/50). Hidden for
          resolved markets — that view links back via Volver. */}
      {meta.nextMarketId && !isResolved && (
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => navigate(`/market?id=${encodeURIComponent(meta.nextMarketId)}`)}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 10,
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
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
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--green)';
              e.currentTarget.style.color = 'var(--green)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
          >
            <span>Próximo mercado ({meta.symbol || ''} · 5 min)</span>
            <span aria-hidden="true">→</span>
          </button>
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
