import React, { useState, useEffect } from 'react';
import { useT } from '../lib/i18n.js';

// ─── Mock leaderboard data (visual only) ─────────────────────────────────────
const MOCK_LEADERBOARD = [
  { rank: 1,  username: 'rodrigo_mx',   mxnp: 4820, streak: 14 },
  { rank: 2,  username: 'futbolero99',  mxnp: 4310, streak: 12 },
  { rank: 3,  username: 'capitalista_', mxnp: 3975, streak: 11 },
  { rank: 4,  username: 'PronoKing',    mxnp: 3620, streak: 9  },
  { rank: 5,  username: 'lalo_bet',     mxnp: 3210, streak: 8  },
  { rank: 6,  username: 'mxpredict',   mxnp: 2980, streak: 7  },
  { rank: 7,  username: 'carlota_mx',  mxnp: 2650, streak: 6  },
  { rank: 8,  username: 'apostador1',  mxnp: 2410, streak: 5  },
  { rank: 9,  username: 'tigresftw',   mxnp: 2150, streak: 4  },
  { rank: 10, username: 'america_no',  mxnp: 1890, streak: 3  },
];

// Cycle 1 ends April 28, 2026 midnight CST
const CYCLE_END_MS = new Date('2026-04-28T06:00:00Z').getTime(); // 06:00 UTC = midnight CST

function useCountdown(targetMs) {
  const [diff, setDiff] = useState(() => targetMs - Date.now());
  useEffect(() => {
    const id = setInterval(() => setDiff(targetMs - Date.now()), 30_000);
    return () => clearInterval(id);
  }, [targetMs]);
  const days  = Math.max(0, Math.floor(diff / 86_400_000));
  const hours = Math.max(0, Math.floor((diff % 86_400_000) / 3_600_000));
  return { days, hours };
}

const PRIZES = [
  { label: '🥇 1°', prize: '$250' },
  { label: '🥈 2°', prize: '$150' },
  { label: '🥉 3°', prize: '$100' },
  { label: '4°–10°', prize: '🎁' },
];

export default function Leaderboard() {
  const t = useT();
  const { days, hours } = useCountdown(CYCLE_END_MS);

  return (
    <aside style={{
      width: '100%',
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      overflow: 'hidden',
      fontFamily: 'var(--font-mono)',
    }}>

      {/* ── Header ── */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(0,232,122,0.08) 0%, transparent 100%)',
        borderBottom: '1px solid var(--border)',
        padding: '16px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.14em', marginBottom: 3, textTransform: 'uppercase' }}>
            {t('lb.cycle')}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {t('lb.title')}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {t('lb.prize')}
          </div>
        </div>
        <div style={{
          background: 'rgba(0,232,122,0.1)',
          border: '1px solid rgba(0,232,122,0.25)',
          borderRadius: 10,
          padding: '8px 12px',
          textAlign: 'center',
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)', lineHeight: 1 }}>
            {days}d {hours}h
          </div>
          <div style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.1em', marginTop: 3, textTransform: 'uppercase' }}>
            {t('lb.ends')}
          </div>
        </div>
      </div>

      {/* ── Prize strip ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        borderBottom: '1px solid var(--border)',
      }}>
        {PRIZES.map((p, i) => (
          <div key={i} style={{
            padding: '8px 4px',
            textAlign: 'center',
            borderRight: i < 3 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 2 }}>
              {p.label}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>
              {p.prize}
            </div>
          </div>
        ))}
      </div>

      {/* ── Rows ── */}
      <div>
        {MOCK_LEADERBOARD.map((entry, i) => {
          const top3   = i < 3;
          const medal  = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
          return (
            <div key={entry.rank} style={{
              display: 'flex',
              alignItems: 'center',
              padding: '9px 16px',
              borderBottom: i < 9 ? '1px solid var(--border)' : 'none',
              background: top3 ? 'rgba(0,232,122,0.025)' : 'transparent',
              gap: 8,
              transition: 'background 0.15s',
            }}>
              {/* Rank / medal */}
              <span style={{
                width: 20,
                textAlign: 'center',
                fontSize: medal ? 13 : 10,
                color: 'var(--text-muted)',
                flexShrink: 0,
              }}>
                {medal || entry.rank}
              </span>

              {/* Username */}
              <span style={{
                flex: 1,
                fontSize: 12,
                color: top3 ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: top3 ? 600 : 400,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {entry.username}
              </span>

              {/* Streak */}
              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                🔥{entry.streak}
              </span>

              {/* Points */}
              <span style={{
                fontSize: 12,
                fontWeight: 700,
                color: top3 ? 'var(--green)' : 'var(--text-secondary)',
                flexShrink: 0,
                minWidth: 44,
                textAlign: 'right',
              }}>
                {entry.mxnp.toLocaleString('es-MX')}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {t('lb.demo')}
        </span>
        <a href="/portfolio" style={{
          fontSize: 10,
          color: 'var(--green)',
          textDecoration: 'none',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {t('lb.earn')} →
        </a>
      </div>
    </aside>
  );
}
