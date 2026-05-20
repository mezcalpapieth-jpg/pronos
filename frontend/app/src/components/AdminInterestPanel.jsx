import React, { useMemo, useState } from 'react';

const DEFAULT_WINDOWS = [
  { key: 'day', label: 'Hoy' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'lifetime', label: 'Vida' },
];

function countFor(item, windowKey) {
  return Number(item?.counts?.[windowKey] || 0);
}

function subtitleFor(item) {
  return [item?.surface, item?.sport, item?.league, item?.status]
    .filter(Boolean)
    .join(' · ');
}

function MiniSparkline({ series = [] }) {
  const points = Array.isArray(series) ? series.slice(-14) : [];
  const max = Math.max(1, ...points.map(point => Number(point.count || 0)));
  return (
    <div
      className="interest-sparkline"
      aria-hidden="true"
      style={{
        display: 'flex',
        alignItems: 'end',
        gap: 2,
        width: 58,
        height: 22,
        flexShrink: 0,
      }}
    >
      {Array.from({ length: 14 }, (_, index) => {
        const point = points[index - (14 - points.length)];
        const height = point ? Math.max(3, Math.round((Number(point.count || 0) / max) * 22)) : 3;
        return (
          <span
            key={index}
            style={{
              width: 3,
              height,
              borderRadius: 3,
              background: point ? 'var(--orange)' : 'var(--border)',
              opacity: point ? 0.9 : 0.45,
            }}
          />
        );
      })}
    </div>
  );
}

function InterestList({ title, items, windowKey }) {
  const max = Math.max(1, ...items.map(item => countFor(item, windowKey)));
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.1em',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        marginBottom: 10,
      }}>
        {title}
      </div>
      {items.length === 0 && (
        <p style={{
          margin: 0,
          padding: '14px 0',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}>
          Sin señales todavía.
        </p>
      )}
      <div style={{ display: 'grid', gap: 9 }}>
        {items.map(item => {
          const count = countFor(item, windowKey);
          const pct = Math.max(4, Math.round((count / max) * 100));
          return (
            <div
              key={`${item.surface}-${item.objectType}-${item.objectId}`}
              style={{
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--surface2)',
              }}
            >
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                alignItems: 'center',
                gap: 10,
                marginBottom: 8,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 13,
                    fontWeight: 800,
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {item.label || item.question || item.objectId}
                  </div>
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {subtitleFor(item) || item.objectType}
                  </div>
                </div>
                <MiniSparkline series={item.series} />
                <div style={{
                  minWidth: 42,
                  textAlign: 'right',
                  fontFamily: 'var(--font-display)',
                  fontSize: 24,
                  color: 'var(--orange)',
                }}>
                  {count}
                </div>
              </div>
              <div style={{
                height: 5,
                borderRadius: 999,
                background: 'rgba(255,255,255,0.06)',
                overflow: 'hidden',
              }}>
                <span style={{
                  display: 'block',
                  width: `${pct}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: 'linear-gradient(90deg, var(--orange), var(--green))',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminInterestPanel({ interest }) {
  const windows = Array.isArray(interest?.windows) && interest.windows.length > 0
    ? interest.windows
    : DEFAULT_WINDOWS;
  const [windowKey, setWindowKey] = useState(windows[1]?.key || 'week');

  const teams = useMemo(() => {
    return [...(interest?.teams || [])].sort((a, b) => countFor(b, windowKey) - countFor(a, windowKey)).slice(0, 8);
  }, [interest, windowKey]);
  const markets = useMemo(() => {
    return [...(interest?.markets || [])].sort((a, b) => countFor(b, windowKey) - countFor(a, windowKey)).slice(0, 8);
  }, [interest, windowKey]);

  const total = [...(interest?.teams || []), ...(interest?.markets || [])]
    .reduce((sum, item) => sum + countFor(item, windowKey), 0);

  return (
    <section style={{
      marginTop: 20,
      padding: 20,
      border: '1px solid var(--border)',
      borderRadius: 12,
      background: 'var(--surface2)',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 16,
        alignItems: 'start',
        marginBottom: 18,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.1em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            Interés
          </div>
          <h3 style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            color: 'var(--text-primary)',
          }}>
            Señales de equipos y mercados
          </h3>
        </div>
        <div style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
        }}>
          {windows.map(windowOption => (
            <button
              key={windowOption.key}
              type="button"
              onClick={() => setWindowKey(windowOption.key)}
              style={{
                border: `1px solid ${windowKey === windowOption.key ? 'rgba(255,85,0,0.55)' : 'var(--border)'}`,
                borderRadius: 999,
                background: windowKey === windowOption.key ? 'rgba(255,85,0,0.1)' : 'var(--surface1)',
                color: windowKey === windowOption.key ? 'var(--orange)' : 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '8px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {windowOption.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 14,
        alignItems: 'start',
      }}>
        <InterestList title="Equipos" items={teams} windowKey={windowKey} />
        <InterestList title="Mercados" items={markets} windowKey={windowKey} />
        <aside style={{
          minHeight: 160,
          padding: 14,
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface1)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.1em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            Total
          </div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 48,
            lineHeight: 1,
            color: 'var(--green)',
          }}>
            {total}
          </div>
          <p style={{
            margin: '10px 0 0',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            lineHeight: 1.45,
          }}>
            Cuenta hasta 5 señales por usuario/dispositivo al día. Si vuelve mañana, vuelve a subir.
          </p>
        </aside>
      </div>
    </section>
  );
}
