import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { useT } from '../lib/i18n.js';

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const FALLBACK_DEPOSIT_METHODS = [
  { id: 'spei', label: 'SPEI', enabled: true, comingSoon: false },
  { id: 'card', label: 'Tarjeta', enabled: false, comingSoon: true },
  { id: 'apple_pay', label: 'Apple Pay', enabled: false, comingSoon: true },
];

function formatMoney(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function shortAddress(address) {
  if (!address) return '—';
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CopyButton({ value, label }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={copy}
      disabled={!value}
      style={{ minWidth: 86, fontSize: 11 }}
    >
      {copied ? t('fund.copied') : label || t('fund.copy')}
    </button>
  );
}

function StatusText({ status }) {
  const t = useT();
  const text = status === 'ready'
    ? t('fund.ready')
    : status === 'juno_not_configured'
      ? t('fund.notConfigured')
      : t('fund.pending');
  const color = status === 'ready' ? 'var(--yes)' : status === 'juno_not_configured' ? 'var(--orange)' : 'var(--text-secondary)';
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 10px',
      borderRadius: 999,
      border: '1px solid var(--border)',
      color,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      {text}
    </div>
  );
}

export default function FundingPage({ onOpenLogin }) {
  const t = useT();
  const [params] = useSearchParams();
  const { authenticated, loading: authLoading, user } = usePointsAuth();
  const [funding, setFunding] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [selectedMethod, setSelectedMethod] = useState('spei');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [destinationClabe, setDestinationClabe] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const startWithdraw = params.get('mode') === 'withdraw';

  const loadFunding = useCallback(async ({ silent = false } = {}) => {
    if (!authenticated) return;
    setLoading(true);
    setError(null);
    return getJson('/api/protocol/onboarding/funding')
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.error || 'funding_failed');
        setFunding(data);
      })
      .catch(err => {
        setError(err?.message || 'funding_failed');
      })
      .finally(() => {
        setLoading(false);
        if (!silent) setNotice(null);
      });
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    let alive = true;
    loadFunding().finally(() => {
      if (!alive) return;
    });
    return () => { alive = false; };
  }, [authenticated, loadFunding, user?.walletAddress]);

  const balance = Number(funding?.balance?.balance || 0);
  const canWithdraw = Boolean(funding?.withdraw?.enabled && balance > 0);
  const status = funding?.status || (loading ? 'loading' : 'juno_not_configured');
  const depositMethods = funding?.depositMethods || funding?.deposit?.methods || FALLBACK_DEPOSIT_METHODS;
  const activeMethod = depositMethods.find(m => m.id === selectedMethod) || depositMethods[0];
  const history = Array.isArray(funding?.history) ? funding.history : [];
  const withdrawCardBorder = useMemo(() => (
    startWithdraw ? 'rgba(22,163,74,0.35)' : 'var(--border)'
  ), [startWithdraw]);

  async function handleWithdrawalSubmit(e) {
    e.preventDefault();
    if (!canWithdraw || submittingWithdrawal) return;
    setSubmittingWithdrawal(true);
    setError(null);
    setNotice(null);
    try {
      const { ok, data } = await postJson('/api/protocol/onboarding/withdrawal-request', {
        amount: withdrawAmount,
        destinationClabe,
        destinationName,
      });
      if (!ok) throw new Error(data?.error || 'withdrawal_request_failed');
      setNotice('Retiro solicitado. Lo verás en movimientos mientras el proveedor queda conectado.');
      setWithdrawAmount('');
      setDestinationClabe('');
      setDestinationName('');
      await loadFunding({ silent: true });
    } catch (err) {
      setError(err?.message || 'withdrawal_request_failed');
    } finally {
      setSubmittingWithdrawal(false);
    }
  }

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <main style={{
        padding: 'clamp(22px, 5vw, 52px) clamp(14px, 4vw, 48px) 72px',
        maxWidth: 1120,
        margin: '0 auto',
      }}>
        <Link to="/portfolio" style={{
          display: 'inline-block',
          marginBottom: 24,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          letterSpacing: '0.1em',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          textDecoration: 'none',
        }}>
          ← Portafolio
        </Link>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-end', marginBottom: 28, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(38px, 7vw, 76px)', lineHeight: 0.9, color: 'var(--text-primary)', letterSpacing: '0.04em', margin: 0 }}>
              {t('fund.title')}
            </h1>
            <p style={{ fontFamily: 'var(--font-body)', color: 'var(--text-secondary)', marginTop: 12, maxWidth: 620 }}>
              {t('fund.subtitle')}
            </p>
          </div>
          {authenticated && <StatusText status={status} />}
        </div>

        {!authenticated && !authLoading && (
          <div style={{ padding: 36, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface1)', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>{t('fund.login')}</p>
            <button className="btn-primary" onClick={onOpenLogin}>{t('nav.predict')}</button>
          </div>
        )}

        {authenticated && (
          <>
            {error && (
              <div style={{ marginBottom: 18, padding: 14, border: '1px solid rgba(255,69,69,0.25)', borderRadius: 10, color: 'var(--red)', background: 'rgba(255,69,69,0.08)', fontFamily: 'var(--font-mono)' }}>
                {error}
              </div>
            )}
            {notice && (
              <div style={{ marginBottom: 18, padding: 14, border: '1px solid rgba(245,158,11,0.35)', borderRadius: 10, color: 'var(--orange)', background: 'rgba(255,85,0,0.08)', fontFamily: 'var(--font-mono)' }}>
                {notice}
              </div>
            )}

            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 18 }}>
              <div style={{
                border: '1px solid rgba(255,85,0,0.28)',
                borderRadius: 12,
                background: 'var(--surface1)',
                padding: 24,
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.16em', color: 'var(--orange)', textTransform: 'uppercase', marginBottom: 10 }}>
                  {t('fund.depositTitle')}
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, letterSpacing: '0.04em', marginBottom: 20 }}>
                  MXN → MXNB
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                  {depositMethods.map(method => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => method.enabled && setSelectedMethod(method.id)}
                      disabled={!method.enabled}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 999,
                        border: `1px solid ${activeMethod?.id === method.id ? 'rgba(255,85,0,0.55)' : 'var(--border)'}`,
                        background: activeMethod?.id === method.id ? 'rgba(255,85,0,0.14)' : 'var(--surface2)',
                        color: method.enabled ? 'var(--text-primary)' : 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        cursor: method.enabled ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {method.label}
                      {method.comingSoon ? ' · pronto' : ''}
                    </button>
                  ))}
                </div>

                {activeMethod?.id !== 'spei' && (
                  <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: 'rgba(255,85,0,0.08)', border: '1px solid rgba(255,85,0,0.25)', color: 'var(--orange)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {activeMethod?.label || 'Método'} queda listo cuando el proveedor active checkout.
                  </div>
                )}

                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--surface2)' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
                      {t('fund.clabe')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className="funding-value" style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 18, color: funding?.clabe ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {funding?.clabe || '—'}
                      </div>
                      <CopyButton value={funding?.clabe} />
                    </div>
                  </div>

                  <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--surface2)' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
                      {t('fund.wallet')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className="funding-value" title={funding?.walletAddress || user?.walletAddress || ''} style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--text-primary)' }}>
                        {shortAddress(funding?.walletAddress || user?.walletAddress)}
                      </div>
                      <CopyButton value={funding?.walletAddress || user?.walletAddress} />
                    </div>
                  </div>
                </div>
              </div>

              <div style={{
                border: `1px solid ${withdrawCardBorder}`,
                borderRadius: 12,
                background: 'var(--surface1)',
                padding: 24,
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.16em', color: 'var(--yes)', textTransform: 'uppercase', marginBottom: 10 }}>
                  {t('fund.withdrawTitle')}
                </div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                    {t('fund.balance')}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, color: canWithdraw ? 'var(--yes)' : 'var(--text-secondary)', lineHeight: 1 }}>
                    {formatMoney(balance)} MXNB
                  </div>
                </div>
                <form onSubmit={handleWithdrawalSubmit} style={{ display: 'grid', gap: 10 }}>
                  <input
                    value={withdrawAmount}
                    onChange={e => setWithdrawAmount(e.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Monto"
                    style={{
                      width: '100%',
                      padding: '11px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface2)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                  <input
                    value={destinationClabe}
                    onChange={e => setDestinationClabe(e.target.value)}
                    inputMode="numeric"
                    maxLength={18}
                    placeholder="CLABE destino"
                    style={{
                      width: '100%',
                      padding: '11px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface2)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                  <input
                    value={destinationName}
                    onChange={e => setDestinationName(e.target.value)}
                    placeholder="Nombre destino"
                    style={{
                      width: '100%',
                      padding: '11px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface2)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                  <button
                    className="btn-ghost"
                    disabled={!canWithdraw || submittingWithdrawal || !withdrawAmount || destinationClabe.replace(/\D/g, '').length !== 18}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      borderColor: canWithdraw ? 'rgba(22,163,74,0.4)' : 'var(--border)',
                      color: canWithdraw ? 'var(--yes)' : 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.12em',
                    }}
                  >
                    {submittingWithdrawal ? 'Solicitando…' : t('fund.withdrawTitle')}
                  </button>
                </form>
              </div>
            </section>

            <section style={{
              marginTop: 18,
              border: '1px solid var(--border)',
              borderRadius: 12,
              background: 'var(--surface1)',
              padding: 24,
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.16em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 14 }}>
                Movimientos
              </div>
              {history.length === 0 && (
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  Todavía no hay depósitos ni retiros.
                </p>
              )}
              {history.map(item => (
                <div key={item.id} style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '12px 0',
                  borderTop: '1px solid var(--border)',
                }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-body)', color: 'var(--text-primary)', fontWeight: 700 }}>
                      {item.label}
                    </div>
                    <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 11 }}>
                      {formatDate(item.createdAt)} · {item.destinationClabe || item.txHash || item.status || 'sin referencia'}
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: item.kind === 'deposit' ? 'var(--orange)' : 'var(--yes)' }}>
                    {item.kind === 'deposit' ? '+' : '-'}{formatMoney(item.amount)} {item.asset || 'MXNB'}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
