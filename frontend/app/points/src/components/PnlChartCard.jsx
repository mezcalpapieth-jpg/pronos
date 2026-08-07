import React from 'react';
import PnlChart from '@app/components/PnlChart.jsx';

/**
 * The PnL-over-time card, shared by the portfolio and public profiles so
 * both surfaces read identically — same ranges, same framing, same colors.
 *
 * The headline number is the series' last point, which by construction is
 * the same figure as the "PnL total" stat: the series carries unrealized
 * mark-to-market at every sample, not only realized cash flows.
 */

const RANGES = [
  { days: 7, label: '7D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
  { days: 0, label: 'TOTAL' },
];

function signedFmt(n) {
  const v = Number(n) || 0;
  return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}`;
}

export default function PnlChartCard({
  series = [],
  range = 0,
  onRangeChange,
  loading = false,
  title = 'Evolución del PnL',
  emptyLabel,
  emptySubLabel,
  height = 200,
}) {
  const last = series.length ? series[series.length - 1].v : 0;
  const positive = last >= 0;

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 12,
      background: 'var(--surface1)',
      padding: 16,
      marginBottom: 20,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 12,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6,
          }}>
            {title}
          </div>
          {/* Sign is carried by the +/− glyph as well as the color, so the
              reading never depends on telling green from red. */}
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700,
            color: positive ? 'var(--success)' : 'var(--danger)',
          }}>
            {series.length ? `${signedFmt(last)} MXNP` : '—'}
          </div>
        </div>

        {onRangeChange && (
          <div style={{ display: 'flex', gap: 4 }}>
            {RANGES.map(r => {
              const active = r.days === range;
              return (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => onRangeChange(r.days)}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
                    padding: '5px 9px', borderRadius: 6, cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--border-active)' : 'var(--border)'}`,
                    background: active ? 'var(--surface3)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Hold the previous render while refetching rather than collapsing to
          a skeleton — the card must not jump as ranges change. */}
      <div style={{ opacity: loading && series.length ? 0.45 : 1, transition: 'opacity 0.15s' }}>
        <PnlChart
          data={series}
          height={height}
          valueSuffix="MXNP"
          emptyLabel={emptyLabel}
          emptySubLabel={emptySubLabel}
          ariaLabel={title}
        />
      </div>
    </div>
  );
}
