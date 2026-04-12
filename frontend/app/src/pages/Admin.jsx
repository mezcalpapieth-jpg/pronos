import React, { useState, useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import Nav from '../components/Nav.jsx';
import { getProtocolMode, setProtocolMode, isAdmin, getContracts } from '../lib/protocol.js';
import { resolveMarket, fetchResolutions } from '../lib/resolutions.js';
import { fetchGeneratedMarkets, updateGeneratedMarket, createGeneratedMarket } from '../lib/generatedMarkets.js';
import { gmFetchMarkets } from '../lib/gamma.js';
import { resolveEndDate, isExpired } from '../lib/deadline.js';
import { useT } from '../lib/i18n.js';
import MARKETS from '../lib/markets.js';
import {
  fetchAllPolymarketDecisions,
  approvePolymarketMarket,
  rejectPolymarketMarket,
  unapprovePolymarketMarket,
  bulkTranslatePolymarket,
  polymarketApprovalKey,
} from '../lib/polymarketApproved.js';
import {
  getSafeAddresses, setSafeAddresses,
  createSafe, proposeTransaction, confirmTransaction, executeTransaction,
  getPendingTransactions, getSafeInfo,
  encodeResolveMarket, encodePauseMarket, encodeDistributeFees,
} from '../lib/safe.js';

const MARKET_CATEGORIES = [
  { value: 'deportes', label: 'Deportes' },
  { value: 'politica', label: 'Politica' },
  { value: 'finanzas', label: 'Finanzas' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'mexico', label: 'Mexico' },
  { value: 'musica', label: 'Musica' },
];

function ProtocolSwitch({ mode, onToggle }) {
  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h3>Modo del protocolo</h3>
        <span className={`admin-badge ${mode === 'own' ? 'badge-own' : 'badge-poly'}`}>
          {mode === 'own' ? 'Protocolo propio' : 'Polymarket'}
        </span>
      </div>
      <p className="admin-desc">
        {mode === 'polymarket'
          ? 'Los mercados se enrutan a traves de Polymarket CLOB. Cambiar a protocolo propio para usar tus contratos en Arbitrum.'
          : 'Los mercados usan tus contratos AMM en Arbitrum. Cambiar a Polymarket para el modo agregador.'}
      </p>
      <div className="admin-switch-row">
        <span className={mode === 'polymarket' ? 'switch-label-active' : 'switch-label'}>Polymarket</span>
        <button
          className={`admin-toggle ${mode === 'own' ? 'toggle-on' : ''}`}
          onClick={onToggle}
          aria-label="Toggle protocol mode"
        >
          <span className="toggle-knob" />
        </button>
        <span className={mode === 'own' ? 'switch-label-active' : 'switch-label'}>Protocolo propio</span>
      </div>
    </div>
  );
}

function CreateMarketForm({ privyId, getAccessToken }) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState('deportes');
  const [endDate, setEndDate] = useState('');
  const [icon, setIcon] = useState('📰');
  const [options, setOptions] = useState([
    { label: 'Sí', pct: 50 },
    { label: 'No', pct: 50 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  function addOption() {
    if (options.length >= 6) return;
    setOptions(prev => [...prev, { label: '', pct: 0 }]);
  }
  function removeOption(idx) {
    if (options.length <= 2) return;
    setOptions(prev => prev.filter((_, i) => i !== idx));
  }
  function updateOption(idx, field, value) {
    setOptions(prev => prev.map((o, i) => i === idx ? { ...o, [field]: field === 'pct' ? Number(value) : value } : o));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!question.trim() || !endDate) return;
    const emptyLabel = options.some(o => !o.label.trim());
    if (emptyLabel) { setStatus({ type: 'error', msg: t('admin.optionsNeedName') }); return; }

    setSubmitting(true);
    setStatus(null);
    try {
      // Format deadline for display: "30 Jun 2026"
      const d = new Date(endDate);
      const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      const deadline = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;

      await createGeneratedMarket({
        privyId,
        title: question.trim(),
        category,
        icon,
        deadline,
        options: options.map(o => ({ label: o.label.trim(), pct: o.pct || 50 })),
        getAccessToken,
      });
      setStatus({ type: 'success', msg: `${t('admin.created')}` });
      setQuestion('');
      setEndDate('');
      setOptions([{ label: 'Sí', pct: 50 }, { label: 'No', pct: 50 }]);
    } catch (err) {
      setStatus({ type: 'error', msg: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h3>{t('admin.createMarket')}</h3>
      </div>
      <form onSubmit={handleSubmit} className="admin-form">
        <label>
          <span>{t('admin.question')}</span>
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder={t('admin.questionPh')}
            required
          />
        </label>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1 }}>
            <span>{t('admin.category')}</span>
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {MARKET_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>
          <label style={{ width: 70 }}>
            <span>{t('admin.icon')}</span>
            <input
              type="text"
              value={icon}
              onChange={e => setIcon(e.target.value)}
              style={{ textAlign: 'center', fontSize: 18 }}
            />
          </label>
        </div>
        <label>
          <span>{t('admin.closeDate')}</span>
          <input
            type="datetime-local"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            required
          />
        </label>

        {/* Dynamic options */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
              {t('admin.options')} ({options.length})
            </span>
            {options.length < 6 && (
              <button type="button" onClick={addOption} className="btn-admin-sm" style={{ fontSize: 11, padding: '4px 10px' }}>
                {t('admin.addOption')}
              </button>
            )}
          </div>
          {options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <input
                type="text"
                value={opt.label}
                onChange={e => updateOption(i, 'label', e.target.value)}
                placeholder={`${t('admin.optionPh')} ${i + 1}`}
                style={{ flex: 1, padding: '8px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                required
              />
              <input
                type="number"
                value={opt.pct}
                onChange={e => updateOption(i, 'pct', e.target.value)}
                min={0} max={100}
                style={{ width: 60, padding: '8px 6px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'center' }}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>%</span>
              {options.length > 2 && (
                <button type="button" onClick={() => removeOption(i)}
                  style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
                  title="Eliminar opción"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>

        <button type="submit" className="btn-admin-primary" disabled={submitting}>
          {submitting ? t('admin.creating') : t('admin.createBtn')}
        </button>
        {status && (
          <div className={`admin-status admin-status-${status.type}`}>
            {status.msg}
          </div>
        )}
      </form>
    </div>
  );
}

function ResolveModal({ market, onClose, onResolved, privyId, getAccessToken }) {
  const t = useT();
  const [outcome, setOutcome] = useState('');
  const [winner, setWinner] = useState('');
  const [winnerShort, setWinnerShort] = useState('');
  const [resolvedBy, setResolvedBy] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!market) return null;

  const options = market.options || [];

  async function handleSubmit(e) {
    e.preventDefault();
    if (!outcome || !winner) { setError(t('admin.selectOutcome')); return; }
    setSubmitting(true);
    setError(null);
    try {
      await resolveMarket(privyId, {
        marketId: market.id,
        outcome,
        winner,
        winnerShort: winnerShort || winner,
        resolvedBy: resolvedBy || 'Admin multisig',
        description,
        getAccessToken,
      });
      onResolved(market.id);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function selectOption(opt) {
    setOutcome(opt.label);
    setWinner(opt.label);
    setWinnerShort(opt.label.length > 20 ? opt.label.slice(0, 20) : opt.label);
  }

  return (
    <div style={{ position:'fixed',inset:0,zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.7)',backdropFilter:'blur(6px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'var(--surface1)',border:'1px solid var(--border)',borderRadius:16,padding:'32px 28px',width:'90%',maxWidth:480,boxShadow:'0 24px 80px rgba(0,0,0,0.5)' }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20 }}>
          <h3 style={{ fontFamily:'var(--font-display)',fontSize:24,letterSpacing:'0.03em',color:'var(--text-primary)' }}>{t('admin.resolveTitle')}</h3>
          <button onClick={onClose} style={{ background:'none',border:'none',color:'var(--text-muted)',fontSize:22,cursor:'pointer' }}>&times;</button>
        </div>

        <p style={{ fontSize:14,color:'var(--text-secondary)',marginBottom:20,lineHeight:1.5 }}>{market.title}</p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-muted)',letterSpacing:'0.1em',display:'block',marginBottom:8 }}>{t('admin.winnerOutcome')}</label>
            <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
              {options.map((opt, i) => (
                <button key={i} type="button" onClick={() => selectOption(opt)}
                  style={{
                    padding:'12px 16px',borderRadius:8,border:'1px solid',cursor:'pointer',textAlign:'left',
                    fontFamily:'var(--font-body)',fontSize:14,transition:'all 0.2s',
                    background: outcome === opt.label ? 'var(--green-dim)' : 'var(--surface2)',
                    borderColor: outcome === opt.label ? 'var(--green)' : 'var(--border)',
                    color: outcome === opt.label ? 'var(--green)' : 'var(--text-primary)',
                  }}>
                  <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                    <span>{outcome === opt.label ? '✓ ' : ''}{opt.label}</span>
                    <span style={{ fontFamily:'var(--font-mono)',fontSize:12,opacity:0.6 }}>{opt.pct}%</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom:12 }}>
            <label style={{ fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-muted)',letterSpacing:'0.1em',display:'block',marginBottom:4 }}>{t('admin.resolvedBy')}</label>
            <input type="text" value={resolvedBy} onChange={e => setResolvedBy(e.target.value)} placeholder="Ej: Resultados oficiales FIFA"
              style={{ width:'100%',background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 14px',color:'var(--text-primary)',fontFamily:'var(--font-body)',fontSize:13 }} />
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={{ fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-muted)',letterSpacing:'0.1em',display:'block',marginBottom:4 }}>{t('admin.descOptional')}</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Detalles adicionales sobre la resolución..."
              style={{ width:'100%',background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 14px',color:'var(--text-primary)',fontFamily:'var(--font-body)',fontSize:13,resize:'vertical' }} />
          </div>

          {error && <div style={{ color:'var(--red)',fontSize:13,marginBottom:12 }}>{error}</div>}

          <div style={{ display:'flex',gap:12 }}>
            <button type="button" onClick={onClose} style={{ flex:1,padding:'12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text-secondary)',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:14 }}>
              {t('admin.cancel')}
            </button>
            <button type="submit" disabled={submitting || !outcome} style={{ flex:1,padding:'12px',borderRadius:8,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontFamily:'var(--font-display)',fontSize:16,letterSpacing:'0.04em',opacity:(!outcome||submitting)?0.5:1 }}>
              {submitting ? t('admin.resolving') : t('admin.confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Status / sorting helpers ───────────────────────────────────────────────
// "Pending" resolutions are rows the auto-resolver inserts when a market's
// deadline has passed but no winner could be derived from Polymarket. They
// belong in the Closed tab, not the Resolved one — only rows with a real
// outcome are truly resolved.
function isPendingResolution(r) {
  return !!r && (r.outcome === 'pending' || r.winner === 'Pendiente de resolución');
}

function classifyMarket(market, resolution, approvedSet) {
  // Hardcoded markets can flag themselves as resolved with a baked-in winner
  // (e.g. the Marco Verde fight). Treat that as authoritative even when no
  // matching market_resolutions row exists yet.
  if (market?._resolved) return 'resolved';
  if (resolution && !isPendingResolution(resolution)) return 'resolved';
  if (resolution && isPendingResolution(resolution)) return 'closed';
  if (market?._polymarketClosed) return 'closed';
  if (isExpired(market)) return 'closed';
  // Unapproved Polymarket markets go to the Pending tab — they only move
  // to Open after an admin clicks Aprobar.
  const isPoly = market?._source === 'polymarket' && market?._polyId;
  if (isPoly && approvedSet && !approvedSet.has(polymarketApprovalKey(market))) return 'pending';
  return 'open';
}

// Sort by closure date, most recent first. Resolved markets prefer the
// `resolved_at` timestamp (when we marked them) over the market deadline
// because that's when they actually became resolved.
function closureSortKey(market, resolution) {
  if (resolution?.resolved_at) {
    const t = new Date(resolution.resolved_at).getTime();
    if (!isNaN(t)) return t;
  }
  const end = resolveEndDate(market);
  return end ? end.getTime() : 0;
}

// Pull the leading outcome from a Polymarket-fetched closed market so we can
// auto-record it as a resolution. We look at options[i].pct because gmNormalize
// already converts outcomePrices into percentages.
function pickPolymarketWinner(market) {
  const opts = Array.isArray(market?.options) ? market.options : [];
  if (opts.length === 0) return null;
  let bestIdx = -1;
  let bestPct = -1;
  for (let i = 0; i < opts.length; i++) {
    const pct = Number(opts[i]?.pct);
    if (Number.isFinite(pct) && pct > bestPct) { bestPct = pct; bestIdx = i; }
  }
  // Require a clear winner (≥97%) before claiming a resolution. Anything less
  // and we let the admin make the call manually.
  if (bestIdx === -1 || bestPct < 97) return null;
  return {
    label: opts[bestIdx].label,
    pct: bestPct,
    outcome: bestPct >= 99 ? 'confirmed' : 'settled',
  };
}

function hasSpanishOptions(row) {
  if (Array.isArray(row?.options_es)) return row.options_es.length > 0;
  if (typeof row?.options_es === 'string') return row.options_es.trim() && row.options_es !== 'null';
  return !!row?.options_es;
}

function needsSpanishTranslation(row) {
  if (!row) return true;
  if (row.status === 'rejected') return false;
  return !row.title_es || !hasSpanishOptions(row);
}

function MarketsList({ mode, privyId, getAccessToken }) {
  const t = useT();
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolutions, setResolutions] = useState([]);   // raw rows from API
  const [decisions, setDecisions] = useState([]);       // polymarket approved + rejected rows
  const [resolveTarget, setResolveTarget] = useState(null);
  const [tab, setTab] = useState('pending');             // pending | open | closed | resolved
  const [sourceFilter, setSourceFilter] = useState('all'); // all | local | polymarket
  const [autoResolveBusy, setAutoResolveBusy] = useState(false);
  const [autoResolveStatus, setAutoResolveStatus] = useState(null);
  const [approvalBusy, setApprovalBusy] = useState(null); // slug currently being approved/rejected/revoked
  const [translateStatus, setTranslateStatus] = useState(null); // { busy, translated, remaining }

  async function load() {
    setLoading(true);
    // Fetch every source the admin can possibly care about, in parallel:
    //   - hardcoded local markets (catalog backbone)
    //   - live OPEN Polymarket markets only (no closed ones — those belong
    //     in closed/resolved tabs only if they were already approved)
    //   - market_resolutions DB rows (the source of truth for "resolved")
    //   - polymarket_approved DB rows (both approved AND rejected so we can
    //     hide rejected markets from the queue)
    const [liveOpen, resos, decisionRows] = await Promise.all([
      gmFetchMarkets({ limit: 100 }).catch(() => []),
      fetchResolutions().catch(() => []),
      fetchAllPolymarketDecisions(privyId, getAccessToken).catch(() => []),
    ]);
    const local = MARKETS;

    // Dedupe by slug/id. Live data wins over hardcoded.
    const map = new Map();
    for (const m of local)     map.set(m.id, m);
    for (const m of liveOpen)  map.set(m.id, { ...map.get(m.id), ...m });

    const all = Array.from(map.values());
    setMarkets(all);
    setResolutions(resos);
    setDecisions(decisionRows);
    setLoading(false);

    // Auto-translate every Polymarket market we don't yet have a Spanish
    // cache for. The endpoint creates `pending` rows so the admin can see
    // EN + ES side-by-side without clicking anything. Approving later just
    // flips status from pending → approved (no extra translation cost).
    autoTranslateNewPolymarket(all, decisionRows);

    // Mirror Polymarket-resolved closures into market_resolutions so the
    // public site picks them up too. We only do this for closed entries that
    // aren't already in resolutions, and only when we can identify a clear
    // winner. Failures are logged but don't block the UI.
    autoMirrorPolymarketResolutions(all, resos, privyId);
  }

  async function autoTranslateNewPolymarket(allMarkets, currentDecisions) {
    if (!privyId) return;
    const decisionsBySlug = new Map((currentDecisions || []).map(d => [d.slug, d]));
    const polyMarkets = allMarkets
      .filter(m => {
        const slug = polymarketApprovalKey(m);
        return m._source === 'polymarket' && m._polyId && m.title && slug && needsSpanishTranslation(decisionsBySlug.get(slug));
      })
      .map(m => ({ slug: polymarketApprovalKey(m), title: m.title, options: m.options }));
    if (polyMarkets.length === 0) {
      setTranslateStatus(null);
      return;
    }
    setTranslateStatus({ busy: true, translated: 0, remaining: polyMarkets.length });

    // Drain the queue. The server caps each call at 20 to fit the function
    // timeout, so we loop until it reports nothing left or hits the safety
    // cap. Each call is a fresh DB scan, so already-cached slugs are skipped.
    let totalTranslated = 0;
    let safety = 8; // 8 × 20 = 160 markets max per page load
    while (safety-- > 0) {
      const result = await bulkTranslatePolymarket(privyId, polyMarkets, getAccessToken);
      if (!result?.ok) {
        setTranslateStatus({
          busy: false,
          translated: totalTranslated,
          remaining: 0,
          error: result?.error || 'No se pudo traducir. Revisa ANTHROPIC_API_KEY.',
        });
        break;
      }
      if (Array.isArray(result.rows) && result.rows.length > 0) {
        totalTranslated += result.rows.length;
        // Merge new pending rows into the decisions state.
        setDecisions(prev => {
          const map = new Map(prev.map(r => [r.slug, r]));
          for (const r of result.rows) map.set(r.slug, r);
          return Array.from(map.values());
        });
      }
      setTranslateStatus({
        busy: result.remaining > 0,
        translated: totalTranslated,
        remaining: result.remaining,
      });
      if (!result.rows?.length) break;
      if (!result.remaining) break;
    }
    setTranslateStatus(prev => prev ? { ...prev, busy: false } : null);
  }

  // Approve / reject / revoke a polymarket slug.
  // - Approve: triggers an Anthropic-powered Spanish translation server-side
  //   so the market can be rendered in es on pronos.io.
  // - Reject:  marks the slug as rejected so it disappears from the admin
  //   queue and won't reappear next time the live Gamma feed reloads.
  // - Revoke:  hard-deletes the decision row (un-approve).
  async function handleApprove(market) {
    if (!privyId) return;
    const slug = polymarketApprovalKey(market);
    setApprovalBusy(slug);
    try {
      // If we already have a cached translation (pending row), skip the
      // Anthropic call — the server keeps the existing title_es via COALESCE.
      const cached = decisions.find(d => d.slug === slug);
      const row = await approvePolymarketMarket(privyId, {
        slug,
        title: market.title,
        options: market.options,
        autoTranslate: needsSpanishTranslation(cached),
        getAccessToken,
      });
      setDecisions(prev => {
        const next = prev.filter(r => r.slug !== slug);
        next.unshift(row);
        return next;
      });
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setApprovalBusy(null);
    }
  }

  async function handleReject(market) {
    if (!privyId) return;
    const slug = polymarketApprovalKey(market);
    setApprovalBusy(slug);
    try {
      const row = await rejectPolymarketMarket(privyId, { slug, getAccessToken });
      // Persist the rejection AND drop it from the local markets list so the
      // user sees it disappear immediately.
      setDecisions(prev => {
        const next = prev.filter(r => r.slug !== slug);
        next.unshift(row);
        return next;
      });
      setMarkets(prev => prev.filter(m => polymarketApprovalKey(m) !== slug));
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setApprovalBusy(null);
    }
  }

  async function handleRevoke(slug) {
    if (!privyId) return;
    setApprovalBusy(slug);
    try {
      await unapprovePolymarketMarket(privyId, slug, getAccessToken);
      setDecisions(prev => prev.filter(r => r.slug !== slug));
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setApprovalBusy(null);
    }
  }

  async function autoMirrorPolymarketResolutions(allMarkets, resos, pid) {
    if (!pid) return;
    const resolvedIds = new Set(resos.filter(r => !isPendingResolution(r)).map(r => r.market_id));
    const candidates = allMarkets.filter(m =>
      m._polymarketClosed && !resolvedIds.has(m.id)
    );
    if (candidates.length === 0) return;

    const inserted = [];
    for (const cand of candidates) {
      const winner = pickPolymarketWinner(cand);
      if (!winner) continue;
      try {
        await resolveMarket(pid, {
          marketId: cand.id,
          outcome: winner.outcome,
          winner: winner.label,
          winnerShort: winner.label.length > 20 ? winner.label.slice(0, 20) : winner.label,
          resolvedBy: 'Polymarket UMA',
          description: `Resuelto automáticamente por Polymarket: "${winner.label}" ganó con ${winner.pct}%.`,
          getAccessToken,
        });
        inserted.push(cand.id);
      } catch (e) {
        // Most likely failure: a race against the cron inserting it first.
        // Silently ignore — fetchResolutions on next load will pick it up.
      }
    }
    if (inserted.length > 0) {
      // Refresh resolutions so the UI flips them into the Resolved tab.
      try {
        const fresh = await fetchResolutions();
        setResolutions(fresh);
      } catch (_) {}
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function handleResolved(_marketId) {
    // Reload resolutions so the new row shows up in the Resolved tab.
    fetchResolutions().then(setResolutions).catch(() => {});
  }

  async function runAutoResolveCron() {
    setAutoResolveBusy(true);
    setAutoResolveStatus(null);
    try {
      const res = await fetch('/api/cron/auto-resolve');
      const data = await res.json();
      if (data.ok) {
        setAutoResolveStatus({
          type: 'success',
          msg: `OK · ${data.resolved?.length || 0} resueltos · ${data.awaiting?.length || 0} cerrados pendientes`,
        });
        await load();
      } else {
        setAutoResolveStatus({ type: 'error', msg: data.error || 'Cron falló' });
      }
    } catch (e) {
      setAutoResolveStatus({ type: 'error', msg: e.message });
    } finally {
      setAutoResolveBusy(false);
    }
  }

  if (loading) return <div className="admin-card"><p>Cargando mercados...</p></div>;

  // Build a quick resolution lookup once.
  const resByMarket = Object.fromEntries(resolutions.map(r => [r.market_id, r]));

  // Split polymarket decisions into three buckets:
  //   - approved: visible on the public site
  //   - rejected: dropped from the admin queue entirely
  //   - pending : auto-translated but waiting for an approve/reject decision
  // The translation map lets the table render ES titles next to the EN
  // originals for any cached row, regardless of status.
  const approvedSet = new Set(decisions.filter(d => d.status === 'approved').map(d => d.slug));
  const rejectedSet = new Set(decisions.filter(d => d.status === 'rejected').map(d => d.slug));
  const translationMap = new Map();
  for (const d of decisions) {
    if (d.title_es) translationMap.set(d.slug, d);
  }

  // Annotate every market with its derived status + resolution row so we can
  // tab/filter/sort without re-running classify on every render. Rejected
  // polymarket slugs are dropped here so they never appear in any tab.
  const annotated = markets
    .filter(m => !rejectedSet.has(polymarketApprovalKey(m)))
    .map(m => {
      const r = resByMarket[m.id] || null;
      return { market: m, resolution: r, status: classifyMarket(m, r, approvedSet) };
    });

  // Tab + source filter
  const inTab = annotated.filter(({ status }) => status === tab);
  const filtered = inTab.filter(({ market: m }) => {
    if (sourceFilter === 'all') return true;
    const isPoly = m._source === 'polymarket' && m._polyId;
    if (sourceFilter === 'local') return !isPoly;
    if (sourceFilter === 'polymarket') return isPoly;
    return true;
  });

  // Sort by closure date — earliest first across every tab. For "open" that
  // means the next markets to expire surface first; for "closed/resolved" it
  // means the oldest entries appear first, so the newest results live at the
  // bottom of the list (chronological order, requested explicitly).
  filtered.sort((a, b) => {
    const ka = closureSortKey(a.market, a.resolution);
    const kb = closureSortKey(b.market, b.resolution);
    return ka - kb;
  });

  const tabCounts = {
    pending:  annotated.filter(a => a.status === 'pending').length,
    open:     annotated.filter(a => a.status === 'open').length,
    closed:   annotated.filter(a => a.status === 'closed').length,
    resolved: annotated.filter(a => a.status === 'resolved').length,
  };

  const sourceCounts = {
    all: inTab.length,
    polymarket: inTab.filter(({ market: m }) => m._source === 'polymarket' && m._polyId).length,
    local: inTab.filter(({ market: m }) => !(m._source === 'polymarket' && m._polyId)).length,
  };

  // pendingApprovalCount is now just tabCounts.pending — shown in the tab label.

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h3>{t('admin.markets')}</h3>
        <button
          onClick={runAutoResolveCron}
          disabled={autoResolveBusy}
          style={{
            padding: '6px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
            background: 'var(--surface2)', border: '1px solid var(--green)', color: 'var(--green)',
            borderRadius: 6, cursor: autoResolveBusy ? 'wait' : 'pointer',
          }}
        >
          {autoResolveBusy ? t('admin.running') : t('admin.autoResolve')}
        </button>
      </div>
      <p className="admin-desc" style={{ marginBottom: 14 }}>
        {t('admin.autoDesc')}
      </p>

      {autoResolveStatus && (
        <div className={`admin-status admin-status-${autoResolveStatus.type}`} style={{ marginBottom: 12 }}>
          {autoResolveStatus.msg}
        </div>
      )}

      {translateStatus && (translateStatus.busy || translateStatus.translated > 0 || translateStatus.error) && (
        <div
          style={{
            marginBottom: 12, padding: '8px 12px', borderRadius: 6,
            background: translateStatus.error ? 'rgba(248, 113, 113, 0.08)' : 'rgba(96, 165, 250, 0.08)',
            border: translateStatus.error ? '1px solid rgba(248, 113, 113, 0.3)' : '1px solid rgba(96, 165, 250, 0.3)',
            color: translateStatus.error ? '#f87171' : '#60a5fa',
            fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
          }}
        >
          {translateStatus.error
            ? `No se pudieron traducir mercados: ${translateStatus.error}`
            : translateStatus.busy
            ? `🌐 Traduciendo mercados al español… (${translateStatus.translated} listos${translateStatus.remaining ? `, ${translateStatus.remaining} pendientes` : ''})`
            : `✓ ${translateStatus.translated} mercado${translateStatus.translated === 1 ? '' : 's'} traducido${translateStatus.translated === 1 ? '' : 's'} al español`}
        </div>
      )}

      {/* Pending count is now in the tab label — no separate banner needed */}

      {/* ── Status tabs (open / closed / resolved) ─────────────────────── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'pending',  label: `${t('admin.pendingTab')} (${tabCounts.pending})` },
          { id: 'open',     label: `${t('admin.open')} (${tabCounts.open})` },
          { id: 'closed',   label: `${t('admin.closed')} (${tabCounts.closed})` },
          { id: 'resolved', label: `${t('admin.resolved')} (${tabCounts.resolved})` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
              color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: tab === t.id ? '2px solid var(--green)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Source filter — admins can flip between live Polymarket and local */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        {[
          { key: 'all',        label: `${t('admin.all')} (${sourceCounts.all})` },
          { key: 'polymarket', label: `Polymarket (${sourceCounts.polymarket})` },
          { key: 'local',      label: `${t('admin.local')} (${sourceCounts.local})` },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setSourceFilter(f.key)}
            className={`btn-admin-sm ${sourceFilter === f.key ? 'btn-admin-resolve' : ''}`}
            style={{ fontSize: 11 }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.market')}</th>
              <th>{t('admin.source')}</th>
              <th>{t('admin.category')}</th>
              <th>{t('admin.deadline')}</th>
              <th>{t('admin.status')}</th>
              <th>{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {t('admin.noMarkets')}
                </td>
              </tr>
            )}
            {filtered.map(({ market: m, resolution: r, status }, i) => {
              const isPoly = m._source === 'polymarket' && m._polyId;
              const polySlug = isPoly ? polymarketApprovalKey(m) : null;
              const statusBadge = (
                status === 'resolved' ? { cls: 'badge-resolved', label: t('detail.resolved') } :
                status === 'closed'   ? { cls: 'badge-closed',   label: t('detail.statusClosed') } :
                                        { cls: 'badge-active',   label: t('admin.active') }
              );
              const isApproved = isPoly && approvedSet.has(polySlug);
              const busy       = approvalBusy === polySlug;
              const cachedTr = isPoly ? translationMap.get(polySlug) : null;
              const titleEs  = cachedTr?.title_es || null;
              const titleEn  = m.title || m.question || '';
              return (
                <tr key={m.id || i}>
                  <td className="admin-market-title">
                    {titleEs ? (
                      <>
                        <div>{titleEs}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>
                          {titleEn}
                        </div>
                      </>
                    ) : (
                      titleEn
                    )}
                    {isPoly && !titleEs && translateStatus?.busy && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                        traduciendo…
                      </div>
                    )}
                    {status === 'resolved' && (() => {
                      const winner = r?.winner_short || r?.winner || m._winnerShort || m._winner;
                      const by     = r?.resolved_by || m._resolvedBy;
                      if (!winner) return null;
                      return (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--green)', marginTop: 4, letterSpacing: '0.04em' }}>
                          🏆 {winner}{by ? ` · ${by}` : ''}
                        </div>
                      );
                    })()}
                  </td>
                  <td>
                    <span className={`admin-badge ${isPoly ? 'badge-poly' : 'badge-own'}`}>
                      {isPoly ? 'Polymarket' : 'Local'}
                    </span>
                    {isPoly && (
                      <div style={{ marginTop: 4 }}>
                        <span
                          className={`admin-badge ${isApproved ? 'badge-resolved' : 'badge-closed'}`}
                          title={isApproved
                            ? 'Visible en pronos.io con título traducido'
                            : 'Oculto del público hasta que un admin lo apruebe'}
                          style={{ fontSize: 9, padding: '2px 6px', whiteSpace: 'nowrap' }}
                        >
                          {isApproved ? t('admin.approved') : t('admin.pending')}
                        </span>
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="admin-cat-badge">{m.category || '-'}</span>
                  </td>
                  <td style={{ fontFamily:'var(--font-mono)',fontSize:12,color:'var(--text-muted)',whiteSpace:'nowrap' }}>{m.deadline || '—'}</td>
                  <td>
                    <span className={`admin-badge ${statusBadge.cls}`}>{statusBadge.label}</span>
                  </td>
                  <td className="admin-actions">
                    {/* Three button states:
                          - Polymarket unapproved → [Aprobar] [Rechazar]
                          - Polymarket approved   → [Revocar] [Resolver]
                          - Local                 → [Resolver]
                        Resolved markets get nothing — they're done. */}
                    {status !== 'resolved' && isPoly && !isApproved && (
                      <>
                        <button
                          className="btn-admin-sm btn-admin-resolve"
                          disabled={busy}
                          onClick={() => handleApprove(m)}
                          title="Aprobar y traducir al español"
                        >
                          {busy ? t('admin.translating') : t('admin.approve')}
                        </button>
                        <button
                          className="btn-admin-sm btn-danger"
                          disabled={busy}
                          onClick={() => handleReject(m)}
                          title="Rechazar y ocultar del admin permanentemente"
                        >
                          {busy ? '…' : t('admin.reject')}
                        </button>
                      </>
                    )}
                    {status !== 'resolved' && isPoly && isApproved && (
                      <>
                        <button
                          className="btn-admin-sm"
                          disabled={busy}
                          onClick={() => handleRevoke(polySlug)}
                          title="Quitar del público"
                        >
                          {busy ? '…' : t('admin.revoke')}
                        </button>
                        <button
                          className="btn-admin-sm btn-admin-resolve"
                          onClick={() => setResolveTarget(m)}
                        >
                          {t('admin.resolve')}
                        </button>
                      </>
                    )}
                    {status !== 'resolved' && !isPoly && (
                      <button
                        className="btn-admin-sm btn-admin-resolve"
                        onClick={() => setResolveTarget(m)}
                      >
                        {t('admin.resolve')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {resolveTarget && (
        <ResolveModal
          market={resolveTarget}
          privyId={privyId}
          getAccessToken={getAccessToken}
          onClose={() => setResolveTarget(null)}
          onResolved={handleResolved}
        />
      )}
    </div>
  );
}

function ContractInfo({ mode }) {
  if (mode !== 'own') return null;
  const contracts = getContracts(421614);
  const shortAddress = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : 'Pendiente de deploy';

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h3>Contratos desplegados</h3>
        <span className="admin-badge badge-testnet">Arbitrum Sepolia</span>
      </div>
      <div className="admin-contracts">
        <div className="admin-contract-row">
          <span className="contract-label">MarketFactory</span>
          <span className="contract-addr">{shortAddress(contracts?.factory)}</span>
        </div>
        <div className="admin-contract-row">
          <span className="contract-label">PronosToken (ERC-1155)</span>
          <span className="contract-addr">{shortAddress(contracts?.token)}</span>
        </div>
        <div className="admin-contract-row">
          <span className="contract-label">USDC</span>
          <code className="contract-addr">{shortAddress(contracts?.usdc)}</code>
        </div>
      </div>
      <div className="admin-info-box">
        <strong>Safe Multisig:</strong> Pendiente de configuracion (3/5 admin, 2/3 resolucion)
      </div>
    </div>
  );
}

function FeeInfo({ mode }) {
  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h3>Comisiones</h3>
      </div>
      <div className="admin-fee-formula">
        <div className="fee-equation">fee = 2% fijo · antes del pool</div>
        <div className="fee-examples">
          <div className="fee-example">
            <span>50/50</span>
            <strong>2%</strong>
          </div>
          <div className="fee-example">
            <span>90/10</span>
            <strong>2%</strong>
          </div>
          <div className="fee-example">
            <span>99/1</span>
            <strong>2%</strong>
          </div>
        </div>
      </div>
      {mode === 'own' && (
        <div className="admin-fee-dist">
          <h4>Distribucion</h4>
          <div className="fee-dist-row"><span>Tesoreria</span><strong>70%</strong></div>
          <div className="fee-dist-row"><span>Reserva liquidez</span><strong>20%</strong></div>
          <div className="fee-dist-row"><span>Reserva emergencia</span><strong>10%</strong></div>
        </div>
      )}
    </div>
  );
}

function SafeManager({ mode }) {
  const { wallets } = useWallets();
  const [chainId, setChainId] = useState(421614); // default Arbitrum Sepolia
  const [safeAddrs, setSafeAddrs] = useState(getSafeAddresses(421614));
  const [pending, setPending] = useState([]);
  const [safeInfo, setSafeInfoState] = useState({ admin: null, resolver: null });
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState(null);
  const [newOwners, setNewOwners] = useState('');
  const [newThreshold, setNewThreshold] = useState(3);
  const [safeType, setSafeType] = useState('admin'); // 'admin' or 'resolver'

  // Load Safe info + pending txs
  useEffect(() => {
    async function load() {
      const addrs = getSafeAddresses(chainId);
      setSafeAddrs(addrs);
      try {
        if (addrs.admin) {
          const info = await getSafeInfo(chainId, addrs.admin);
          setSafeInfoState(prev => ({ ...prev, admin: info }));
          const txs = await getPendingTransactions(chainId, addrs.admin);
          setPending(txs);
        }
        if (addrs.resolver) {
          const info = await getSafeInfo(chainId, addrs.resolver);
          setSafeInfoState(prev => ({ ...prev, resolver: info }));
        }
      } catch (e) {
        // Safe might not exist yet on Transaction Service
      }
    }
    load();
  }, [chainId]);

  async function getProvider() {
    const wallet = wallets?.[0];
    if (!wallet) throw new Error('No wallet connected');
    return wallet.getEthereumProvider();
  }

  async function handleCreateSafe() {
    const owners = newOwners.split('\n').map(s => s.trim()).filter(Boolean);
    if (owners.length < newThreshold) {
      setStatus({ type: 'error', msg: `Necesitas al menos ${newThreshold} direcciones de owners` });
      return;
    }
    setCreating(true);
    setStatus({ type: 'info', msg: `Creando Safe ${safeType} (${newThreshold}/${owners.length})...` });
    try {
      const provider = await getProvider();
      const { safeAddress, txHash } = await createSafe(provider, owners, newThreshold);
      const current = getSafeAddresses(chainId);
      if (safeType === 'admin') {
        setSafeAddresses(chainId, safeAddress, current.resolver);
      } else {
        setSafeAddresses(chainId, current.admin, safeAddress);
      }
      setSafeAddrs(getSafeAddresses(chainId));
      setStatus({ type: 'success', msg: `Safe ${safeType} creado: ${safeAddress}` });
    } catch (e) {
      setStatus({ type: 'error', msg: `Error: ${e.message}` });
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirm(safeTxHash) {
    try {
      setStatus({ type: 'info', msg: 'Firmando transaccion...' });
      const provider = await getProvider();
      await confirmTransaction(provider, chainId, safeAddrs.admin, safeTxHash);
      setStatus({ type: 'success', msg: 'Firma agregada' });
      // Refresh pending
      const txs = await getPendingTransactions(chainId, safeAddrs.admin);
      setPending(txs);
    } catch (e) {
      setStatus({ type: 'error', msg: `Error: ${e.message}` });
    }
  }

  async function handleExecute(safeTxHash) {
    try {
      setStatus({ type: 'info', msg: 'Ejecutando transaccion...' });
      const provider = await getProvider();
      const { txHash } = await executeTransaction(provider, chainId, safeAddrs.admin, safeTxHash);
      setStatus({ type: 'success', msg: `Ejecutada! tx: ${txHash.slice(0, 10)}...` });
      const txs = await getPendingTransactions(chainId, safeAddrs.admin);
      setPending(txs);
    } catch (e) {
      setStatus({ type: 'error', msg: `Error: ${e.message}` });
    }
  }

  async function handleDistributeFees() {
    const contracts = getContracts(chainId);
    if (!contracts?.factory || !safeAddrs.admin) {
      setStatus({ type: 'error', msg: 'Configura direcciones de contratos y Safe primero' });
      return;
    }
    try {
      setStatus({ type: 'info', msg: 'Proponiendo distribucion de fees...' });
      const provider = await getProvider();
      const data = encodeDistributeFees();
      await proposeTransaction(provider, chainId, safeAddrs.admin, contracts.factory, data);
      setStatus({ type: 'success', msg: 'Transaccion propuesta — necesita firmas del multisig' });
      const txs = await getPendingTransactions(chainId, safeAddrs.admin);
      setPending(txs);
    } catch (e) {
      setStatus({ type: 'error', msg: `Error: ${e.message}` });
    }
  }

  const hasAdminSafe = !!safeAddrs.admin;
  const hasResolverSafe = !!safeAddrs.resolver;

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h3>Safe Multisig</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={chainId}
            onChange={e => setChainId(Number(e.target.value))}
            className="admin-select-sm"
          >
            <option value={421614}>Arbitrum Sepolia</option>
            <option value={42161}>Arbitrum One</option>
          </select>
        </div>
      </div>

      {/* Current Safes */}
      <div className="admin-contracts">
        <div className="admin-contract-row">
          <span className="contract-label">Admin Safe ({safeInfo.admin ? `${safeInfo.admin.threshold}/${safeInfo.admin.owners?.length}` : '—'})</span>
          <code className="contract-addr">
            {hasAdminSafe ? `${safeAddrs.admin.slice(0, 6)}...${safeAddrs.admin.slice(-4)}` : 'No configurado'}
          </code>
        </div>
        <div className="admin-contract-row">
          <span className="contract-label">Resolver Safe ({safeInfo.resolver ? `${safeInfo.resolver.threshold}/${safeInfo.resolver.owners?.length}` : '—'})</span>
          <code className="contract-addr">
            {hasResolverSafe ? `${safeAddrs.resolver.slice(0, 6)}...${safeAddrs.resolver.slice(-4)}` : 'No configurado'}
          </code>
        </div>
      </div>

      {/* Create Safe form */}
      {(!hasAdminSafe || !hasResolverSafe) && (
        <div className="admin-form" style={{ marginTop: 16 }}>
          <h4>Crear nuevo Safe</h4>
          <label>
            <span>Tipo</span>
            <select value={safeType} onChange={e => setSafeType(e.target.value)}>
              {!hasAdminSafe && <option value="admin">Admin (3/5)</option>}
              {!hasResolverSafe && <option value="resolver">Resolver (2/3)</option>}
            </select>
          </label>
          <label>
            <span>Threshold</span>
            <input
              type="number"
              value={newThreshold}
              onChange={e => setNewThreshold(Number(e.target.value))}
              min={1}
            />
          </label>
          <label>
            <span>Owners (una direccion por linea)</span>
            <textarea
              value={newOwners}
              onChange={e => setNewOwners(e.target.value)}
              rows={4}
              placeholder="0x1234...&#10;0x5678...&#10;0xabcd..."
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </label>
          <button
            className="btn-admin-primary"
            onClick={handleCreateSafe}
            disabled={creating}
          >
            {creating ? 'Creando...' : `Crear Safe ${safeType}`}
          </button>
        </div>
      )}

      {/* Manual Safe address input (for existing Safes) */}
      {(!hasAdminSafe || !hasResolverSafe) && (
        <div style={{ marginTop: 12, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>O conecta un Safe existente:</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!hasAdminSafe && (
              <input
                type="text"
                placeholder="Admin Safe address (0x...)"
                onBlur={e => {
                  const addr = e.target.value.trim();
                  if (addr && addr.startsWith('0x') && addr.length === 42) {
                    setSafeAddresses(chainId, addr, safeAddrs.resolver);
                    setSafeAddrs(getSafeAddresses(chainId));
                    setStatus({ type: 'success', msg: 'Admin Safe conectado' });
                  }
                }}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12, flex: 1, minWidth: 200 }}
              />
            )}
            {!hasResolverSafe && (
              <input
                type="text"
                placeholder="Resolver Safe address (0x...)"
                onBlur={e => {
                  const addr = e.target.value.trim();
                  if (addr && addr.startsWith('0x') && addr.length === 42) {
                    setSafeAddresses(chainId, safeAddrs.admin, addr);
                    setSafeAddrs(getSafeAddresses(chainId));
                    setStatus({ type: 'success', msg: 'Resolver Safe conectado' });
                  }
                }}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12, flex: 1, minWidth: 200 }}
              />
            )}
          </div>
        </div>
      )}

      {/* Quick actions */}
      {hasAdminSafe && mode === 'own' && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-admin-sm" onClick={handleDistributeFees}>
            Distribuir fees
          </button>
        </div>
      )}

      {/* Pending transactions */}
      {pending.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4>Transacciones pendientes ({pending.length})</h4>
          {pending.map(tx => (
            <div key={tx.safeTxHash} className="admin-contract-row" style={{ flexDirection: 'column', gap: 8, padding: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <code style={{ fontSize: 11 }}>
                  {tx.to?.slice(0, 10)}... | nonce {tx.nonce}
                </code>
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                  {tx.confirmations?.length || 0}/{tx.confirmationsRequired} firmas
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-admin-sm" onClick={() => handleConfirm(tx.safeTxHash)}>
                  Firmar
                </button>
                {(tx.confirmations?.length || 0) >= (tx.confirmationsRequired || 999) && (
                  <button className="btn-admin-sm btn-admin-resolve" onClick={() => handleExecute(tx.safeTxHash)}>
                    Ejecutar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {status && (
        <div className={`admin-status admin-status-${status.type}`} style={{ marginTop: 12 }}>
          {status.msg}
        </div>
      )}
    </div>
  );
}

// ── Generated Markets Review ───────────────────────────────────
function GeneratedMarketsReview({ privyId, getAccessToken }) {
  const [tab, setTab] = useState('pending');
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const needsAdmin = tab !== 'approved' && tab !== 'live';
      const rows = await fetchGeneratedMarkets(tab, needsAdmin ? privyId : undefined, getAccessToken);
      setMarkets(rows);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  async function act(id, action) {
    setBusyId(id);
    try {
      await updateGeneratedMarket({ privyId, id, action, getAccessToken });
      setMarkets(prev => prev.filter(m => m._dbId !== id));
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function runCronNow() {
    setLoading(true);
    try {
      const res = await fetch('/api/cron/generate-markets');
      const data = await res.json();
      if (data.ok) {
        alert(`Pipeline completado: ${data.inserted} nuevos mercados generados.`);
        load();
      } else {
        alert(data.reason || 'Pipeline no pudo correr. Revisa ANTHROPIC_API_KEY.');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  const tabs = [
    { id: 'pending',  label: 'Pendientes' },
    { id: 'approved', label: 'Aprobados' },
    { id: 'rejected', label: 'Rechazados' },
  ];

  return (
    <div className="admin-card" style={{ gridColumn: '1 / -1' }}>
      <div className="admin-card-header">
        <h3>Mercados generados por IA</h3>
        <button
          onClick={runCronNow}
          disabled={loading}
          style={{
            padding: '6px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
            background: 'var(--surface2)', border: '1px solid var(--green)', color: 'var(--green)',
            borderRadius: 6, cursor: loading ? 'wait' : 'pointer',
          }}
        >
          ▶ Ejecutar ahora
        </button>
      </div>
      <p className="admin-desc">
        Pipeline diario: RSS de noticias → Claude → mercados sugeridos. Requiere <code>ANTHROPIC_API_KEY</code> en Vercel.
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
              color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: tab === t.id ? '2px solid var(--green)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Cargando…</p>}
      {error && <p style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Error: {error}</p>}
      {!loading && markets.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '24px 0', textAlign: 'center' }}>
          No hay mercados {tab === 'pending' ? 'pendientes de revisión' : tab === 'approved' ? 'aprobados' : 'rechazados'}.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {markets.map(m => (
          <div
            key={m._dbId}
            style={{
              border: '1px solid var(--border)', borderRadius: 10, padding: 16,
              background: 'var(--surface1)', display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 24 }}>{m.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 4 }}>
                  {m.categoryLabel} · {(m._region || '').toUpperCase()} · {new Date(m._generatedAt).toLocaleDateString('es-MX')}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                  {m.title}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                  Cierra: {m.deadline || 'sin fecha'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(m.options || []).map((opt, i) => (
                <div key={i} style={{
                  padding: '6px 10px', borderRadius: 6,
                  background: i === 0 ? 'rgba(0,201,107,0.1)' : 'rgba(255,69,69,0.08)',
                  border: `1px solid ${i === 0 ? 'rgba(0,201,107,0.3)' : 'rgba(255,69,69,0.25)'}`,
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                }}>
                  <span style={{ color: i === 0 ? 'var(--yes)' : 'var(--red)' }}>{opt.label}: {opt.pct}%</span>
                </div>
              ))}
            </div>

            {m._reasoning && (
              <div style={{
                padding: '10px 12px', borderRadius: 6, background: 'var(--surface2)',
                fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
                borderLeft: '2px solid var(--green)',
              }}>
                <strong style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em' }}>RAZONAMIENTO · </strong>
                {m._reasoning}
              </div>
            )}

            {tab === 'pending' && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => act(m._dbId, 'reject')}
                  disabled={busyId === m._dbId}
                  className="btn-danger"
                  style={{ padding: '8px 14px', fontSize: 12 }}
                >
                  Rechazar
                </button>
                <button
                  onClick={() => act(m._dbId, 'approve')}
                  disabled={busyId === m._dbId}
                  className="btn-yes"
                  style={{ padding: '8px 14px', fontSize: 12 }}
                >
                  Aprobar
                </button>
              </div>
            )}
            {tab === 'approved' && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => act(m._dbId, 'reject')}
                  disabled={busyId === m._dbId}
                  className="btn-ghost"
                  style={{ padding: '8px 14px', fontSize: 12 }}
                >
                  Revertir
                </button>
              </div>
            )}
            {tab === 'rejected' && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => act(m._dbId, 'approve')}
                  disabled={busyId === m._dbId}
                  className="btn-ghost"
                  style={{ padding: '8px 14px', fontSize: 12 }}
                >
                  Restaurar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Admin({ username, userIsAdmin, loading }) {
  const { authenticated, ready, user, getAccessToken } = usePrivy();
  const [mode, setMode] = useState(getProtocolMode);
  const privyId = user?.id;

  const hasAccess = authenticated && isAdmin(userIsAdmin);

  function handleToggle() {
    const next = mode === 'polymarket' ? 'own' : 'polymarket';
    setProtocolMode(next);
    setMode(next);
  }

  // Wait for Privy + username fetch before deciding access
  if (!ready || loading) {
    return (
      <>
        <Nav />
        <div className="admin-page">
          <div className="admin-auth-wall">
            <p>Cargando...</p>
          </div>
        </div>
      </>
    );
  }

  if (!authenticated || !hasAccess) {
    // Don't reveal that this is an admin page — show 404-style message
    return (
      <>
        <Nav />
        <div className="admin-page">
          <div className="admin-auth-wall">
            <h2>Pagina no encontrada</h2>
            <p>La pagina que buscas no existe.</p>
            <a href="/mvp/" style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
              Volver al inicio
            </a>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Nav />
      <div className="admin-page">
        <div className="admin-header">
          <div className="admin-header-top">
            <h1>Panel de administracion</h1>
            <span className="admin-user-badge">{username}</span>
          </div>
          <p className="admin-subtitle">Gestiona mercados, protocolo y comisiones</p>
        </div>

        <div className="admin-grid">
          <ProtocolSwitch mode={mode} onToggle={handleToggle} />
          <SafeManager mode={mode} />
          <FeeInfo mode={mode} />
          <ContractInfo mode={mode} />
          <CreateMarketForm privyId={privyId} getAccessToken={getAccessToken} />
          <MarketsList mode={mode} privyId={privyId} getAccessToken={getAccessToken} />
          <GeneratedMarketsReview privyId={privyId} getAccessToken={getAccessToken} />
        </div>
      </div>
    </>
  );
}
