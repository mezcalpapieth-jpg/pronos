import React from 'react';
import { PARLAY_RULES_FALLBACK } from '../lib/combinadaSlip.js';

function compactQuestion(value) {
  const text = String(value || '').trim();
  return text.length > 74 ? `${text.slice(0, 71)}...` : text;
}

function formatLegPrice(price) {
  if (!Number.isFinite(Number(price))) return '--';
  const cents = Math.max(0, Math.min(100, Number(price) * 100));
  return `${cents.toFixed(cents >= 10 ? 1 : 2)}c`;
}

export default function CombinadaSlipPanel({
  legs,
  stake,
  state,
  rules,
  lang,
  authenticated,
  onStakeChange,
  onQuote,
  onSubmit,
  onRemove,
  onClear,
  onOpenLogin,
}) {
  const copy = lang === 'en'
    ? {
        title: 'Combo slip',
        empty: 'Add 3 to 6 picks.',
        stake: 'Stake',
        quote: 'Quote',
        create: 'Create combo',
        creating: 'Creating...',
        multiplier: 'Multiplier',
        payout: 'Payout',
        profit: 'Profit',
        cap: 'Max payout',
        remove: 'Remove',
        clear: 'Clear',
        signIn: 'Sign in',
      }
    : {
        title: 'Combinada',
        empty: 'Agrega 3 a 6 selecciones.',
        stake: 'Stake',
        quote: 'Cotizar',
        create: 'Crear combinada',
        creating: 'Creando...',
        multiplier: 'Multiplicador',
        payout: 'Paga',
        profit: 'Ganancia',
        cap: 'Tope',
        remove: 'Quitar',
        clear: 'Limpiar',
        signIn: 'Inicia sesion',
      };
  const minLegs = Number(rules?.minLegs || PARLAY_RULES_FALLBACK.minLegs);
  const maxLegs = Number(rules?.maxLegs || PARLAY_RULES_FALLBACK.maxLegs);
  const minStake = Number(rules?.minStakeMxnp || PARLAY_RULES_FALLBACK.minStakeMxnp);
  const maxPayout = Number(rules?.maxPayoutMxnp || PARLAY_RULES_FALLBACK.maxPayoutMxnp);
  const canQuote = legs.length >= minLegs && !state?.loading && !state?.submitting;
  const canSubmit = canQuote && !state?.submitting;
  const quote = state?.quote;

  return (
    <div style={{
      marginTop: 16,
      paddingTop: 16,
      borderTop: '1px solid var(--border)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 10,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-muted)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}>
          {copy.title}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: legs.length >= minLegs ? 'var(--green)' : 'var(--text-muted)',
          letterSpacing: '0.08em',
        }}>
          {legs.length}/{maxLegs}
        </div>
      </div>

      {legs.length === 0 ? (
        <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {copy.empty}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {legs.map((leg) => (
            <div
              key={`${leg.marketId}-${leg.outcomeIndex}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: 10,
                alignItems: 'center',
                padding: '9px 10px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--surface2)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {leg.outcomeLabel || `#${leg.outcomeIndex + 1}`}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.04em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginTop: 3,
                }}>
                  {compactQuestion(leg.question)}
                  {Number.isFinite(Number(leg.price)) ? ` - ${formatLegPrice(leg.price)}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(leg.marketId)}
                title={copy.remove}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  width: 30,
                  height: 30,
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 14,
                }}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
        <label style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: '0.08em',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
        }}>
          {copy.stake}
          <input
            value={stake}
            onChange={e => onStakeChange(e.target.value)}
            inputMode="decimal"
            min={minStake}
            max={maxPayout}
            style={{
              width: '100%',
              height: 38,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text-primary)',
              padding: '0 10px',
              fontFamily: 'var(--font-mono)',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
          <span style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'none' }}>
            {copy.cap}: {Number(maxPayout || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXNP
          </span>
        </label>
        <button
          type="button"
          onClick={onQuote}
          disabled={!canQuote}
          style={{
            height: 38,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: canQuote ? 'var(--surface2)' : 'rgba(255,255,255,0.03)',
            color: canQuote ? 'var(--text-primary)' : 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: canQuote ? 'pointer' : 'not-allowed',
            padding: '0 12px',
          }}
        >
          {state?.loading ? '...' : copy.quote}
        </button>
      </div>

      {quote && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 8,
          marginTop: 12,
          fontFamily: 'var(--font-mono)',
        }}>
          {[
            [copy.multiplier, `${Number(quote.multiplier || 0).toFixed(2)}x`],
            [copy.payout, `${Number(quote.potentialPayout || 0).toFixed(2)} MXNP`],
            [copy.profit, `${Number(quote.potentialProfit || 0).toFixed(2)} MXNP`],
          ].map(([label, value]) => (
            <div key={label} style={{ minWidth: 0 }}>
              <div style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {(state?.error || state?.message) && (
        <p style={{
          margin: '10px 0 0',
          color: state?.error ? 'var(--danger)' : 'var(--green)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          lineHeight: 1.5,
        }}>
          {state.error || state.message}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={authenticated ? onSubmit : onOpenLogin}
          disabled={authenticated ? !canSubmit : false}
          style={{
            flex: 1,
            minHeight: 40,
            borderRadius: 8,
            border: 'none',
            background: authenticated && !canSubmit ? 'rgba(255,85,0,0.35)' : 'var(--orange)',
            color: '#050505',
            fontFamily: 'var(--font-mono)',
            fontWeight: 800,
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: authenticated && !canSubmit ? 'not-allowed' : 'pointer',
          }}
        >
          {authenticated
            ? (state?.submitting ? copy.creating : copy.create)
            : copy.signIn}
        </button>
        {legs.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            title={copy.clear}
            style={{
              width: 42,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            x
          </button>
        )}
      </div>
    </div>
  );
}
