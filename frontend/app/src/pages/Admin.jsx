/**
 * MVP Admin — dedicated panel for on-chain (Turnkey-signed) markets.
 *
 * Sections:
 *   1. Generadores — trigger /admin/run-generators + /admin/run-auto-resolve
 *      with dry-run toggles. Same engines the Points admin uses; the MVP
 *      simply approves pending markets into `mode='onchain'` rows.
 *   2. Pendientes — candidate markets produced by generators. Each row
 *      gets an "Aprobar on-chain" form that collects the deployed
 *      contract address before POST-ing to /admin/pending-markets.
 *   3. Crear manual — CreateMarketForm with ammMode radio (unified |
 *      parallel binary), full chain-metadata fields, featured toggle.
 *   4. Mercados — list of mode='onchain' markets filtered by status
 *      tabs (All/Active/Pending/Resolved). Featured quick-toggle,
 *      Edit modal, Resolve prompt.
 *
 * All backend calls hit /api/points/admin/*; the `?mode=onchain` filter
 * keeps Points admin and MVP admin operating on disjoint slices of
 * the shared schema.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { useT } from '../lib/i18n.js';

const CATEGORIES = [
  { value: 'deportes', label: 'Deportes', icon: '⚽' },
  { value: 'politica', label: 'Política', icon: '🗳️' },
  { value: 'crypto',   label: 'Crypto',   icon: '₿'  },
  { value: 'finanzas', label: 'Finanzas', icon: '📈' },
  { value: 'mexico',   label: 'México',   icon: '🇲🇽' },
  { value: 'musica',   label: 'Música',   icon: '🎵' },
  { value: 'general',  label: 'General',  icon: '📊' },
];

const DEFAULT_CHAIN_ID = Number(import.meta.env.VITE_ONCHAIN_CHAIN_ID || 421614);

// Sport options (keys match market.sport written by generators) + league
// options per sport. Keep in lockstep with SPORT_TABS in CategoryPage.jsx.
const SPORT_OPTIONS = [
  { key: '',         label: '— ninguno —' },
  { key: 'soccer',   label: 'Soccer'      },
  { key: 'baseball', label: 'Béisbol'     },
  { key: 'nba',      label: 'NBA'         },
  { key: 'nfl',      label: 'NFL'         },
  { key: 'f1',       label: 'F1'          },
  { key: 'tennis',   label: 'Tenis'       },
  { key: 'golf',     label: 'Golf'        },
];

const LEAGUE_BY_SPORT = {
  soccer: [
    { key: '',               label: '— ninguna —'     },
    { key: 'uefa-cl',        label: 'Champions League'},
    { key: 'la-liga',        label: 'La Liga'         },
    { key: 'premier-league', label: 'Premier League'  },
    { key: 'serie-a',        label: 'Serie A'         },
    { key: 'bundesliga',     label: 'Bundesliga'      },
    { key: 'liga-mx',        label: 'Liga MX'         },
    { key: 'mls',            label: 'MLS'             },
  ],
  baseball: [
    { key: '',    label: '— ninguna —' },
    { key: 'mlb', label: 'MLB'         },
    { key: 'lmb', label: 'LMB'         },
  ],
};

// ── HTTP helpers ────────────────────────────────────────────────────────────
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

const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface2)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
};

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{
        display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
        letterSpacing: '0.1em', color: 'var(--text-muted)',
        marginBottom: 6, textTransform: 'uppercase',
      }}>
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function SectionHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
      <div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text-primary)', margin: 0, letterSpacing: '0.03em' }}>
          {title}
        </h2>
        {subtitle && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginTop: 4, letterSpacing: '0.04em' }}>
            {subtitle}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

function Notice({ notice }) {
  if (!notice) return null;
  const color = notice.type === 'success' ? 'rgba(0,232,122,0.08)' : 'rgba(255,69,69,0.08)';
  const border = notice.type === 'success' ? 'rgba(0,232,122,0.25)' : 'rgba(255,69,69,0.25)';
  const txt = notice.type === 'success' ? 'var(--green)' : 'var(--red)';
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 8, marginBottom: 12,
      background: color, border: `1px solid ${border}`,
      color: txt, fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre-wrap',
    }}>
      {notice.msg}
    </div>
  );
}

// ═══ Onchain wiring status panel ═══════════════════════════════════════════
// Pre-flight check on the auto-deploy plumbing. Hits
// /api/points/admin/onchain-status which probes env vars + factory.owner()
// + factory.collateral() + deployer balances and returns a list of
// warnings. Operator hits "Refrescar" after every Vercel env change /
// contract redeploy / deployer faucet to validate setup before trying
// the first auto-deploy.
function OnchainStatusPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { ok, data: body } = await getJson('/api/points/admin/onchain-status');
      if (!ok) throw new Error(body?.error || 'status_failed');
      setData(body);
    } catch (e) {
      setError(e?.message || 'status_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const greenChip = (ok) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 6,
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.06em',
    fontWeight: 700,
    background: ok ? 'rgba(0,232,122,0.12)' : 'rgba(255,69,69,0.12)',
    color: ok ? 'var(--green)' : 'var(--red)',
  });

  return (
    <section style={{
      padding: 20, border: '1px solid var(--border)', borderRadius: 14,
      background: 'var(--surface1)', marginBottom: 24,
    }}>
      <SectionHeader
        title="Estado del despliegue on-chain"
        subtitle="Verifica env vars, factory.owner() y saldos del deployer antes de intentar auto-deploy."
        right={
          <button onClick={load} className="btn-ghost" disabled={loading} style={{ fontSize: 11 }}>
            {loading ? '…' : 'Refrescar'}
          </button>
        }
      />

      {error && <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Error: {error}</div>}

      {data && (
        <>
          <div style={{ marginBottom: 14 }}>
            <span style={greenChip(data.ok)}>{data.ok ? 'TODO LISTO' : `${data.warnings?.length || 0} ALERTAS`}</span>
          </div>

          {/* Env vars block */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
              Env vars
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 18px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {[
                ['ONCHAIN_RPC_URL',                  data.env.rpc ? '✓' : '✕'],
                ['ONCHAIN_CHAIN_ID',                 data.env.chainId || '✕'],
                ['ONCHAIN_MARKET_FACTORY_ADDRESS',   data.env.factoryV1 ? short(data.env.factoryV1) : '✕'],
                ['ONCHAIN_MARKET_FACTORY_V2_ADDRESS', data.env.factoryV2 ? short(data.env.factoryV2) : '✕'],
                ['ONCHAIN_COLLATERAL_ADDRESS',       data.env.collateral ? short(data.env.collateral) : '✕'],
                ['ONCHAIN_DEPLOYER_SUBORG_ID',       data.env.deployerSuborgId ? '✓' : '✕'],
                ['ONCHAIN_DEPLOYER_ADDRESS',         data.env.deployerAddress ? short(data.env.deployerAddress) : '✕'],
                ['TURNKEY_POLICIES_ENABLED',         data.env.policiesEnabled ? '✓' : '✕'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: v === '✕' ? 'var(--red)' : 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Factories */}
          {[['V1 (binario)', data.v1], ['V2 (multi 2..8)', data.v2]].map(([label, f]) => f && (
            <div key={label} style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'var(--surface2)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                Factory {label}
              </div>
              {f.address ? (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                  <div>address: <span style={{ color: 'var(--text-primary)' }}>{f.address}</span></div>
                  <div>reachable: <span style={greenChip(f.reachable)}>{f.reachable ? 'SÍ' : 'NO'}</span></div>
                  {f.error && <div style={{ color: 'var(--red)' }}>error: {f.error}</div>}
                  {f.reachable && (
                    <>
                      <div>owner: {short(f.owner)} <span style={greenChip(f.deployerIsOwner)}>{f.deployerIsOwner ? '== deployer' : 'MISMATCH'}</span></div>
                      <div>collateral: {short(f.collateral)} <span style={greenChip(f.collateralMatches)}>{f.collateralMatches ? '== ENV' : 'MISMATCH'}</span></div>
                    </>
                  )}
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>address no configurado</div>
              )}
            </div>
          ))}

          {/* Deployer balances */}
          {data.deployer && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'var(--surface2)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                Saldos del deployer
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                <div>{short(data.deployer.address)}</div>
                <div>
                  ETH: <span style={{ color: data.deployer.ethBalanceEther > 0 ? 'var(--green)' : 'var(--red)' }}>
                    {data.deployer.ethBalanceEther.toFixed(6)}
                  </span>
                  {' '}<span style={greenChip(data.deployer.ethBalanceEther > 0)}>{data.deployer.ethBalanceEther > 0 ? 'OK' : 'NEEDS GAS'}</span>
                </div>
                {data.deployer.collateralBalanceUnits != null && (
                  <div>
                    {data.deployer.collateralSymbol || 'COLLATERAL'}: <span style={{ color: data.deployer.collateralBalanceUnits > 0 ? 'var(--green)' : 'var(--red)' }}>
                      {data.deployer.collateralBalanceUnits.toFixed(2)}
                    </span>
                    {' '}<span style={greenChip(data.deployer.collateralBalanceUnits > 0)}>{data.deployer.collateralBalanceUnits > 0 ? 'OK' : 'NEEDS FAUCET'}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Warnings */}
          {data.warnings?.length > 0 && (
            <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,69,69,0.06)', border: '1px solid rgba(255,69,69,0.25)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--red)', textTransform: 'uppercase', marginBottom: 6 }}>
                Por arreglar
              </div>
              <ul style={{ margin: 0, padding: '0 0 0 18px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function short(addr) {
  if (!addr) return '—';
  const s = String(addr);
  if (s.length < 14) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

// ═══ Generators / auto-resolve section ═════════════════════════════════════
function GeneratorsSection() {
  const [running, setRunning] = useState(null); // 'generate' | 'resolve' | null
  const [notice, setNotice]   = useState(null);
  const [lastResult, setLast] = useState(null);

  async function runGenerators({ dry }) {
    setRunning('generate');
    setNotice(null);
    try {
      const url = `/api/points/admin/run-generators${dry ? '?dry=1' : ''}`;
      const { ok, data } = await postJson(url, {});
      if (!ok) throw new Error(data?.error || 'generator_failed');
      setLast({ kind: 'generators', data });
      if (dry) {
        setNotice({ type: 'success', msg: `Preview: ${data.totalSpecs || 0} specs · ${data.elapsedMs}ms` });
      } else {
        setNotice({ type: 'success', msg: `Inserted ${data.inserted || 0} · updated ${data.updated || 0} · skipped ${data.skipped || 0}` });
      }
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'generator_failed' });
    } finally {
      setRunning(null);
    }
  }

  async function runAutoResolve({ dry }) {
    setRunning('resolve');
    setNotice(null);
    try {
      const url = `/api/points/admin/run-auto-resolve${dry ? '?dry=1' : ''}`;
      const { ok, data } = await postJson(url, {});
      if (!ok) throw new Error(data?.error || 'resolve_failed');
      setLast({ kind: 'resolve', data });
      const resolved = data?.resolved ?? data?.resolvedCount ?? '?';
      setNotice({ type: 'success', msg: dry ? `Preview: ${resolved} serían resueltos.` : `Resueltos: ${resolved}` });
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'resolve_failed' });
    } finally {
      setRunning(null);
    }
  }

  return (
    <section style={{
      padding: 20, border: '1px solid var(--border)', borderRadius: 14,
      background: 'var(--surface1)', marginBottom: 24,
    }}>
      <SectionHeader
        title="Generadores · auto-resolve"
        subtitle="Misma maquinaria que la cron de Points, disparable a mano."
      />

      <Notice notice={notice} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ padding: 14, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            Generar mercados
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 12px 0' }}>
            Scrapea las APIs configuradas (deportes, elecciones, crypto) y escribe candidatos en la cola de <strong>pendientes</strong>.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => runGenerators({ dry: true })}  disabled={running !== null} className="btn-ghost" style={{ flex: 1 }}>
              {running === 'generate' ? '…' : 'Preview'}
            </button>
            <button type="button" onClick={() => runGenerators({ dry: false })} disabled={running !== null} className="btn-primary" style={{ flex: 1 }}>
              {running === 'generate' ? '…' : 'Ejecutar'}
            </button>
          </div>
        </div>

        <div style={{ padding: 14, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            Auto-resolve
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 12px 0' }}>
            Cierra mercados vencidos usando el resolver configurado (Chainlink / UMA / manual).
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => runAutoResolve({ dry: true })}  disabled={running !== null} className="btn-ghost" style={{ flex: 1 }}>
              {running === 'resolve' ? '…' : 'Preview'}
            </button>
            <button type="button" onClick={() => runAutoResolve({ dry: false })} disabled={running !== null} className="btn-primary" style={{ flex: 1 }}>
              {running === 'resolve' ? '…' : 'Resolver'}
            </button>
          </div>
        </div>
      </div>

      {lastResult && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            Último resultado ({lastResult.kind})
          </summary>
          <pre style={{
            marginTop: 8, padding: 12, borderRadius: 8,
            background: 'var(--surface2)', border: '1px solid var(--border)',
            fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)',
            overflowX: 'auto', maxHeight: 280,
          }}>
            {JSON.stringify(lastResult.data, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}

// ═══ Pending-markets review ════════════════════════════════════════════════
function ApproveOnchainForm({ pendingId, onSuccess, onCancel }) {
  const [chainId, setChainId] = useState(String(DEFAULT_CHAIN_ID));
  const [chainAddress, setChainAddress] = useState('');
  const [chainMarketId, setChainMarketId] = useState('');
  const [note, setNote] = useState('');
  // Auto-deploy is the default — the whole point of the MVP admin
  // approving a generated pending row is to have it land on-chain
  // automatically. Manual paste is the fallback.
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const { ok, data } = await postJson('/api/points/admin/pending-markets', {
        id: pendingId,
        action: 'approve',
        note: note.trim() || null,
        mode: 'onchain',
        chainId: Number(chainId),
        // When auto-deploying, leave chainAddress / chainMarketId empty;
        // the backend calls MarketFactory(V1/V2) and fills them in.
        chainAddress: autoDeploy ? '' : chainAddress.trim(),
        chainMarketId: autoDeploy ? null : (chainMarketId.trim() || null),
        autoDeploy,
      });
      if (!ok) throw new Error(data?.error ? `${data.error}${data.detail ? ` · ${data.detail}` : ''}` : 'approve_failed');
      onSuccess?.(data);
    } catch (e) {
      setErr(e?.message || 'approve_failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{
      marginTop: 10, padding: 12, borderRadius: 10,
      border: '1px dashed var(--border)', background: 'var(--surface2)',
    }}>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: 10,
        fontFamily: 'var(--font-mono)', fontSize: 11,
        color: autoDeploy ? 'var(--green)' : 'var(--text-secondary)',
      }}>
        <input type="checkbox" checked={autoDeploy} onChange={e => setAutoDeploy(e.target.checked)} />
        Auto-desplegar contrato vía MarketFactory
      </label>

      {autoDeploy ? (
        <div style={{
          padding: '8px 10px', borderRadius: 6,
          background: 'rgba(0,232,122,0.06)', border: '1px solid rgba(0,232,122,0.22)',
          fontFamily: 'var(--font-mono)', fontSize: 10, lineHeight: 1.55,
          color: 'var(--text-secondary)', marginBottom: 10,
        }}>
          Backend llamará V1 (binario) o V2 (multi 2..8) según los outcomes
          del pending. Aprobará seed MXNB hacia el factory y guardará
          la dirección automáticamente.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 8 }}>
          <Field label="Chain ID">
            <input required type="number" min={1} value={chainId} onChange={e => setChainId(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Contract address">
            <input required pattern="0x[a-fA-F0-9]{40}" value={chainAddress} onChange={e => setChainAddress(e.target.value)} style={inputStyle} placeholder="0x…" />
          </Field>
          <Field label="Market ID (opcional)">
            <input value={chainMarketId} onChange={e => setChainMarketId(e.target.value)} style={inputStyle} placeholder="0 · 1 · …" />
          </Field>
        </div>
      )}

      {autoDeploy && (
        <Field label="Chain ID">
          <input required type="number" min={1} value={chainId} onChange={e => setChainId(e.target.value)} style={{ ...inputStyle, maxWidth: 160 }} />
        </Field>
      )}
      <Field label="Nota (opcional)">
        <input value={note} onChange={e => setNote(e.target.value)} style={inputStyle} placeholder="Contexto para el registro" />
      </Field>
      {err && (
        <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 8 }}>
          {err}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={submitting} className="btn-primary" style={{ flex: 1 }}>
          {submitting ? 'Aprobando…' : 'Aprobar on-chain'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">Cancelar</button>
      </div>
    </form>
  );
}

function PendingMarketsSection({ refreshKey, bumpRefresh }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { ok, data } = await getJson('/api/points/admin/pending-markets?status=pending');
      if (!ok) throw new Error(data?.error || 'list_failed');
      // API returns `pending`, not `markets` — Points admin uses the
      // right key, MVP was reading the wrong field which is why the
      // tab always rendered empty even after a successful generation.
      setRows(Array.isArray(data?.pending) ? data.pending : []);
    } catch (e) {
      setError(e?.message || 'list_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function handleReject(pid) {
    if (!window.confirm('¿Rechazar este mercado pendiente? No se puede deshacer.')) return;
    setRejectingId(pid);
    try {
      const { ok, data } = await postJson('/api/points/admin/pending-markets', { id: pid, action: 'reject' });
      if (!ok) throw new Error(data?.error || 'reject_failed');
      setNotice({ type: 'success', msg: `Pendiente ${pid} rechazado.` });
      // Drop the rejected row in place — same scroll-preservation
      // pattern as the approve handler.
      setRows(prev => prev.filter(row => row.id !== pid));
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'reject_failed' });
    } finally {
      setRejectingId(null);
    }
  }

  return (
    <section style={{
      padding: 20, border: '1px solid var(--border)', borderRadius: 14,
      background: 'var(--surface1)', marginBottom: 24,
    }}>
      <SectionHeader
        title={`Pendientes (${rows.length})`}
        subtitle="Candidatos de los generadores. Aprobar requiere una dirección on-chain."
        right={<button onClick={load} className="btn-ghost" style={{ fontSize: 11 }}>Refrescar</button>}
      />
      <Notice notice={notice} />

      {loading && <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</div>}
      {error && <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>Error: {error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: 14, textAlign: 'center' }}>
          Nada pendiente. Corre los generadores para crear candidatos.
        </div>
      )}

      {rows.map(r => (
        <div key={r.id} style={{
          padding: 12, border: '1px solid var(--border)', borderRadius: 10,
          background: 'var(--surface2)', marginBottom: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
                <span style={{ marginRight: 6 }}>{r.icon || '📈'}</span>
                {r.question}
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                <span>#{r.id}</span>
                <span>{(r.outcomes || []).length} outcomes · {r.ammMode || 'unified'}</span>
                <span>{r.category || 'general'}</span>
                {r.source && <span>src: {r.source}</span>}
                {r.endTime && <span>cierra {new Date(r.endTime).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {openId !== r.id && (
                <>
                  <button onClick={() => setOpenId(r.id)} className="btn-primary" style={{ fontSize: 11, padding: '6px 12px' }}>
                    Aprobar
                  </button>
                  <button onClick={() => handleReject(r.id)} disabled={rejectingId === r.id} className="btn-ghost" style={{ fontSize: 11, padding: '6px 12px' }}>
                    {rejectingId === r.id ? '…' : 'Rechazar'}
                  </button>
                </>
              )}
            </div>
          </div>
          {openId === r.id && (
            <ApproveOnchainForm
              pendingId={r.id}
              onSuccess={(data) => {
                setOpenId(null);
                const deployBit = data?.autoDeploy
                  ? ` · auto-deployed at ${String(data.autoDeploy.chainAddress || '').slice(0, 10)}…`
                  : '';
                setNotice({
                  type: 'success',
                  msg: `Pendiente ${r.id} aprobado on-chain.${deployBit}`,
                });
                // In-place removal instead of refetching the list, so
                // the page doesn't jump back to the top after each
                // approval. The approved row drops out of the pending
                // queue locally; bumpRefresh() lets the Mercados tab
                // pick up the new market on its next load.
                setRows(prev => prev.filter(row => row.id !== r.id));
                bumpRefresh();
              }}
              onCancel={() => setOpenId(null)}
            />
          )}
        </div>
      ))}
    </section>
  );
}

// ═══ Create-market form ═════════════════════════════════════════════════════
function CreateMarketForm({ onCreated }) {
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState('deportes');
  const [icon, setIcon] = useState('⚽');
  const [outcomes, setOutcomes] = useState(['Sí', 'No']);
  const [outcomeImages, setOutcomeImages] = useState(['', '']);
  const [endTime, setEndTime] = useState('');
  const [seed, setSeed] = useState('1000');
  const [ammMode, setAmmMode] = useState('unified');
  const [chainId, setChainId] = useState(String(DEFAULT_CHAIN_ID));
  const [chainAddress, setChainAddress] = useState('');
  const [chainMarketId, setChainMarketId] = useState('');
  const [featured, setFeatured] = useState(false);
  const [sport, setSport] = useState('');
  const [league, setLeague] = useState('');
  // Auto-deploy: when true, server calls MarketFactory itself + captures
  // the resulting address. When false, admin pastes the address manually
  // (for contracts deployed via Foundry/Hardhat/Remix outside Pronos).
  const [autoDeploy, setAutoDeploy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  // Keep outcomeImages aligned with outcomes[] — adding/removing an
  // outcome should add/remove its corresponding image slot.
  function updateOutcome(i, val) {
    setOutcomes(prev => prev.map((o, idx) => idx === i ? val : o));
  }
  function updateOutcomeImage(i, val) {
    setOutcomeImages(prev => prev.map((u, idx) => idx === i ? val : u));
  }
  function addOutcome() {
    setOutcomes(prev => prev.length < 10 ? [...prev, ''] : prev);
    setOutcomeImages(prev => prev.length < 10 ? [...prev, ''] : prev);
  }
  function removeOutcome(i) {
    setOutcomes(prev => prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev);
    setOutcomeImages(prev => prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev);
  }
  // Switching sport resets league — avoids "soccer → baseball with league=premier-league" bug.
  function changeSport(next) {
    setSport(next);
    setLeague('');
  }
  const leagueOptions = LEAGUE_BY_SPORT[sport] || null;

  async function handleSubmit(e) {
    e.preventDefault();
    setNotice(null);
    const trimmedOutcomes = outcomes.map(o => o.trim()).filter(Boolean);
    if (trimmedOutcomes.length < 2) {
      setNotice({ type: 'error', msg: 'Necesitas al menos 2 outcomes.' });
      return;
    }
    setSubmitting(true);
    try {
      // Only ship outcomeImages when at least one slot is filled — otherwise
      // the API rejects length mismatches even when every slot is empty.
      const trimmedImages = outcomeImages.slice(0, trimmedOutcomes.length).map(u => (u || '').trim());
      const hasAnyImage = trimmedImages.some(Boolean);

      const { ok, data } = await postJson('/api/points/admin/create-market', {
        question: question.trim(),
        category,
        icon,
        endTime,
        outcomes: trimmedOutcomes,
        seedLiquidity: Number(seed),
        ammMode,
        mode: 'onchain',
        chainId: Number(chainId),
        chainAddress: autoDeploy ? '' : chainAddress.trim(),
        chainMarketId: chainMarketId.trim() || null,
        featured,
        sport: sport || null,
        league: league || null,
        outcomeImages: hasAnyImage ? trimmedImages : null,
        autoDeploy,
      });
      if (!ok) throw new Error(data?.error ? `${data.error}${data.detail ? ` · ${data.detail}` : ''}` : 'create_failed');
      const deployBit = data.autoDeploy
        ? ` · auto-deployed at ${data.autoDeploy.chainAddress.slice(0, 10)}… (tx ${data.autoDeploy.txHash.slice(0, 10)}…)`
        : '';
      setNotice({ type: 'success', msg: `Mercado creado · id=${data.marketId} · ${data.ammMode}${deployBit}` });
      setQuestion('');
      setOutcomes(['Sí', 'No']);
      setOutcomeImages(['', '']);
      setChainAddress('');
      setChainMarketId('');
      setSport('');
      setLeague('');
      onCreated?.(data.marketId);
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'create_failed' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{
      padding: 20, border: '1px solid var(--border)', borderRadius: 14,
      background: 'var(--surface1)', marginBottom: 24,
    }}>
      <SectionHeader title="Registrar manualmente" subtitle="Crea un mercado on-chain apuntando a un contrato ya desplegado." />

      <Field label="Pregunta" hint="Debe resolver en una fecha clara.">
        <input type="text" required minLength={8} maxLength={200} value={question} onChange={e => setQuestion(e.target.value)} style={inputStyle} placeholder="¿México gana el partido inaugural del Mundial 2026?" />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Categoría">
          <select value={category} onChange={e => {
            const next = e.target.value;
            setCategory(next);
            const c = CATEGORIES.find(c => c.value === next);
            if (c) setIcon(c.icon);
            // Sport / league only make sense under 'deportes'. When the
            // user flips to any other category, scrub any sport state
            // they had picked so it isn't posted as ghost metadata.
            if (next !== 'deportes') {
              setSport('');
              setLeague('');
            }
          }} style={inputStyle}>
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Ícono (emoji)">
          <input type="text" value={icon} onChange={e => setIcon(e.target.value)} style={inputStyle} maxLength={4} />
        </Field>
      </div>

      {/* AMM mode radio */}
      <Field label="Modo AMM" hint="Unified: una sola pool con N outcomes. Parallel: un parent + N pools binarios (Sí/No).">
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { v: 'unified',  label: 'Unified (N-outcome)' },
            { v: 'parallel', label: 'Parallel binary (N pools Sí/No)' },
          ].map(opt => (
            <label key={opt.v} style={{
              flex: 1, padding: 10, borderRadius: 8,
              border: `1px solid ${ammMode === opt.v ? 'var(--green)' : 'var(--border)'}`,
              background: ammMode === opt.v ? 'rgba(0,232,122,0.06)' : 'var(--surface2)',
              fontFamily: 'var(--font-mono)', fontSize: 12,
              color: ammMode === opt.v ? 'var(--green)' : 'var(--text-primary)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, letterSpacing: '0.03em',
            }}>
              <input type="radio" name="ammMode" value={opt.v} checked={ammMode === opt.v} onChange={() => setAmmMode(opt.v)} />
              {opt.label}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Outcomes (2–10)" hint="Orden importa — el índice se usa al firmar trades on-chain. La imagen es opcional; ESPN badge / flag CDN / Cloudinary URLs funcionan.">
        {outcomes.map((o, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 6 }}>
            <input type="text" required value={o} onChange={e => updateOutcome(i, e.target.value)} placeholder={`Outcome ${i + 1}`} style={inputStyle} />
            <input type="url" value={outcomeImages[i] || ''} onChange={e => updateOutcomeImage(i, e.target.value)} placeholder="URL de imagen (opcional)" style={inputStyle} />
            {outcomes.length > 2 ? (
              <button type="button" onClick={() => removeOutcome(i)} style={{ padding: '6px 10px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>×</button>
            ) : (
              <div style={{ width: 36 }} />
            )}
          </div>
        ))}
        {outcomes.length < 10 && (
          <button type="button" onClick={addOutcome} style={{ padding: '6px 12px', borderRadius: 6, background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer', letterSpacing: '0.06em' }}>
            + agregar outcome
          </button>
        )}
      </Field>

      {/* Sport / league — only relevant when the category is "deportes".
          Hide the section entirely otherwise so the form doesn't pretend
          there's a sport sub-classification for crypto / política / etc.
          Also defensively clear stale state when category flips away from
          deportes so we never POST a sport with a non-deportes category. */}
      {category === 'deportes' && (
        <div style={{ display: 'grid', gridTemplateColumns: leagueOptions ? '1fr 1fr' : '1fr', gap: 14 }}>
          <Field label="Deporte (opcional)" hint="Alimenta los sub-tabs de /c/deportes (soccer · béisbol · NBA · …).">
            <select value={sport} onChange={e => changeSport(e.target.value)} style={inputStyle}>
              {SPORT_OPTIONS.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </Field>
          {leagueOptions && (
            <Field label="Liga" hint="Aparece en la barra lateral dentro de Deportes.">
              <select value={league} onChange={e => setLeague(e.target.value)} style={inputStyle}>
                {leagueOptions.map(l => (
                  <option key={l.key} value={l.key}>{l.label}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Fecha de cierre">
          <input type="datetime-local" required value={endTime} onChange={e => setEndTime(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Seed liquidity (display)" hint="Afecta sólo la UI; la liquidez real vive en el contract.">
          <input type="number" required min={100} value={seed} onChange={e => setSeed(e.target.value)} style={inputStyle} />
        </Field>
      </div>

      <div style={{ padding: 14, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', marginTop: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Metadatos on-chain
          </div>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: outcomes.length > 8 ? 'var(--text-muted)' : autoDeploy ? 'var(--green)' : 'var(--text-secondary)',
            cursor: outcomes.length > 8 ? 'not-allowed' : 'pointer',
          }}>
            <input
              type="checkbox"
              checked={autoDeploy && outcomes.length <= 8}
              disabled={outcomes.length > 8}
              onChange={e => setAutoDeploy(e.target.checked)}
            />
            Auto-desplegar contrato
            {outcomes.length > 8 && (
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>(máx 8 outcomes)</span>
            )}
          </label>
        </div>

        {autoDeploy && outcomes.length <= 8 ? (
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: 'rgba(0,232,122,0.06)', border: '1px solid rgba(0,232,122,0.25)',
            fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.55,
          }}>
            {outcomes.length === 2 ? (
              <>El backend llamará <code>MarketFactory.createMarket(...)</code> (V1 binario,
              <code> PronosAMM</code>).</>
            ) : (
              <>El backend llamará <code>MarketFactoryV2.createMarket(...)</code> (V2 multi,
              <code> PronosAMMMulti</code>) con los <strong>{outcomes.length} outcomes</strong> que
              definiste arriba.</>
            )}
            {' '}Aprobará el seed MXNB hacia el factory y guardará la dirección del nuevo pool
            automáticamente.
            <br /><br />
            <strong style={{ color: 'var(--green)' }}>Requisitos:</strong> el wallet del deployer
            (<code>ONCHAIN_DEPLOYER_ADDRESS</code>) tiene que ser el <code>owner()</code> del factory
            correspondiente {outcomes.length >= 3 && (<>(<code>ONCHAIN_MARKET_FACTORY_V2_ADDRESS</code>)</>)}
            {' '}y tener saldo MXNB suficiente para el seed.
            <br /><br />
            <Field label="Chain ID" hint="421614 = Arbitrum Sepolia">
              <input type="number" required min={1} value={chainId} onChange={e => setChainId(e.target.value)} style={inputStyle} />
            </Field>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 10 }}>
            <Field label="Chain ID" hint="421614 = Arbitrum Sepolia">
              <input type="number" required min={1} value={chainId} onChange={e => setChainId(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Contract address" hint="AMM ya desplegada (Foundry/Hardhat/Remix)">
              <input type="text" required pattern="0x[a-fA-F0-9]{40}" value={chainAddress} onChange={e => setChainAddress(e.target.value)} style={inputStyle} placeholder="0x…" />
            </Field>
            <Field label="Market ID (opcional)" hint="Índice dentro del contract.">
              <input type="text" value={chainMarketId} onChange={e => setChainMarketId(e.target.value)} style={inputStyle} placeholder="0 · 1 · …" />
            </Field>
          </div>
        )}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', marginTop: 6, marginBottom: 14, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} />
        Mostrar como destacado en el hero del /mvp.
      </label>

      <Notice notice={notice} />

      <button type="submit" className="btn-primary" disabled={submitting} style={{ width: '100%' }}>
        {submitting ? 'Creando…' : 'Registrar mercado'}
      </button>
    </form>
  );
}

// ═══ Edit-market modal ═════════════════════════════════════════════════════
function EditMarketModal({ market, onClose, onSaved }) {
  const [question, setQuestion] = useState(market.question || '');
  const [category, setCategory] = useState(market.category || 'general');
  const [endTime, setEndTime] = useState(
    market.endTime ? new Date(market.endTime).toISOString().slice(0, 16) : '',
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const { ok, data } = await postJson('/api/points/admin/edit-market', {
        marketId: market.id,
        question: question.trim(),
        category,
        endTime,
      });
      if (!ok) throw new Error(data?.error ? `${data.error}${data.detail ? ` · ${data.detail}` : ''}` : 'edit_failed');
      onSaved?.(data);
    } catch (e) {
      setErr(e?.message || 'edit_failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, padding: 24,
    }}>
      <form onSubmit={handleSubmit} style={{
        width: '100%', maxWidth: 560, padding: 20,
        borderRadius: 14, background: 'var(--surface1)', border: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0, color: 'var(--text-primary)' }}>
            Editar mercado #{market.id}
          </h3>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        <Field label="Pregunta">
          <input type="text" required minLength={8} maxLength={500} value={question} onChange={e => setQuestion(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Categoría">
          <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Fecha de cierre">
          <input type="datetime-local" required value={endTime} onChange={e => setEndTime(e.target.value)} style={inputStyle} />
        </Field>

        {err && (
          <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: 'rgba(255,69,69,0.08)', border: '1px solid rgba(255,69,69,0.25)', color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={saving} className="btn-primary" style={{ flex: 1 }}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
        </div>
      </form>
    </div>
  );
}

// ═══ Markets list with tabs + edit/featured/resolve ═════════════════════════
const STATUS_TABS = [
  { value: 'all',      label: 'Todos'        },
  { value: 'active',   label: 'Activos'      },
  { value: 'pending',  label: 'Por resolver' },
  { value: 'resolved', label: 'Resueltos'    },
  { value: 'archived', label: 'Archivados'   },
];

function MarketsList({ refreshKey, bumpRefresh }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('active');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [featuringId, setFeaturingId] = useState(null);
  const [archivingId, setArchivingId] = useState(null);
  const [bulkArchiving, setBulkArchiving] = useState(false);
  const [editingMarket, setEditingMarket] = useState(null);
  const [notice, setNotice] = useState(null);

  async function handleBulkArchivePoints() {
    const confirmMsg =
      'Archivar TODOS los mercados off-chain (mode=points + legacy NULL).\n\n' +
      '· Se ocultan de las listas públicas y de admin\n' +
      '· Se mantienen en la base para historial de trades\n' +
      '· Solo afecta a mercados off-chain — los onchain no se tocan\n\n' +
      '¿Continuar?';
    if (!window.confirm(confirmMsg)) return;
    setBulkArchiving(true);
    setNotice(null);
    try {
      const { ok, data } = await postJson('/api/points/admin/bulk-archive', {
        mode: 'points',
        includeNullMode: true,
      });
      if (!ok) throw new Error(data?.error || 'bulk_archive_failed');
      setNotice({
        type: 'success',
        msg: `Archivados ${data.archivedCount} mercados off-chain.`,
      });
      load();
      bumpRefresh();
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'bulk_archive_failed' });
    } finally {
      setBulkArchiving(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { ok, data } = await getJson(
        `/api/points/admin/markets?status=${filter}&mode=onchain&chain_id=${DEFAULT_CHAIN_ID}`,
      );
      if (!ok) throw new Error(data?.error || 'list_failed');
      setRows(Array.isArray(data?.markets) ? data.markets : []);
    } catch (e) {
      setError(e?.message || 'list_failed');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function handleResolve(market) {
    const input = window.prompt(
      `Índice del outcome ganador para "${market.question}":\n\n` +
      market.outcomes.map((o, i) => `  ${i}: ${o}`).join('\n'),
    );
    if (input === null) return;
    const idx = Number.parseInt(input, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= market.outcomes.length) {
      alert('Índice inválido.');
      return;
    }
    // Second prompt: free-form score / result line rendered under the
    // question on resolved cards + detail pages. Empty → NULL, skipped
    // gracefully. Cap enforced server-side at 240 chars.
    const scoreInput = window.prompt(
      `Resultado / marcador (opcional):\n\n` +
      `Ejemplos: "México 3-2 Brasil", "112-108", "1. Verstappen · 2. Norris · 3. Sainz"`,
      market.finalScore || '',
    );
    const finalScore = scoreInput === null ? null : scoreInput.trim() || null;

    setResolvingId(market.id);
    setNotice(null);
    try {
      const { ok, data } = await postJson('/api/points/admin/resolve-market', {
        marketId: market.id,
        winningOutcomeIndex: idx,
        finalScore,
      });
      if (!ok) {
        const parts = [data?.error || 'resolve_failed'];
        if (data?.detail) parts.push(data.detail);
        if (data?.code)   parts.push(`pg:${data.code}`);
        throw new Error(parts.join(' · '));
      }
      setNotice({ type: 'success', msg: `Resuelto: ${market.outcomes[idx]}${finalScore ? ` · ${finalScore}` : ''}` });
      // In-place row patch instead of full load() so the page doesn't
      // jump back to the top mid-scroll. The row reflects the new
      // status / outcome / finalScore immediately. bumpRefresh() still
      // fires so peer components (stats, mercados-on-chain count) can
      // refresh in their own time.
      setRows(prev => prev.map(m => m.id === market.id ? {
        ...m,
        status: 'resolved',
        outcome: idx,
        finalScore: finalScore ?? m.finalScore ?? null,
        resolvedAt: new Date().toISOString(),
      } : m));
      bumpRefresh();
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'resolve_failed' });
    } finally {
      setResolvingId(null);
    }
  }

  async function handleToggleFeatured(market) {
    setFeaturingId(market.id);
    const nextFeatured = !market.featured;
    setRows(prev => prev.map(m => m.id === market.id ? { ...m, featured: nextFeatured } : m));
    try {
      const { ok, data } = await postJson('/api/points/admin/toggle-featured', {
        marketId: market.id,
        featured: nextFeatured,
      });
      if (!ok) throw new Error(data?.error || 'toggle_failed');
    } catch (e) {
      // Rollback optimistic update
      setRows(prev => prev.map(m => m.id === market.id ? { ...m, featured: !nextFeatured } : m));
      setNotice({ type: 'error', msg: e?.message || 'toggle_failed' });
    } finally {
      setFeaturingId(null);
    }
  }

  async function handleArchive(market) {
    const archiving = !market.archivedAt;
    const verb = archiving ? 'archivar' : 'restaurar';
    if (!window.confirm(`¿${archiving ? 'Archivar' : 'Restaurar'} "${market.question}"?${archiving ? '\n\nSe ocultará en /mvp pero se mantendrá en la base para historial.' : ''}`)) {
      return;
    }
    setArchivingId(market.id);
    setNotice(null);
    try {
      const { ok, data } = await postJson('/api/points/admin/archive-market', {
        marketId: market.id,
        archive: archiving,
      });
      if (!ok) throw new Error(data?.error || `${verb}_failed`);
      setNotice({ type: 'success', msg: archiving ? 'Mercado archivado.' : 'Mercado restaurado.' });
      load();
      bumpRefresh();
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || `${verb}_failed` });
    } finally {
      setArchivingId(null);
    }
  }

  const visible = useMemo(() => rows, [rows]);

  return (
    <section style={{
      padding: 20, border: '1px solid var(--border)', borderRadius: 14,
      background: 'var(--surface1)', marginBottom: 24,
    }}>
      <SectionHeader
        title={`Mercados on-chain (${rows.length})`}
        subtitle="mode='onchain'. Filtros + edit + featured + resolve."
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={load} className="btn-ghost" style={{ fontSize: 11 }}>Refrescar</button>
            <button
              onClick={handleBulkArchivePoints}
              disabled={bulkArchiving}
              className="btn-ghost"
              title="Archiva todos los mercados off-chain (mode=points + legacy NULL). No toca los on-chain."
              style={{
                fontSize: 11,
                color: 'var(--red)',
                borderColor: 'rgba(255,69,69,0.25)',
              }}
            >
              {bulkArchiving ? '…' : 'Archivar legacy'}
            </button>
          </div>
        }
      />

      {/* Status tabs */}
      <div style={{
        display: 'flex', gap: 2, marginBottom: 14,
        borderBottom: '1px solid var(--border)',
      }}>
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            style={{
              background: 'transparent', border: 'none',
              padding: '8px 14px',
              color: filter === tab.value ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: filter === tab.value ? '2px solid var(--green)' : '2px solid transparent',
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
              textTransform: 'uppercase', cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Notice notice={notice} />

      {loading && <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</div>}
      {error && <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>Error: {error}</div>}
      {!loading && !error && visible.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: 14 }}>
          No hay mercados on-chain en esta categoría.
        </div>
      )}

      {visible.map(m => (
        <div key={m.id} style={{
          padding: 12, border: '1px solid var(--border)', borderRadius: 10,
          background: 'var(--surface2)', marginBottom: 8,
          display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
              <span style={{ marginRight: 6 }}>{m.icon || '📈'}</span>
              {m.question}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
              <span>#{m.id}</span>
              <span>{m.ammMode}</span>
              <span>{(m.outcomes || []).length} outcomes</span>
              <span style={{
                color: m.archivedAt ? 'var(--text-muted)'
                       : m.status === 'active' ? 'var(--green)'
                       : m.status === 'resolved' ? 'var(--gold)' : 'var(--text-muted)',
              }}>
                {m.archivedAt ? '📦 ARCHIVADO'
                  : m.status === 'active' ? 'ACTIVO'
                  : m.status === 'resolved' ? `✓ ${m.outcomes?.[m.outcome ?? 0] || 'resuelto'}`
                  : m.status}
              </span>
              <span>{m.tradeCount || 0} trades</span>
              {m.sport && <span>{m.sport}{m.league ? ` · ${m.league}` : ''}</span>}
              {m.chainId && <span>chain {m.chainId}</span>}
              {m.chainAddress && <span>{m.chainAddress.slice(0, 6)}…{m.chainAddress.slice(-4)}</span>}
              {m.endTime && <span>cierra {new Date(m.endTime).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={() => handleToggleFeatured(m)}
              disabled={featuringId === m.id}
              title={m.featured ? 'Quitar destacado' : 'Marcar como destacado'}
              style={{
                fontSize: 14, cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 6, padding: '4px 8px',
                color: m.featured ? '#FF5500' : 'var(--text-muted)',
                minWidth: 36,
              }}
            >
              {m.featured ? '🔥' : '☆'}
            </button>
            <button onClick={() => setEditingMarket(m)} className="btn-ghost" style={{ fontSize: 11, padding: '6px 10px' }}>
              Editar
            </button>
            {m.status === 'active' && !m.archivedAt && (
              <button onClick={() => handleResolve(m)} disabled={resolvingId === m.id} className="btn-ghost" style={{ fontSize: 11, padding: '6px 10px' }}>
                {resolvingId === m.id ? '…' : 'Resolver'}
              </button>
            )}
            <button
              onClick={() => handleArchive(m)}
              disabled={archivingId === m.id}
              className="btn-ghost"
              style={{
                fontSize: 11, padding: '6px 10px',
                color: m.archivedAt ? 'var(--green)' : 'var(--red)',
                borderColor: m.archivedAt ? 'rgba(0,232,122,0.3)' : 'rgba(255,69,69,0.25)',
              }}
            >
              {archivingId === m.id ? '…' : m.archivedAt ? 'Restaurar' : 'Archivar'}
            </button>
          </div>
        </div>
      ))}

      {editingMarket && (
        <EditMarketModal
          market={editingMarket}
          onClose={() => setEditingMarket(null)}
          onSaved={() => {
            setEditingMarket(null);
            setNotice({ type: 'success', msg: 'Cambios guardados.' });
            load();
          }}
        />
      )}
    </section>
  );
}

// ═══ Social tasks queue ═════════════════════════════════════════════════════
function SocialTasksSection() {
  const [status, setStatus] = useState('pending');
  const [tasks, setTasks] = useState(null);
  const [working, setWorking] = useState(null);

  const load = useCallback(async () => {
    setTasks(null);
    try {
      const { ok, data } = await getJson(`/api/points/admin/social-tasks?status=${status}`);
      setTasks(ok && Array.isArray(data?.tasks) ? data.tasks : []);
    } catch {
      setTasks([]);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function review(id, action) {
    let note = null;
    if (action === 'reject') {
      note = window.prompt('Motivo del rechazo (mostrado al usuario):');
      if (!note || !note.trim()) return;
    }
    setWorking(id);
    try {
      const { ok, data } = await postJson('/api/points/admin/social-tasks', { id, action, note });
      if (!ok) throw new Error(data?.error || 'review_failed');
      await load();
    } catch (e) {
      alert(`No se pudo ${action === 'approve' ? 'aprobar' : 'rechazar'}: ${e?.message || 'error'}`);
    } finally {
      setWorking(null);
    }
  }

  return (
    <section style={{
      padding: 20, border: '1px solid var(--border)', borderRadius: 14,
      background: 'var(--surface1)',
    }}>
      <SectionHeader
        title="Tareas sociales"
        subtitle="Pruebas FOLLOW enviadas por usuarios. Aprobar acredita la recompensa registrada (pero sin MXNP real hasta mainnet)."
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['pending', 'approved', 'rejected'].map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{
              padding: '6px 14px', borderRadius: 16,
              border: `1px solid ${status === s ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
              background: status === s ? 'rgba(0,232,122,0.1)' : 'transparent',
              color: status === s ? 'var(--green)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}
          >
            {s === 'pending' ? 'Pendientes' : s === 'approved' ? 'Aprobadas' : 'Rechazadas'}
          </button>
        ))}
      </div>

      {tasks === null && <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</p>}
      {tasks && tasks.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Sin tareas en esta categoría.</p>
      )}
      {tasks && tasks.map(t => (
        <div key={t.id} style={{
          background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '14px 18px', marginBottom: 10,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              #{t.id} · @{t.username} · {t.task_key} · +{t.reward} MXNP
            </div>
            {t.proof_url && (
              <a href={t.proof_url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)', textDecoration: 'underline' }}>
                Ver prueba ↗
              </a>
            )}
            {t.rejection_note && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
                Rechazo: {t.rejection_note}
              </div>
            )}
          </div>
          {t.status === 'pending' ? (
            <>
              <button onClick={() => review(t.id, 'approve')} disabled={working === t.id} className="btn-primary" style={{ padding: '6px 12px', fontSize: 11 }}>
                Aprobar
              </button>
              <button onClick={() => review(t.id, 'reject')} disabled={working === t.id} className="btn-ghost" style={{ padding: '6px 12px', fontSize: 11 }}>
                Rechazar
              </button>
            </>
          ) : (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
              Revisada por @{t.reviewer} · {t.reviewed_at ? new Date(t.reviewed_at).toLocaleDateString('es-MX') : ''}
            </span>
          )}
        </div>
      ))}
    </section>
  );
}

// ═══ Stats dashboard ═══════════════════════════════════════════════════════
function StatCard({ label, value }) {
  return (
    <div style={{
      padding: 16, borderRadius: 12,
      background: 'var(--surface2)', border: '1px solid var(--border)',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
        color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
        {value}
      </div>
    </div>
  );
}

function StatsSection() {
  const { user } = usePointsAuth();
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { ok, data } = await getJson('/api/points/admin/stats');
        if (!ok) throw new Error(data?.error || 'stats_failed');
        setStats(data);
      } catch (e) {
        setErr(e?.message || 'stats_failed');
      }
    })();
  }, []);

  if (err) return (
    <section style={{ padding: 20, border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface1)' }}>
      <SectionHeader title="Estadísticas" />
      <p style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>Error: {err}</p>
    </section>
  );
  if (!stats) return (
    <section style={{ padding: 20, border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface1)' }}>
      <SectionHeader title="Estadísticas" />
      <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</p>
    </section>
  );

  return (
    <section style={{
      padding: 20, border: '1px solid var(--border)', borderRadius: 14,
      background: 'var(--surface1)',
    }}>
      <SectionHeader
        title="Estadísticas"
        subtitle="Totales acumulados del backend compartido. Puntos + on-chain combinados."
      />

      {user?.username && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', background: 'var(--surface2)',
          border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16,
          fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)',
        }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 8px var(--green)' }} />
          Sesión admin: <strong style={{ color: 'var(--text-primary)' }}>@{user.username}</strong>
          {user.balance != null && (
            <span style={{ marginLeft: 'auto', color: 'var(--green)' }}>
              {Number(user.balance).toLocaleString('es-MX')} MXNP
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard label="Usuarios" value={Number(stats.users || 0).toLocaleString('es-MX')} />
        <StatCard label="MXNP en circulación" value={`${Number(stats.totalSupply || 0).toLocaleString('es-MX')} MXNP`} />
        <StatCard label="Mercados (activos / total)" value={`${stats.markets?.active ?? 0} / ${stats.markets?.total ?? 0}`} />
      </div>

      <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>
          Distribuciones (últimos 7 días)
        </div>
        {(stats.recentDistributions || []).length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            Sin actividad reciente.
          </p>
        )}
        {(stats.recentDistributions || []).map(d => (
          <div key={d.kind} style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '6px 0', borderBottom: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)', fontSize: 12,
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>{d.kind}</span>
            <span style={{ color: d.total >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
              {d.total >= 0 ? '+' : ''}{Number(d.total).toLocaleString('es-MX')} MXNP ({d.count})
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ═══ Page shell ═════════════════════════════════════════════════════════════
const ADMIN_TABS = [
  { id: 'create',   label: 'Crear mercado'   },
  { id: 'generate', label: 'Generar'         },
  { id: 'pending',  label: 'Por aprobar'     },
  { id: 'markets',  label: 'Mercados'        },
  { id: 'social',   label: 'Tareas sociales' },
  { id: 'stats',    label: 'Estadísticas'    },
];

export default function Admin({ username, userIsAdmin, loading, onOpenLogin }) {
  const t = useT();
  const { authenticated } = usePointsAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey(k => k + 1);
  const [tab, setTab] = useState('create');

  const body = useMemo(() => {
    if (loading) return <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</p>;
    if (!authenticated) return (
      <div style={{ padding: 24, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface1)' }}>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 14 }}>
          Inicia sesión para ver el panel administrativo.
        </p>
        <button className="btn-primary" onClick={onOpenLogin}>
          {t('nav.predict') || 'Iniciar sesión'}
        </button>
      </div>
    );
    if (!userIsAdmin) return (
      <div style={{ padding: 24, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface1)', color: 'var(--text-secondary)' }}>
        Tu usuario <strong>{username}</strong> no tiene permisos administrativos.
      </div>
    );
    return (
      <>
        {/* Tab bar */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 28,
          borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
        }}>
          {ADMIN_TABS.map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  background: 'none', border: 'none', padding: '10px 18px',
                  fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderBottom: `2px solid ${active ? 'var(--green)' : 'transparent'}`,
                  cursor: 'pointer', marginBottom: -1,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Active tab content */}
        {tab === 'create'   && <CreateMarketForm onCreated={bumpRefresh} />}
        {tab === 'generate' && (
          <>
            <OnchainStatusPanel />
            <GeneratorsSection />
          </>
        )}
        {tab === 'pending'  && <PendingMarketsSection refreshKey={refreshKey} bumpRefresh={bumpRefresh} />}
        {tab === 'markets'  && <MarketsList refreshKey={refreshKey} bumpRefresh={bumpRefresh} />}
        {tab === 'social'   && <SocialTasksSection />}
        {tab === 'stats'    && <StatsSection />}
      </>
    );
  }, [authenticated, loading, onOpenLogin, refreshKey, t, tab, userIsAdmin, username]);

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <main style={{ padding: '32px 48px 80px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '0.04em', color: 'var(--text-primary)', marginBottom: 6 }}>
            Admin · MVP
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            Gestión de mercados on-chain · Turnkey · Arbitrum Sepolia · MXNB.
          </p>
        </div>
        {body}
      </main>
      <Footer />
    </>
  );
}
