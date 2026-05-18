import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function fmt(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function shortQuestion(value) {
  const text = String(value || '').trim();
  return text.length > 46 ? `${text.slice(0, 43)}...` : text;
}

function MetricRow({ row, value, suffix = 'MXNB', detail, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row.username)}
      style={{
        width: '100%',
        display: 'grid',
        gridTemplateColumns: '34px minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 10,
        padding: '9px 0',
        border: 'none',
        borderBottom: '1px solid var(--border)',
        background: 'transparent',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
        #{row.rank}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'var(--font-body)', fontWeight: 800 }}>
          @{row.username}
        </span>
        {detail && (
          <span style={{ display: 'block', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
            {detail}
          </span>
        )}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--green)', letterSpacing: '0.02em' }}>
        {fmt(value)} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>{suffix}</span>
      </span>
    </button>
  );
}

function Board({ title, subtitle, rows, metric, detailFor, onOpen }) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 12,
      background: 'var(--surface1)',
      padding: 18,
      minWidth: 0,
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: 12 }}>
        {subtitle}
      </div>
      {rows.length === 0 && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', padding: '14px 0' }}>
          Sin usuarios todavía.
        </div>
      )}
      {rows.map(row => (
        <MetricRow
          key={`${title}-${row.username}`}
          row={row}
          value={row[metric]}
          detail={detailFor?.(row)}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

export default function MvpLeaderboard({ currentUsername }) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      const qs = new URLSearchParams();
      qs.set('limit', '10');
      if (query.trim()) qs.set('q', query.trim());
      getJson(`/api/protocol/leaderboard?${qs.toString()}`)
        .then(({ ok, data: body }) => {
          if (!alive) return;
          if (!ok) throw new Error(body?.error || 'leaderboard_failed');
          setData(body);
          setError(null);
        })
        .catch(err => {
          if (!alive) return;
          setError(err?.message || 'leaderboard_failed');
          setData(null);
        });
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const firstMatch = useMemo(() => {
    const all = [
      ...(data?.portfolio || []),
      ...(data?.totalWon || []),
      ...(data?.biggestWin || []),
    ];
    const clean = query.trim().toLowerCase();
    return all.find(row => row.username === clean) || all[0] || null;
  }, [data, query]);

  function openProfile(username) {
    const clean = String(username || '').trim().toLowerCase();
    if (!clean) return;
    navigate(`/u/${encodeURIComponent(clean)}`, {
      state: { from: `${location.pathname}${location.search}${location.hash}` || '/portfolio' },
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (firstMatch?.username) openProfile(firstMatch.username);
  }

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--orange)', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 4 }}>
            Leaderboard MVP
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--text-primary)', margin: 0, letterSpacing: '0.03em' }}>
            Rankings on-chain
          </h2>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, minWidth: 'min(100%, 320px)' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar usuario"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '10px 12px',
              borderRadius: 9,
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          />
          <button className="btn-ghost" type="submit" disabled={!firstMatch}>
            Ver
          </button>
        </form>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, border: '1px solid rgba(255,69,69,0.24)', background: 'rgba(255,69,69,0.08)', color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 14 }}>
        <Board
          title="Top carteras"
          subtitle="Valor actual en wallet + posiciones abiertas."
          rows={data?.portfolio || []}
          metric="portfolioValue"
          detailFor={row => currentUsername === row.username ? 'Tú' : `${fmt(row.walletBalance)} wallet · ${fmt(row.openPositionValue)} posiciones`}
          onOpen={openProfile}
        />
        <Board
          title="Total ganado"
          subtitle="MXNB reclamado en mercados ganadores."
          rows={data?.totalWon || []}
          metric="totalWon"
          detailFor={row => currentUsername === row.username ? 'Tú' : null}
          onOpen={openProfile}
        />
        <Board
          title="Mayor victoria"
          subtitle="Mayor pago conseguido en un solo mercado."
          rows={data?.biggestWin || []}
          metric="biggestWin"
          detailFor={row => shortQuestion(row.biggestWinQuestion)}
          onOpen={openProfile}
        />
      </div>
    </section>
  );
}
