/**
 * MVP World Cup hub — /mvp/c/world-cup.
 *
 * Lean version of the Points World-Cup page: hero countdown + a grid of
 * on-chain World-Cup markets (category='world-cup' AND mode='onchain').
 * Rich bracket / group-stage drawer UI lives on the Points app — the MVP
 * re-surfaces the same raw data through its own Turnkey-backed trading
 * flow so every bet lands on-chain.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import BetModal from '../components/BetModal.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { OPENING_KICKOFF_ISO } from '../../points/src/lib/worldCup.js';

const HERO_GRADIENT =
  'linear-gradient(130deg, rgba(22,163,74,0.25) 0%, rgba(220,38,38,0.22) 45%, rgba(59,130,246,0.28) 100%), var(--surface1)';

function pad(n) { return String(n).padStart(2, '0'); }

function useCountdown(targetIso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const deltaSec = Math.max(0, Math.floor((new Date(targetIso).getTime() - now) / 1000));
  return {
    done: deltaSec === 0,
    days: Math.floor(deltaSec / 86400),
    hours: Math.floor((deltaSec % 86400) / 3600),
    mins: Math.floor((deltaSec % 3600) / 60),
    secs: deltaSec % 60,
  };
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

function pricesFromReserves(reserves) {
  if (!Array.isArray(reserves) || reserves.length < 2) return [];
  const invs = reserves.map(r => (Number(r) > 0 ? 1 / Number(r) : 0));
  const total = invs.reduce((s, v) => s + v, 0) || 1;
  return invs.map(v => v / total);
}

function MarketTile({ m, onBet }) {
  const navigate = useNavigate();
  const prices = useMemo(() => {
    if (Array.isArray(m.prices) && m.prices.length > 0) return m.prices;
    return pricesFromReserves(m.reserves || []);
  }, [m]);

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 14,
      background: 'var(--surface1)',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/market?id=${m.id}`)}
          style={{ cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.4 }}
        >
          {m.question}
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          padding: '3px 6px', borderRadius: 6,
          background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)',
          color: '#60a5fa', textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}>
          on-chain
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(m.outcomes || []).map((label, i) => {
          const pct = Math.round((prices[i] || 0) * 100);
          return (
            <button
              key={i}
              onClick={() => onBet({ market: m, outcomeIndex: i, outcome: label, outcomePct: pct })}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--surface2)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <span style={{ textAlign: 'left' }}>{label}</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 11,
                color: 'var(--text-muted)', letterSpacing: '0.04em',
              }}>
                {pct}¢
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10,
                padding: '2px 8px', borderRadius: 6,
                background: 'rgba(0,232,122,0.12)', color: 'var(--green)',
                letterSpacing: '0.06em',
              }}>
                APOSTAR
              </span>
            </button>
          );
        })}
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
        letterSpacing: '0.04em', borderTop: '1px solid var(--border)', paddingTop: 10,
      }}>
        <span>#{m.id}</span>
        <span>{m.endTime ? `cierra ${formatDate(m.endTime)}` : ''}</span>
      </div>
    </div>
  );
}

export default function WorldCupPage({ onOpenLogin }) {
  const { authenticated } = usePointsAuth();
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bet, setBet] = useState(null);
  const countdown = useCountdown(OPENING_KICKOFF_ISO);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          '/api/points/markets?mode=onchain&category=world-cup&featured=all&status=active&limit=500',
          { credentials: 'include' },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'load_failed');
        if (!cancelled) setMarkets(Array.isArray(data?.markets) ? data.markets : []);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'load_failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function handleBet({ market, outcomeIndex, outcome, outcomePct }) {
    if (!authenticated) { onOpenLogin?.(); return; }
    setBet({ market, outcomeIndex, outcome, outcomePct });
  }

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <div className="category-bar-sticky">
        <CategoryBar />
      </div>

      {/* Hero — countdown to opener */}
      <section style={{
        background: HERO_GRADIENT,
        borderBottom: '1px solid var(--border)',
        padding: '48px 48px 36px',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.18em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10,
          }}>
            Mundial 2026 · MVP on-chain
          </div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 'clamp(34px, 5vw, 54px)',
            letterSpacing: '0.03em', color: 'var(--text-primary)', marginBottom: 12, lineHeight: 1.05,
          }}>
            El torneo sobre el que todo el mundo va a apostar
          </h1>
          <p style={{
            fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--text-secondary)',
            maxWidth: 680, lineHeight: 1.6, marginBottom: 22,
          }}>
            Todos los mercados de abajo se liquidan en <strong>MXNB on-chain</strong> con firma
            delegada vía Turnkey — cero fricción, cero gas visible.
          </p>

          {!countdown.done && (
            <div style={{
              display: 'inline-flex', gap: 14, alignItems: 'center',
              padding: '12px 18px', borderRadius: 12,
              background: 'var(--surface2)', border: '1px solid var(--border)',
              fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Kickoff Azteca
              </span>
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)', letterSpacing: '0.04em' }}>
                {pad(countdown.days)}d · {pad(countdown.hours)}h · {pad(countdown.mins)}m · {pad(countdown.secs)}s
              </span>
            </div>
          )}
        </div>
      </section>

      <main style={{ padding: '32px 48px 80px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text-primary)', margin: 0, letterSpacing: '0.03em' }}>
            Mercados activos
          </h2>
          <Link to="/" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            ← todos los mercados
          </Link>
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</div>}
        {error && <div style={{ padding: 20, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>Error: {error}</div>}

        {!loading && !error && markets.length === 0 && (
          <div style={{
            padding: 40, textAlign: 'center', border: '1px dashed var(--border)',
            borderRadius: 14, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
          }}>
            Sin mercados on-chain del Mundial por ahora. Regístralos desde{' '}
            <Link to="/admin" style={{ color: 'var(--green)' }}>admin</Link>.
          </div>
        )}

        {!loading && !error && markets.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 16,
          }}>
            {markets.map(m => (
              <MarketTile key={m.id} m={m} onBet={handleBet} />
            ))}
          </div>
        )}
      </main>

      <BetModal
        open={!!bet}
        onClose={() => setBet(null)}
        outcome={bet?.outcome}
        outcomePct={bet?.outcomePct}
        outcomeIndex={bet?.outcomeIndex}
        marketId={bet?.market?.id}
        marketTitle={bet?.market?.question}
        market={bet?.market}
        onOpenLogin={onOpenLogin}
      />

      <Footer />
    </>
  );
}
