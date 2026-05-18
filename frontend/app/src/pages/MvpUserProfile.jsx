import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';

function fmt(value, digits = 2) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(n) ? n : 0);
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function shortHash(value) {
  const s = String(value || '');
  if (s.length < 14) return s || '—';
  return `${s.slice(0, 8)}...${s.slice(-6)}`;
}

function Stat({ label, value, color = 'var(--text-primary)' }) {
  return (
    <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface1)' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, color, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function PositionRow({ row }) {
  return (
    <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface1)', marginBottom: 10 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 5 }}>
        {row.question || `Mercado #${row.marketId}`}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
        <span>{row.outcomeLabel}</span>
        <span>{fmt(row.shares, 4)} acciones</span>
        <span>valor {fmt(row.currentValue)} MXNB</span>
        <span style={{ color: Number(row.unrealizedPnl || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {Number(row.unrealizedPnl || 0) >= 0 ? '+' : ''}{fmt(row.unrealizedPnl)} MXNB
        </span>
      </div>
    </div>
  );
}

function HistoryRow({ row }) {
  const label = row.side === 'buy'
    ? 'Compra'
    : row.side === 'sell'
      ? 'Venta'
      : row.side === 'redeem'
        ? 'Cobro'
        : row.side;
  return (
    <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface1)', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, color: 'var(--text-primary)' }}>
          {row.question || `Mercado #${row.marketId}`}
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: row.side === 'redeem' ? 'var(--green)' : 'var(--text-primary)' }}>
          {fmt(row.collateral)} MXNB
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 5, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
        <span>{label}</span>
        <span>{fmtDate(row.createdAt)}</span>
        <span>{shortHash(row.txHash)}</span>
      </div>
    </div>
  );
}

export default function MvpUserProfile({ onOpenLogin }) {
  const { username } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('activo');

  const backTarget = typeof location.state?.from === 'string' && location.state.from.startsWith('/')
    ? location.state.from
    : '/portfolio';

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/protocol/u?username=${encodeURIComponent(username || '')}`, {
      credentials: 'include',
    })
      .then(async res => {
        if (!alive) return;
        if (res.status === 404) throw new Error('user_not_found');
        if (!res.ok) throw new Error('profile_failed');
        return res.json();
      })
      .then(body => {
        if (alive) setData(body);
      })
      .catch(err => {
        if (alive) setError(err?.message || 'profile_failed');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [username]);

  const rows = useMemo(() => (
    tab === 'activo' ? (data?.active || []) : (data?.history || [])
  ), [data, tab]);

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <main style={{ maxWidth: 1080, margin: '0 auto', padding: 'clamp(22px, 5vw, 52px) clamp(14px, 4vw, 48px) 72px' }}>
        <button
          type="button"
          onClick={() => navigate(backTarget)}
          className="btn-ghost"
          style={{ marginBottom: 24 }}
        >
          ← Volver
        </button>

        {loading && (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Cargando perfil...
          </div>
        )}

        {!loading && error && (
          <div style={{ padding: 40, border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface1)', textAlign: 'center' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', margin: 0 }}>
              Usuario no encontrado
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              No encontramos @{username}.
            </p>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.16em', color: 'var(--orange)', textTransform: 'uppercase', marginBottom: 6 }}>
                Perfil on-chain
              </div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(42px, 8vw, 78px)', lineHeight: 0.9, color: 'var(--text-primary)', margin: 0 }}>
                @{data.user.username}
              </h1>
              <div style={{ marginTop: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 12 }}>
                Miembro desde {fmtDate(data.user.joinedAt)}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 24 }}>
              <Stat label="Valor de cartera" value={`${fmt(data.stats.portfolioValue)} MXNB`} color="var(--green)" />
              <Stat label="Total ganado" value={`${fmt(data.stats.totalWon)} MXNB`} color="var(--orange)" />
              <Stat label="Mayor victoria" value={`${fmt(data.stats.biggestWin)} MXNB`} color="var(--green)" />
              <Stat label="Posiciones" value={String(data.stats.activePositions || 0)} />
            </div>

            {data.stats.biggestWinQuestion && (
              <div style={{ marginBottom: 22, padding: 16, borderRadius: 12, border: '1px solid rgba(255,85,0,0.28)', background: 'rgba(255,85,0,0.08)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--orange)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Mejor mercado
                </div>
                <div style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontWeight: 800 }}>
                  {data.stats.biggestWinQuestion}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
              {['activo', 'historial'].map(key => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: tab === key ? '2px solid var(--green)' : '2px solid transparent',
                    color: tab === key ? 'var(--text-primary)' : 'var(--text-muted)',
                    padding: '10px 16px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  {key}
                </button>
              ))}
            </div>

            {rows.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                Sin movimientos para mostrar.
              </div>
            )}
            {rows.map((row, index) => (
              tab === 'activo'
                ? <PositionRow key={`${row.marketId}-${row.outcomeIndex}-${index}`} row={row} />
                : <HistoryRow key={row.id || `${row.marketId}-${index}`} row={row} />
            ))}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
