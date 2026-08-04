/**
 * MVP Admin — dedicated panel for on-chain (Turnkey-signed) markets.
 *
 * Sections:
 *   1. Generadores — trigger protocol/admin/run-generators and points
 *      auto-resolve diagnostics with dry-run toggles. Same engines the
 *      Points admin uses, but MVP keeps its own generated review queue.
 *   2. Pendientes — candidate markets produced by generators. Each row
 *      gets an "Aprobar on-chain" form that deploys via MarketFactory
 *      before POST-ing to protocol/admin/pending-markets.
 *   3. Crear manual — CreateMarketForm deploys MarketFactory/V2 contracts
 *      through /api/protocol/admin/create-market.
 *   4. Mercados — list of indexed protocol_markets filtered by status.
 *      Resolve calls /api/protocol/admin/resolve-market on-chain.
 *
 * Generator/pending review for MVP lives under /api/protocol/admin/*.
 * Social tooling still lives under /api/points/admin/*.
 * Live MVP market create/list/resolve lives under /api/protocol/*.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import AdminInterestPanel from '../components/AdminInterestPanel.jsx';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { useT } from '../lib/i18n.js';
import {
  ADMIN_BASEBALL_LEAGUES,
  ADMIN_COMBATE_LEAGUES,
  ADMIN_CRYPTO_FILTERS,
  ADMIN_ENTERTAINMENT_TOPIC_FILTERS,
  ADMIN_GEO_FILTERS,
  ADMIN_MEXICO_TOPIC_FILTERS,
  ADMIN_SOCCER_LEAGUES,
  ADMIN_SPORT_FILTERS,
  CATEGORIES,
  MARKET_CATEGORY_FILTERS,
  MARKET_CREATION_GEO_OPTIONS,
  MARKET_CREATION_LEAGUE_BY_SPORT,
  MARKET_CREATION_SPORT_OPTIONS,
  MARKET_CREATION_TOPIC_OPTIONS,
  filterProtocolAdminMarkets,
} from '../lib/mvpAdminMarketFilters.js';

const DEFAULT_CHAIN_ID = Number(import.meta.env.VITE_ONCHAIN_CHAIN_ID || 42161);

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
// /api/protocol/admin/onchain-status which probes env vars + factory.owner()
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
      const { ok, data: body } = await getJson('/api/protocol/admin/onchain-status');
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
            {data.launch && (
              <span style={{ ...greenChip(data.launch.ready), marginLeft: 8 }}>
                {data.launch.ready ? 'SIN BLOQUEOS' : `${data.launch.blockerCount || 0} BLOQUEOS`}
              </span>
            )}
          </div>

          {(data.launch?.blockers?.length > 0 || data.launch?.reviews?.length > 0) && (
            <div style={{ marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
              {data.launch?.blockers?.length > 0 && (
                <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,69,69,0.06)', border: '1px solid rgba(255,69,69,0.25)' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--red)', textTransform: 'uppercase', marginBottom: 6 }}>
                    Bloqueos de lanzamiento
                  </div>
                  <ul style={{ margin: 0, padding: '0 0 0 18px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {data.launch.blockers.map((item) => (
                      <li key={item.id}>
                        <strong style={{ color: 'var(--text-primary)' }}>{item.title}</strong>
                        <div>{item.detail}</div>
                        {item.fix && <div style={{ color: 'var(--orange)' }}>{item.fix}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.launch?.reviews?.length > 0 && (
                <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,168,0,0.06)', border: '1px solid rgba(255,168,0,0.25)' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--orange)', textTransform: 'uppercase', marginBottom: 6 }}>
                    Revisar antes de abrir
                  </div>
                  <ul style={{ margin: 0, padding: '0 0 0 18px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {data.launch.reviews.map((item) => (
                      <li key={item.id}>
                        <strong style={{ color: 'var(--text-primary)' }}>{item.title}</strong>
                        <div>{item.detail}</div>
                        {item.fix && <div style={{ color: 'var(--orange)' }}>{item.fix}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

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
                ['ONCHAIN_RESOLVER_SUBORG_ID',       data.env.resolverSuborgId ? '✓' : '✕'],
                ['ONCHAIN_RESOLVER_ADDRESS',         data.env.resolverAddress ? short(data.env.resolverAddress) : '✕'],
                ['ADMIN_SAFE_ADDRESS',               data.ownerControls?.adminSafe ? short(data.ownerControls.adminSafe) : '✕'],
                ['RESOLVER_SAFE_ADDRESS',            data.ownerControls?.resolverSafe ? short(data.ownerControls.resolverSafe) : '✕'],
                ['ONCHAIN_OWNER_SUBORG_ID',          data.ownerControls?.ownerSuborgId ? '✓' : 'off'],
                ['ONCHAIN_OWNER_ADDRESS',            data.ownerControls?.ownerAddress ? short(data.ownerControls.ownerAddress) : 'off'],
                ['TURNKEY_POLICIES_ENABLED',         data.env.policiesEnabled ? '✓' : '✕'],
                ['TURNKEY_ORGANIZATION_ID',          data.turnkey?.organizationId ? '✓' : '✕'],
                ['TURNKEY_API_PUBLIC_KEY',           data.turnkey?.apiPublicKey ? '✓' : '✕'],
                ['TURNKEY_API_PRIVATE_KEY',          data.turnkey?.apiPrivateKey ? '✓' : '✕'],
                ['VITE_TURNKEY_ORGANIZATION_ID',     data.turnkey?.clientOrganizationId ? '✓' : '✕'],
                ['INDEXER_KEY',                      data.env.indexerKey ? '✓' : '✕'],
                ['CRON_SECRET',                      data.env.cronSecret ? '✓' : '✕'],
                ['JUNO_API_KEY',                     data.juno?.apiKey ? '✓' : '✕'],
                ['JUNO_API_SECRET',                  data.juno?.apiSecret ? '✓' : '✕'],
                ['JUNO_BEARER_TOKEN',                data.juno?.bearerToken ? '✓' : '✕'],
                ['JUNO_API_BASE_URL',                data.juno?.apiBaseUrl ? '✓' : '✕'],
                ['JUNO_WEBHOOK_SECRET',              data.juno?.webhookSecret ? '✓' : '✕'],
                ['JUNO_CARD_CHECKOUT_ENABLED',       data.juno?.cardCheckoutEnabled ? '✓' : 'off'],
                ['JUNO_APPLE_PAY_ENABLED',           data.juno?.applePayEnabled ? '✓' : 'off'],
                ['JUNO_WITHDRAWALS_ENABLED',         data.juno?.withdrawalsEnabled ? '✓' : 'off'],
                ['ONCHAIN_MARKET_POOL_ADDRESSES',    data.policy ? `${data.policy.configuredPoolCount || 0} pools` : '✕'],
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
                      <div>resolver: {short(f.resolver)} <span style={greenChip(f.resolverMatches)}>{f.resolverMatches ? '== resolver' : 'MISMATCH'}</span></div>
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
                    {' '}<span style={greenChip(data.deployer.collateralBalanceUnits > 0)}>{data.deployer.collateralBalanceUnits > 0 ? 'OK' : 'NEEDS MXNB'}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Deployment / policy coverage */}
          {(data.deployment || data.policy) && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'var(--surface2)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                Deployment / Turnkey policy
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                {data.deployment && (
                  <>
                    <div>client chain: {data.deployment.clientChainId || '✕'} · indexer chain: {data.deployment.indexerChainId || '✕'}</div>
                    <div>indexer factories: V1 {data.deployment.indexerFactoryV1 ? short(data.deployment.indexerFactoryV1) : '✕'} · V2 {data.deployment.indexerFactoryV2 ? short(data.deployment.indexerFactoryV2) : '✕'}</div>
                  </>
                )}
                {data.policy && (
                  <div>
                    policy pools: {data.policy.configuredPoolCount || 0} configured · {data.policy.indexedPoolCount || 0} indexed
                    {' '}<span style={greenChip((data.policy.missingPools?.length || 0) === 0)}>{(data.policy.missingPools?.length || 0) === 0 ? 'OK' : `${data.policy.missingPools.length} MISSING`}</span>
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
      const url = `/api/protocol/admin/run-generators${dry ? '?dry=1' : ''}`;
      const { ok, data } = await postJson(url, {});
      if (!ok) throw new Error(data?.error || 'generator_failed');
      setLast({ kind: 'generators', data });
      if (dry) {
        setNotice({ type: 'success', msg: `Vista previa: ${data.totalSpecs || 0} specs · ${data.elapsedMs}ms` });
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
      setNotice({ type: 'success', msg: dry ? `Vista previa: ${resolved} serían resueltos.` : `Resueltos: ${resolved}` });
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
              {running === 'generate' ? '…' : 'Vista previa'}
            </button>
            <button type="button" onClick={() => runGenerators({ dry: false })} disabled={running !== null} className="btn-primary" style={{ flex: 1 }}>
              {running === 'generate' ? '…' : 'Ejecutar'}
            </button>
          </div>
        </div>

        <div style={{ padding: 14, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            Resolución automática
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 12px 0' }}>
            Cierra mercados vencidos usando el resolver configurado (Chainlink / UMA / manual).
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => runAutoResolve({ dry: true })}  disabled={running !== null} className="btn-ghost" style={{ flex: 1 }}>
              {running === 'resolve' ? '…' : 'Vista previa'}
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
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const { ok, data } = await postJson('/api/protocol/admin/pending-markets', {
        id: pendingId,
        action: 'approve',
        note: note.trim() || null,
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
      <div style={{
        padding: '8px 10px', borderRadius: 6,
        background: 'rgba(0,232,122,0.06)', border: '1px solid rgba(0,232,122,0.22)',
        fontFamily: 'var(--font-mono)', fontSize: 10, lineHeight: 1.55,
        color: 'var(--text-secondary)', marginBottom: 10,
      }}>
        El backend llamará V1 (binario) o V2 (multi 2..8) según los resultados
        del pending. Aprobará seed MXNB hacia el factory y guardará
        la dirección en protocol_markets automáticamente.
      </div>
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

function PendingMarketsSection({ onQueueChange }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [workingId, setWorkingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { ok, data } = await getJson(`/api/protocol/admin/pending-markets?status=${filter}`);
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
  }, [filter]);

  // Only reload on initial mount or explicit Refrescar click. We
  // intentionally don't depend on the global `refreshKey` here:
  // approve/reject already do an in-place setRows mutation, and a
  // full list refetch would re-render every row and snap the page
  // back to the top of the queue — which is exactly the user
  // complaint about losing scroll position after each action.
  // Switching tabs unmounts this component, so the next visit
  // re-fetches naturally.
  useEffect(() => { load(); }, [load]);

  // Scroll-preservation helper. Approve and reject both mutate the
  // DOM in ways that change page height (form unmounts, row removed,
  // notice banner appears). Without this, the browser may clamp
  // scrollY to max-possible after the section shrinks — which
  // effectively snaps the user to the top of the queue. We capture
  // scrollY BEFORE the state mutations and restore it after React
  // commits the new DOM (rAF fires after layout).
  function preserveScroll(fn) {
    const beforeY = typeof window !== 'undefined' ? window.scrollY : 0;
    fn();
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        // Use scrollTo with 'instant' so the user doesn't see a
        // visible jump from a momentarily-clamped scroll position.
        window.scrollTo({ top: beforeY, left: 0, behavior: 'instant' });
      });
    }
  }

  async function handleReject(pid) {
    if (!window.confirm('¿Rechazar este mercado pendiente? No se puede deshacer.')) return;
    setWorkingId(pid);
    try {
      const { ok, data } = await postJson('/api/protocol/admin/pending-markets', { id: pid, action: 'reject' });
      if (!ok) throw new Error(data?.error || 'reject_failed');
      preserveScroll(() => {
        setNotice({ type: 'success', msg: `Pendiente ${pid} rechazado.` });
        setRows(prev => prev.filter(row => row.id !== pid));
      });
      onQueueChange?.();
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'reject_failed' });
    } finally {
      setWorkingId(null);
    }
  }

  async function handleReadd(pid) {
    setWorkingId(pid);
    try {
      const { ok, data } = await postJson('/api/protocol/admin/pending-markets', { id: pid, action: 'readd' });
      if (!ok) throw new Error(data?.error || 'readd_failed');
      preserveScroll(() => {
        setNotice({ type: 'success', msg: `Rechazado ${pid} regresó a pendientes.` });
        setRows(prev => prev.filter(row => row.id !== pid));
      });
      onQueueChange?.();
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'readd_failed' });
    } finally {
      setWorkingId(null);
    }
  }

  const label = filter === 'pending' ? 'Pendientes' : 'Rechazados';
  const emptyText = filter === 'pending'
    ? 'Nada pendiente. Corre los generadores para crear candidatos.'
    : 'Nada rechazado.';

  return (
    <section style={{
      padding: 20, border: '1px solid var(--border)', borderRadius: 14,
      background: 'var(--surface1)', marginBottom: 24,
    }}>
      <SectionHeader
        title={`${label} (${rows.length})`}
        subtitle={filter === 'pending'
          ? 'Candidatos de los generadores. Aprobar requiere una dirección on-chain.'
          : 'Mercados rechazados del generador. Puedes regresarlos a pendientes para aprobarlos on-chain.'}
        right={<button onClick={load} className="btn-ghost" style={{ fontSize: 11 }}>Refrescar</button>}
      />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {['pending', 'rejected'].map(s => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setOpenId(null);
              setNotice(null);
              setFilter(s);
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 16,
              border: `1px solid ${filter === s ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
              background: filter === s ? 'rgba(0,232,122,0.1)' : 'transparent',
              color: filter === s ? 'var(--green)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}
          >
            {s === 'pending' ? 'Pendientes' : 'Rechazados'}
          </button>
        ))}
      </div>
      <Notice notice={notice} />

      {loading && <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</div>}
      {error && <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>Error: {error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: 14, textAlign: 'center' }}>
          {emptyText}
        </div>
      )}

      {rows.map(r => {
        const isPending = r.status === 'pending';
        const isRejected = r.status === 'rejected';
        return (
          <div key={r.id} style={{
            padding: 12, border: '1px solid var(--border)', borderRadius: 10,
            background: 'var(--surface2)', marginBottom: 10,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {r.question}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>#{r.id}</span>
                  <span>{(r.outcomes || []).length} resultados · {r.ammMode || 'unified'}</span>
                  <span>{r.category || 'general'}</span>
                  {r.source && <span>src: {r.source}</span>}
                  {r.endTime && <span>cierra {new Date(r.endTime).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                  {r.reviewedAt && <span>rechazado {new Date(r.reviewedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                  {r.adminNote && <span>nota: {r.adminNote}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {openId !== r.id && isPending && (
                  <>
                    <button onClick={() => setOpenId(r.id)} className="btn-primary" style={{ fontSize: 11, padding: '6px 12px' }}>
                      Aprobar
                    </button>
                    <button onClick={() => handleReject(r.id)} disabled={workingId === r.id} className="btn-ghost" style={{ fontSize: 11, padding: '6px 12px' }}>
                      {workingId === r.id ? '…' : 'Rechazar'}
                    </button>
                  </>
                )}
                {isRejected && (
                  <button onClick={() => handleReadd(r.id)} disabled={workingId === r.id} className="btn-primary" style={{ fontSize: 11, padding: '6px 12px' }}>
                    {workingId === r.id ? '…' : 'Reagregar'}
                  </button>
                )}
              </div>
            </div>
            {openId === r.id && isPending && (
              <ApproveOnchainForm
                pendingId={r.id}
                onSuccess={(data) => {
                  const deployBit = data?.autoDeploy?.chainAddress
                    ? ` · auto-deployed at ${String(data.autoDeploy.chainAddress).slice(0, 10)}…`
                    : Array.isArray(data?.autoDeploy?.legs)
                      ? ` · auto-deployed ${data.autoDeploy.legs.length} legs`
                      : '';
                  // Wrap all mutations in preserveScroll so the form-
                  // unmount + row-removal + notice-insert combo doesn't
                  // shift the user's scroll position. We deliberately
                  // do NOT call bumpRefresh() here — refreshKey lives
                  // in the parent's body useMemo dep array, so bumping
                  // it forces the entire admin layout to re-render and
                  // can clobber scroll. The Mercados tab re-fetches on
                  // mount when the user switches to it, so we don't
                  // lose the approved market — it shows up there
                  // naturally on the next visit.
                  preserveScroll(() => {
                    setOpenId(null);
                    setNotice({
                      type: 'success',
                      msg: `Pendiente ${r.id} aprobado on-chain.${deployBit}`,
                    });
                    setRows(prev => prev.filter(row => row.id !== r.id));
                  });
                  onQueueChange?.();
                }}
                onCancel={() => setOpenId(null)}
              />
            )}
          </div>
        );
      })}
    </section>
  );
}

// ═══ Create-market form ═════════════════════════════════════════════════════
function CreateMarketForm({ onCreated, prefill }) {
  // `prefill` arrives from a deep-link handoff (currently the points-app's
  // /c/noticias "Crear mercado de esta noticia" button). When present
  // we pre-fill question + category so the admin only has to fill in
  // the trade-specific fields (outcomes, end time, etc). Renamed from
  // `seed` to avoid colliding with the local `seed` state used for
  // initial liquidity in the create form below.
  const [question, setQuestion] = useState(prefill?.question || '');
  const [category, setCategory] = useState(prefill?.category || 'deportes');
  const [outcomes, setOutcomes] = useState(['Sí', 'No']);
  const [outcomeImages, setOutcomeImages] = useState(['', '']);
  const [endTime, setEndTime] = useState('');
  const [seed, setSeed] = useState('1000');
  const [ammMode, setAmmMode] = useState('unified');
  const [chainId, setChainId] = useState(String(DEFAULT_CHAIN_ID));
  const [sport, setSport] = useState('');
  const [league, setLeague] = useState('');
  const [geoTag, setGeoTag] = useState('mexico');
  const [topicTag, setTopicTag] = useState('general');
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
    setOutcomes(prev => prev.length < 8 ? [...prev, ''] : prev);
    setOutcomeImages(prev => prev.length < 8 ? [...prev, ''] : prev);
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
  const leagueOptions = MARKET_CREATION_LEAGUE_BY_SPORT[sport] || null;
  const categoryTagsForCreate = category === 'mexico' ? ['mexico'] : null;
  const geoTagsForCreate = category === 'mexico' ? [geoTag] : null;
  const topicTagsForCreate = (category === 'mexico' || category === 'musica') ? [topicTag] : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setNotice(null);
    const trimmedOutcomes = outcomes.map(o => o.trim()).filter(Boolean);
    if (trimmedOutcomes.length < 2) {
      setNotice({ type: 'error', msg: 'Necesitas al menos 2 resultados.' });
      return;
    }
    setSubmitting(true);
    try {
      // Only ship outcomeImages when at least one slot is filled — otherwise
      // the API rejects length mismatches even when every slot is empty.
      const trimmedImages = outcomeImages.slice(0, trimmedOutcomes.length).map(u => (u || '').trim());
      const hasAnyImage = trimmedImages.some(Boolean);

      const { ok, data } = await postJson('/api/protocol/admin/create-market', {
        question: question.trim(),
        category,
        icon: null,
        sport: sport || null,
        league: league || null,
        categoryTags: categoryTagsForCreate,
        geoTags: geoTagsForCreate,
        topicTags: topicTagsForCreate,
        outcomeImages: hasAnyImage ? trimmedImages : null,
        endTime,
        outcomes: trimmedOutcomes,
        seedAmount: Number(seed),
        ammMode,
        resolutionSource: 'Pronos admin',
      });
      if (!ok) throw new Error(data?.error ? `${data.error}${data.detail ? ` · ${data.detail}` : ''}` : 'create_failed');
      const deployBit = data.ammMode === 'parallel'
        ? ` · ${data.legs?.length || trimmedOutcomes.length} pools`
        : ` · mercado #${data.marketId} · ${String(data.marketAddress || '').slice(0, 10)}…`;
      setNotice({ type: 'success', msg: `Mercado on-chain creado · ${data.ammMode}${deployBit}` });
      setQuestion('');
      setOutcomes(['Sí', 'No']);
      setOutcomeImages(['', '']);
      setSport('');
      setLeague('');
      setGeoTag('mexico');
      setTopicTag(category === 'musica' ? 'musica' : 'general');
      onCreated?.(data.marketId || Date.now());
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
      <SectionHeader title="Crear mercado on-chain" subtitle="Despliega vía MarketFactory y deja que el indexer lo publique en el MVP." />

      <Field label="Pregunta" hint="Debe resolver en una fecha clara.">
        <input type="text" required minLength={8} maxLength={200} value={question} onChange={e => setQuestion(e.target.value)} style={inputStyle} placeholder="¿México gana el partido inaugural del Mundial 2026?" />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
        <Field label="Categoría">
          <select value={category} onChange={e => {
            const next = e.target.value;
            setCategory(next);
            // Sport / league only make sense under 'deportes'. When the
            // user flips to any other category, scrub any sport state
            // they had picked so it isn't posted as ghost metadata.
            if (next !== 'deportes') {
              setSport('');
              setLeague('');
            }
            if (next === 'mexico') {
              setGeoTag('mexico');
              setTopicTag('general');
            } else if (next === 'musica') {
              setTopicTag('musica');
            }
          }} style={inputStyle}>
            {CATEGORIES.map(c => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* AMM mode radio */}
      <Field label="Modo AMM" hint="Unificado: una sola pool con N resultados. Paralelo: un mercado padre + N pools binarios (Sí/No).">
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

      <Field label="Resultados (2–8)" hint="Orden importa: el índice se usa al resolver y al firmar operaciones on-chain.">
        {outcomes.map((o, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto', gap: 8, marginBottom: 6 }}>
            <input type="text" required value={o} onChange={e => updateOutcome(i, e.target.value)} placeholder={`Outcome ${i + 1}`} style={inputStyle} />
            <input type="url" value={outcomeImages[i] || ''} onChange={e => updateOutcomeImage(i, e.target.value)} placeholder="Logo / imagen URL opcional" style={inputStyle} />
            {outcomes.length > 2 ? (
              <button type="button" onClick={() => removeOutcome(i)} style={{ padding: '6px 10px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>×</button>
            ) : (
              <div style={{ width: 36 }} />
            )}
          </div>
        ))}
        {outcomes.length < 8 && (
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
              {MARKET_CREATION_SPORT_OPTIONS.map(s => (
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

      {(category === 'mexico' || category === 'musica') && (
        <div style={{ display: 'grid', gridTemplateColumns: category === 'mexico' ? '1fr 1fr' : '1fr', gap: 14 }}>
          {category === 'mexico' && (
            <Field label="Región" hint="Alimenta las subcategorías de Mexico & Latam en el MVP.">
              <select value={geoTag} onChange={e => setGeoTag(e.target.value)} style={inputStyle}>
                {MARKET_CREATION_GEO_OPTIONS.map(g => (
                  <option key={g.key} value={g.key}>{g.label}</option>
                ))}
              </select>
            </Field>
          )}
          <Field
            label={category === 'musica' ? 'Subcategoría' : 'Tema'}
            hint={category === 'musica'
              ? 'Alimenta Música, Cine, TV y Farándula dentro de Entretenimiento.'
              : 'Alimenta los filtros internos de Mexico & Latam.'}
          >
            <select value={topicTag} onChange={e => setTopicTag(e.target.value)} style={inputStyle}>
              {(category === 'musica'
                ? ADMIN_ENTERTAINMENT_TOPIC_FILTERS.filter(t => t.key !== 'all')
                : MARKET_CREATION_TOPIC_OPTIONS
              ).map(t => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Fecha de cierre">
          <input type="datetime-local" required value={endTime} onChange={e => setEndTime(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Seed liquidity (MXNB)" hint="El deployer debe tener este saldo y allowance suficiente para el factory.">
          <input type="number" required min={100} value={seed} onChange={e => setSeed(e.target.value)} style={inputStyle} />
        </Field>
      </div>

      <div style={{ padding: 14, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', marginTop: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Despliegue on-chain
          </div>
        </div>

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
            <code> PronosAMMMulti</code>) con los <strong>{outcomes.length} resultados</strong> definidos.</>
          )}
          {' '}El indexer guardará el pool en <code>protocol_markets</code>.
          <br /><br />
          <strong style={{ color: 'var(--green)' }}>Requisitos:</strong> el wallet del deployer
          (<code>ONCHAIN_DEPLOYER_ADDRESS</code>) debe ser <code>owner()</code> del factory
          correspondiente {outcomes.length >= 3 && (<>(<code>ONCHAIN_MARKET_FACTORY_V2_ADDRESS</code>)</>)}
          {' '}y tener MXNB suficiente para el seed.
          <br /><br />
          <Field label="Chain ID" hint="42161 = Arbitrum One · 421614 = Arbitrum Sepolia">
            <input type="number" required min={1} value={chainId} onChange={e => setChainId(e.target.value)} style={inputStyle} />
          </Field>
        </div>
      </div>

      <Notice notice={notice} />

      <button type="submit" className="btn-primary" disabled={submitting} style={{ width: '100%' }}>
        {submitting ? 'Creando…' : 'Crear en protocolo'}
      </button>
    </form>
  );
}

// ═══ Edit-market modal ═════════════════════════════════════════════════════
function EditMarketModal({ market, onClose, onSaved, onLifecycle }) {
  const [question, setQuestion] = useState(market.question || '');
  const [category, setCategory] = useState(market.category || 'general');
  const [startTime, setStartTime] = useState(
    market.startTime ? new Date(market.startTime).toISOString().slice(0, 16) : '',
  );
  const [endTime, setEndTime] = useState(
    market.endTime ? new Date(market.endTime).toISOString().slice(0, 16) : '',
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [actionMode, setActionMode] = useState('save');

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      if (actionMode === 'cancel') {
        const ok = await onLifecycle?.(market, 'cancel');
        if (ok) onClose?.();
        return;
      }
      if (startTime && endTime && new Date(startTime).getTime() >= new Date(endTime).getTime()) {
        throw new Error('La fecha de inicio debe ser anterior a la fecha de cierre.');
      }
      const { ok, data } = await postJson('/api/points/admin/edit-market', {
        marketId: market.id,
        question: question.trim(),
        category,
        startTime,
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
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Fecha de inicio">
          <input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Fecha de cierre">
          <input type="datetime-local" required value={endTime} onChange={e => setEndTime(e.target.value)} style={inputStyle} />
        </Field>

        {err && (
          <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: 'rgba(255,69,69,0.08)', border: '1px solid rgba(255,69,69,0.25)', color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <button type="button" onClick={onClose} disabled={saving} className="btn-ghost" style={{ flex: 1 }}>
            Cancelar
          </button>
          <select
            value={actionMode}
            onChange={(e) => setActionMode(e.target.value)}
            disabled={saving || market.status === 'resolved'}
            title="Acción principal"
            style={{
              minWidth: 134,
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: actionMode === 'cancel' ? 'var(--red, #ef4444)' : 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              padding: '0 10px',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            <option value="save">Guardar</option>
            {market.status !== 'resolved' && <option value="cancel">Anular mercado</option>}
          </select>
          <button
            type="submit"
            disabled={saving}
            className={actionMode === 'cancel' ? 'btn-ghost' : 'btn-primary'}
            style={{
              flex: 1,
              color: actionMode === 'cancel' ? 'var(--red, #ef4444)' : undefined,
              borderColor: actionMode === 'cancel' ? 'rgba(239,68,68,0.35)' : undefined,
            }}
          >
            {saving
              ? (actionMode === 'cancel' ? 'Anulando…' : 'Guardando…')
              : (actionMode === 'cancel' ? 'Anular mercado' : 'Guardar')}
          </button>
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
  { value: 'disputed', label: 'En disputa'   },
  { value: 'canceled', label: 'Anulados'     },
];

function MarketsList({ refreshKey, bumpRefresh, onQueueChange, pendingResolveCount = 0, disputedCount = 0 }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('active');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sportFilter, setSportFilter] = useState('all');
  const [leagueFilter, setLeagueFilter] = useState('all');
  const [cryptoTypeFilter, setCryptoTypeFilter] = useState('all');
  const [geoFilter, setGeoFilter] = useState('all');
  const [topicFilter, setTopicFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [reviewingCandidateId, setReviewingCandidateId] = useState(null);
  const [lifecycleId, setLifecycleId] = useState(null);
  const [featuringId, setFeaturingId] = useState(null);
  const [archivingId, setArchivingId] = useState(null);
  const [bulkArchiving, setBulkArchiving] = useState(false);
  const [editingMarket, setEditingMarket] = useState(null);
  const [notice, setNotice] = useState(null);
  const showSportFilters = categoryFilter === 'deportes';
  const showCryptoFilters = categoryFilter === 'crypto';
  const showMexicoFilters = categoryFilter === 'mexico';
  const showTopicFilters = categoryFilter === 'mexico' || categoryFilter === 'musica';
  const activeTopicFilters = categoryFilter === 'musica'
    ? ADMIN_ENTERTAINMENT_TOPIC_FILTERS
    : ADMIN_MEXICO_TOPIC_FILTERS;
  const showLeagueFilters = showSportFilters
    && (sportFilter === 'soccer' || sportFilter === 'baseball' || sportFilter === 'combate');
  const activeLeagueFilters = sportFilter === 'baseball'
    ? ADMIN_BASEBALL_LEAGUES
    : sportFilter === 'combate'
      ? ADMIN_COMBATE_LEAGUES
      : ADMIN_SOCCER_LEAGUES;

  function selectCategoryFilter(next) {
    setCategoryFilter(next);
    setSportFilter('all');
    setLeagueFilter('all');
    setCryptoTypeFilter('all');
    setGeoFilter('all');
    setTopicFilter('all');
  }

  function selectSportFilter(next) {
    setSportFilter(next);
    if (next !== 'soccer' && next !== 'baseball' && next !== 'combate') {
      setLeagueFilter('all');
    }
  }

  async function handleBulkArchivePoints() {
    setBulkArchiving(true);
    setNotice(null);
    try {
      // Two-phase confirm: dry-run first to get the actual count, then
      // confirm with the count pinned. The server rejects with 409
      // count_mismatch if the live count drifts between preview and
      // commit (e.g. concurrent admin or new market generation).
      const preview = await postJson('/api/points/admin/bulk-archive', {
        mode: 'points',
        includeNullMode: true,
        dryRun: true,
      });
      if (!preview.ok) throw new Error(preview.data?.error || 'bulk_archive_failed');
      const wouldArchive = preview.data?.wouldArchiveCount ?? 0;
      if (wouldArchive === 0) {
        setNotice({ type: 'success', msg: 'No hay mercados off-chain por archivar.' });
        return;
      }
      const confirmMsg =
        `Archivar ${wouldArchive} mercados off-chain (mode=points + legacy NULL).\n\n` +
        '· Se ocultan de las listas públicas y de admin\n' +
        '· Se mantienen en la base para historial de operaciones\n' +
        '· Solo afecta a mercados off-chain — los onchain no se tocan\n\n' +
        '¿Continuar?';
      if (!window.confirm(confirmMsg)) return;

      const { ok, data } = await postJson('/api/points/admin/bulk-archive', {
        mode: 'points',
        includeNullMode: true,
        expectedCount: wouldArchive,
      });
      if (!ok) {
        if (data?.error === 'count_mismatch') {
          throw new Error(
            `El conteo cambió (esperaba ${data.detail?.expectedCount}, ahora hay ${data.detail?.liveCount}). ` +
            'Vuelve a confirmar.',
          );
        }
        throw new Error(data?.error || 'bulk_archive_failed');
      }
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
      const fetchStatus = filter === 'pending' ? 'active' : filter;
      const q = new URLSearchParams({
        status: fetchStatus,
        chainId: String(DEFAULT_CHAIN_ID),
        limit: '200',
      });
      const { ok, data } = await getJson(
        `/api/protocol/markets?${q.toString()}`,
      );
      if (!ok) throw new Error(data?.error || 'list_failed');
      const rawMarkets = Array.isArray(data?.markets) ? data.markets : [];
      const dueMarkets = filter === 'pending'
        ? rawMarkets
            .filter(m => m.status === 'active'
              && (m.resolutionCandidate
                || (m.endTime && new Date(m.endTime).getTime() <= Date.now())))
            .sort((a, b) => {
              const at = a.endTime ? new Date(a.endTime).getTime() : Number.MAX_SAFE_INTEGER;
              const bt = b.endTime ? new Date(b.endTime).getTime() : Number.MAX_SAFE_INTEGER;
              return at - bt;
            })
        : rawMarkets;
      setRows(dueMarkets.map((m) => ({
        ...m,
        ammMode: m.protocolVersion === 'v2' ? 'unified-v2' : 'binary-v1',
        chainAddress: m.poolAddress,
        tradeCount: m.tradeCount ?? null,
      })));
    } catch (e) {
      setError(e?.message || 'list_failed');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function handleResolve(market) {
    const input = window.prompt(
      `Índice del resultado ganador para "${market.question}":\n\n` +
      market.outcomes.map((o, i) => `  ${i}: ${o}`).join('\n'),
    );
    if (input === null) return;
    const idx = Number.parseInt(input, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= market.outcomes.length) {
      alert('Índice inválido.');
      return;
    }
    setResolvingId(market.id);
    setNotice(null);
    try {
      const { ok, data } = await postJson('/api/protocol/admin/resolve-market', {
        marketId: market.id,
        winningOutcomeIndex: idx,
      });
      if (!ok) {
        const parts = [data?.error || 'resolve_failed'];
        if (data?.detail) parts.push(data.detail);
        if (data?.code)   parts.push(`pg:${data.code}`);
        throw new Error(parts.join(' · '));
      }
      setNotice({ type: 'success', msg: `Resolución enviada on-chain: ${market.outcomes[idx]}` });
      // In-place row patch instead of full load() so the page doesn't
      // jump back to the top mid-scroll. The row reflects the new
      // status / outcome / finalScore immediately. bumpRefresh() still
      // fires so peer components (stats, mercados-on-chain count) can
      // refresh in their own time.
      setRows(prev => prev.map(m => m.id === market.id ? {
        ...m,
        status: 'resolved',
        outcome: idx,
        resolvedAt: new Date().toISOString(),
      } : m));
      bumpRefresh();
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'resolve_failed' });
    } finally {
      setResolvingId(null);
    }
  }

  async function handleCandidateReview(market, candidate, action) {
    const isConfirm = action === 'confirm';
    let note = null;
    let selectedOutcomeIndex = null;
    let selectedOutcomeLabel = candidate.label;
    if (isConfirm) {
      if (candidate.needsOutcome) {
        const input = window.prompt(
          `Este candidato solo trae evidencia, no una respuesta sugerida.\n\n` +
          `Elige el índice ganador para "${market.question}":\n\n` +
          (market.outcomes || []).map((o, i) => `  ${i}: ${o}`).join('\n'),
        );
        if (input === null) return;
        const idx = Number.parseInt(input, 10);
        if (!Number.isInteger(idx) || idx < 0 || idx >= (market.outcomes || []).length) {
          alert('Índice inválido.');
          return;
        }
        selectedOutcomeIndex = idx;
        selectedOutcomeLabel = market.outcomes[idx];
      }
      const ok = window.confirm(
        `${candidate.needsOutcome ? 'Confirmar resolución manual' : 'Confirmar resolución sugerida'} para "${market.question}"?\n\n` +
        `Resultado: ${selectedOutcomeLabel}\n` +
        `Confianza: ${candidate.confidenceLabel || '—'}\n\n` +
        'Esto enviará la resolución on-chain.',
      );
      if (!ok) return;
    } else {
      note = window.prompt('Motivo para negar la resolución sugerida (opcional):', '');
      if (note === null) return;
    }

    setReviewingCandidateId(candidate.id);
    setNotice(null);
    try {
      const { ok, data } = await postJson('/api/protocol/admin/resolution-candidates', {
        candidateId: candidate.id,
        action,
        outcomeIndex: selectedOutcomeIndex,
        note: note?.trim() || null,
      });
      if (!ok) {
        const parts = [data?.error || 'resolution_candidate_failed'];
        if (data?.detail) parts.push(data.detail);
        throw new Error(parts.join(' · '));
      }

      if (isConfirm) {
        const outcome = Number.isInteger(Number(data?.outcome))
          ? Number(data.outcome)
          : (selectedOutcomeIndex ?? Number(candidate.outcomeIndex));
        setNotice({ type: 'success', msg: `Resolución confirmada on-chain: ${selectedOutcomeLabel}` });
        setRows(prev => prev.map(m => m.id === market.id ? {
          ...m,
          status: 'resolved',
          outcome,
          finalScore: candidate.finalScore || m.finalScore,
          resolvedAt: new Date().toISOString(),
          resolutionCandidate: null,
        } : m));
        bumpRefresh();
        onQueueChange?.();
      } else {
        setNotice({ type: 'success', msg: 'Resolución sugerida negada. El mercado sigue abierto.' });
        setRows(prev => prev.map(m => m.id === market.id ? {
          ...m,
          resolutionCandidate: null,
        } : m));
        onQueueChange?.();
      }
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'resolution_candidate_failed' });
    } finally {
      setReviewingCandidateId(null);
    }
  }

  async function handleLifecycle(market, action) {
    const labels = {
      cancel: 'anular',
      dispute: 'abrir disputa sobre',
      clear_dispute: 'cerrar la disputa de',
      reopen: 'reabrir',
    };
    if (!market?.id || !labels[action]) return false;

    let note = null;
    if (action === 'cancel') {
      const ok = window.confirm(
        `¿Anular "${market.question}"?\n\n` +
        'Esta primera capa bloquea compras/ventas en la app y prepara el reporte de devolución. ' +
        'Los reembolsos on-chain se harán en la siguiente capa del contrato.',
      );
      if (!ok) return false;
      note = 'Mercado anulado: el evento no ocurrió';
    } else if (action === 'dispute') {
      note = window.prompt('Motivo de la disputa (visible para admin):', 'Resolución en disputa');
      if (note === null) return false;
    } else if (action === 'clear_dispute') {
      const ok = window.confirm(`¿Cerrar la disputa de "${market.question}" y volver al estado anterior?`);
      if (!ok) return false;
      note = 'Disputa cerrada por admin';
    } else if (action === 'reopen') {
      const ok = window.confirm(`¿Reabrir "${market.question}" como mercado activo?`);
      if (!ok) return false;
      note = 'Mercado reabierto por admin';
    }

    setLifecycleId(`${market.id}:${action}`);
    setNotice(null);
    try {
      const { ok, data } = await postJson('/api/protocol/admin/lifecycle-market', {
        marketId: market.id,
        action,
        note,
      });
      if (!ok) {
        const parts = [data?.error || 'lifecycle_failed'];
        if (data?.detail) parts.push(data.detail);
        throw new Error(parts.join(' · '));
      }
      const updated = data?.market || {};
      const nextStatus = updated.status || market.status;
      const refund = data?.refundReport || {};
      const reportText = action === 'cancel'
        ? ` · reporte: ${Number(refund.openPositionCount || 0)} posiciones, ${Number(refund.openCost || 0).toFixed(2)} MXNB costo abierto`
        : '';
      setNotice({
        type: 'success',
        msg: `Mercado actualizado: ${nextStatus}${reportText}.`,
      });
      setRows(prev => prev.flatMap((m) => {
        if (m.id !== market.id) return [m];
        const next = {
          ...m,
          ...updated,
          status: nextStatus,
        };
        if (filter === 'all') return [next];
        if (filter === 'pending') {
          return next.status === 'active'
            && next.endTime
            && new Date(next.endTime).getTime() <= Date.now()
            ? [next]
            : [];
        }
        return next.status === filter ? [next] : [];
      }));
      bumpRefresh();
      onQueueChange?.();
      return true;
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || `${labels[action]}_failed` });
      return false;
    } finally {
      setLifecycleId(null);
    }
  }

  async function handleToggleFeatured(market) {
    setFeaturingId(market.id);
    const nextFeatured = !market.featured;
    setRows(prev => prev.map(m => m.id === market.id ? { ...m, featured: nextFeatured } : m));
    try {
      const { ok, data } = await postJson('/api/protocol/admin/toggle-featured', {
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

  const visible = useMemo(() => filterProtocolAdminMarkets(rows, {
    categoryFilter,
    sportFilter,
    leagueFilter,
    cryptoTypeFilter,
    geoFilter,
    topicFilter,
  }), [rows, categoryFilter, sportFilter, leagueFilter, cryptoTypeFilter, geoFilter, topicFilter]);

  return (
    <section style={{
      padding: 20, border: '1px solid var(--border)', borderRadius: 14,
      background: 'var(--surface1)', marginBottom: 24,
    }}>
      <SectionHeader
        title={`Mercados on-chain (${visible.length})`}
        subtitle="protocol_markets indexado. Filtros + resolución on-chain."
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
        {STATUS_TABS.map(tab => {
          const pendingBadgeCount = filter === 'pending' && !loading ? visible.length : pendingResolveCount;
          const statusTaskCount = tab.value === 'pending' ? pendingBadgeCount
            : tab.value === 'disputed' ? disputedCount
            : 0;
          return (
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
                display: 'inline-flex', alignItems: 'center', gap: 8,
              }}
            >
              <span>{tab.label}</span>
              {statusTaskCount > 0 && (
                <span
                  aria-label={`${statusTaskCount} mercados por resolver`}
                  style={{
                    minWidth: 18,
                    height: 18,
                    padding: '0 6px',
                    borderRadius: 999,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(245,158,11,0.16)',
                    border: '1px solid rgba(245,158,11,0.5)',
                    color: '#f59e0b',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: 0,
                  }}
                >
                  {statusTaskCount > 99 ? '99+' : statusTaskCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{
        display: 'flex', gap: 8, marginBottom: 14,
        flexWrap: 'wrap',
      }}>
        {MARKET_CATEGORY_FILTERS.map(tab => (
          <button
            key={tab.key}
            onClick={() => selectCategoryFilter(tab.key)}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: `1px solid ${categoryFilter === tab.key ? 'rgba(0,232,122,0.35)' : 'var(--border)'}`,
              background: categoryFilter === tab.key ? 'rgba(0,232,122,0.08)' : 'transparent',
              color: categoryFilter === tab.key ? 'var(--green)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.04em',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {showMexicoFilters && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {ADMIN_GEO_FILTERS.map(g => (
              <button
                key={g.key}
                onClick={() => setGeoFilter(g.key)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 16,
                  border: `1px solid ${geoFilter === g.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                  background: geoFilter === g.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                  color: geoFilter === g.key ? 'var(--green)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
        </>
      )}

      {showTopicFilters && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {activeTopicFilters.map(t => (
            <button
              key={t.key}
              onClick={() => setTopicFilter(t.key)}
              style={{
                padding: '5px 10px',
                borderRadius: 14,
                border: `1px solid ${topicFilter === t.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                background: topicFilter === t.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                color: topicFilter === t.key ? 'var(--green)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {showSportFilters && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {ADMIN_SPORT_FILTERS.map(s => (
            <button
              key={s.key}
              onClick={() => selectSportFilter(s.key)}
              style={{
                padding: '6px 12px',
                borderRadius: 16,
                border: `1px solid ${sportFilter === s.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                background: sportFilter === s.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                color: sportFilter === s.key ? 'var(--green)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {showLeagueFilters && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {activeLeagueFilters.map(l => (
            <button
              key={l.key}
              onClick={() => setLeagueFilter(l.key)}
              style={{
                padding: '5px 10px',
                borderRadius: 14,
                border: `1px solid ${leagueFilter === l.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                background: leagueFilter === l.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                color: leagueFilter === l.key ? 'var(--green)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      {showCryptoFilters && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {ADMIN_CRYPTO_FILTERS.map(c => (
            <button
              key={c.key}
              onClick={() => setCryptoTypeFilter(c.key)}
              style={{
                padding: '6px 12px',
                borderRadius: 16,
                border: `1px solid ${cryptoTypeFilter === c.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                background: cryptoTypeFilter === c.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                color: cryptoTypeFilter === c.key ? 'var(--green)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <Notice notice={notice} />

      {loading && <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</div>}
      {error && <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>Error: {error}</div>}
      {!loading && !error && visible.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: 14 }}>
          {filter === 'pending' ? 'No hay mercados por resolver.' : 'No hay mercados on-chain en esta categoría.'}
        </div>
      )}

      {visible.map(m => {
        const candidate = m.resolutionCandidate;
        const evidence = Array.isArray(candidate?.evidence) ? candidate.evidence.slice(0, 3) : [];
        const reviewing = candidate && reviewingCandidateId === candidate.id;
        const statusLabel = m.archivedAt ? '📦 ARCHIVADO'
          : m.status === 'active' ? 'ACTIVO'
          : m.status === 'resolved' ? `✓ ${m.outcomes?.[m.outcome ?? 0] || 'resuelto'}`
          : m.status === 'disputed' ? 'EN DISPUTA'
          : m.status === 'canceled' ? 'ANULADO'
          : m.status;
        const statusColor = m.archivedAt ? 'var(--text-muted)'
          : m.status === 'active' ? 'var(--green)'
          : m.status === 'resolved' ? 'var(--gold)'
          : m.status === 'disputed' ? '#f59e0b'
          : m.status === 'canceled' ? 'var(--red, #ef4444)'
          : 'var(--text-muted)';
        const canCancel = m.status === 'active' || m.status === 'disputed';
        const canDispute = m.status === 'resolved';
        const canClearDispute = m.status === 'disputed';
        const canReopen = m.status === 'canceled' && m.previousStatus === 'active';
        return (
          <div key={m.id} style={{
            padding: 12, border: '1px solid var(--border)', borderRadius: 10,
            background: 'var(--surface2)', marginBottom: 8,
            display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
                {m.question}
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                <span>#{m.id}</span>
                <span>{m.category || 'general'}</span>
                <span>{m.ammMode}</span>
                <span>{(m.outcomes || []).length} resultados</span>
                <span style={{
                  color: statusColor,
                }}>
                  {statusLabel}
                </span>
                {m.lifecycleNote && <span>nota: {m.lifecycleNote}</span>}
                {m.tradeCount != null && <span>{m.tradeCount} operaciones</span>}
                {m.sport && <span>{m.sport}{m.league ? ` · ${m.league}` : ''}</span>}
                {m.chainId && <span>cadena {m.chainId}</span>}
                {m.chainAddress && <span>{m.chainAddress.slice(0, 6)}…{m.chainAddress.slice(-4)}</span>}
                {m.endTime && <span>cierra {new Date(m.endTime).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>}
              </div>
              {candidate && (
                <div style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid rgba(255,184,77,0.28)',
                  background: 'rgba(255,184,77,0.07)',
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'center',
                    marginBottom: 8,
                  }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--gold)',
                    }}>
                      Resolución sugerida
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--text-muted)',
                    }}>
                      {candidate.statusLabel || 'Sugerida'}
                    </div>
                  </div>
                  <div style={{ color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.45 }}>
                    Resultado: <strong>{candidate.needsOutcome ? 'Sin sugerencia automática' : candidate.label}</strong>
                    {candidate.confidenceLabel && <span style={{ color: 'var(--text-muted)' }}> · confianza {candidate.confidenceLabel}</span>}
                  </div>
                  {candidate.needsOutcome && (
                    <div style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: 12 }}>
                      Revisa las fuentes y elige el resultado al confirmar.
                    </div>
                  )}
                  {candidate.finalScore && (
                    <div style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: 12 }}>
                      Prueba: {candidate.finalScore}
                    </div>
                  )}
                  {candidate.rationale && (
                    <div style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: 12 }}>
                      Motivo: {candidate.rationale}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                    {candidate.source && <span style={{ color: 'var(--text-muted)' }}>fuente: {candidate.source}</span>}
                    {candidate.sourceEventId && <span style={{ color: 'var(--text-muted)' }}>evento: {candidate.sourceEventId}</span>}
                    {candidate.evidenceUrl && (
                      <a href={candidate.evidenceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>
                        Fuente principal ↗
                      </a>
                    )}
                  </div>
                  {evidence.length > 0 && (
                    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                      {evidence.map((item, idx) => (
                        <div key={`${candidate.id}-evidence-${idx}`} style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.45 }}>
                          {item.url ? (
                            <a href={item.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)' }}>
                              {item.title || `Evidencia ${idx + 1}`}
                            </a>
                          ) : (
                            <span>{item.title || `Evidencia ${idx + 1}`}</span>
                          )}
                          {item.quote && <span> · {item.quote}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => handleCandidateReview(m, candidate, 'confirm')}
                      disabled={reviewing}
                      className="btn-primary"
                      style={{ fontSize: 11, padding: '6px 10px' }}
                    >
                      {reviewing ? '…' : (candidate.needsOutcome ? 'Elegir y confirmar' : 'Confirmar resolución')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCandidateReview(m, candidate, 'deny')}
                      disabled={reviewing}
                      className="btn-ghost"
                      style={{ fontSize: 11, padding: '6px 10px' }}
                    >
                      {reviewing ? '…' : 'Negar'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                onClick={() => handleToggleFeatured(m)}
                disabled={featuringId === m.id}
                className="btn-ghost"
                title={m.featured ? 'Quitar de trending' : 'Agregar a trending'}
                style={{
                  fontSize: 13,
                  padding: '6px 10px',
                  color: m.featured ? '#f59e0b' : 'var(--text-muted)',
                  borderColor: m.featured ? 'rgba(245,158,11,0.45)' : 'var(--border)',
                  background: m.featured ? 'rgba(245,158,11,0.12)' : 'transparent',
                  filter: m.featured ? 'none' : 'grayscale(1)',
                  opacity: featuringId === m.id ? 0.6 : 1,
                }}
              >
                {featuringId === m.id ? '…' : '🔥'}
              </button>
              <button onClick={() => setEditingMarket(m)} className="btn-ghost" style={{ fontSize: 11, padding: '6px 10px' }}>
                Editar
              </button>
              {m.status === 'active' && (
                <button onClick={() => handleResolve(m)} disabled={resolvingId === m.id} className="btn-ghost" style={{ fontSize: 11, padding: '6px 10px' }}>
                  {resolvingId === m.id ? '…' : 'Resolver'}
                </button>
              )}
              {canDispute && (
                <button
                  onClick={() => handleLifecycle(m, 'dispute')}
                  disabled={lifecycleId === `${m.id}:dispute`}
                  className="btn-ghost"
                  style={{ fontSize: 11, padding: '6px 10px', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.35)' }}
                >
                  {lifecycleId === `${m.id}:dispute` ? '…' : 'Abrir disputa'}
                </button>
              )}
              {canClearDispute && (
                <button
                  onClick={() => handleLifecycle(m, 'clear_dispute')}
                  disabled={lifecycleId === `${m.id}:clear_dispute`}
                  className="btn-ghost"
                  style={{ fontSize: 11, padding: '6px 10px', color: 'var(--green)', borderColor: 'rgba(0,232,122,0.3)' }}
                >
                  {lifecycleId === `${m.id}:clear_dispute` ? '…' : 'Cerrar disputa'}
                </button>
              )}
              {canReopen && (
                <button
                  onClick={() => handleLifecycle(m, 'reopen')}
                  disabled={lifecycleId === `${m.id}:reopen`}
                  className="btn-ghost"
                  style={{ fontSize: 11, padding: '6px 10px' }}
                >
                  {lifecycleId === `${m.id}:reopen` ? '…' : 'Reabrir'}
                </button>
              )}
              {canCancel && (
                <button
                  onClick={() => handleLifecycle(m, 'cancel')}
                  disabled={lifecycleId === `${m.id}:cancel`}
                  className="btn-ghost"
                  style={{ fontSize: 11, padding: '6px 10px', color: 'var(--red, #ef4444)', borderColor: 'rgba(239,68,68,0.35)' }}
                >
                  {lifecycleId === `${m.id}:cancel` ? 'Anulando…' : 'Anular mercado'}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {editingMarket && (
        <EditMarketModal
          market={editingMarket}
          onClose={() => setEditingMarket(null)}
          onLifecycle={handleLifecycle}
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
function SocialTasksSection({ onQueueChange }) {
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
      onQueueChange?.();
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

// ═══ Funding monitor ═══════════════════════════════════════════════════════
function formatFundingAmount(value, asset = 'MXNB') {
  const n = Number(value || 0);
  return `${new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0)} ${asset || 'MXNB'}`;
}

function FundingMonitorSection({ onQueueChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { ok, data: body } = await getJson('/api/protocol/admin/funding-monitor');
      if (!ok) throw new Error(body?.error || 'funding_monitor_failed');
      setData(body);
      onQueueChange?.();
    } catch (e) {
      setError(e?.message || 'funding_monitor_failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [onQueueChange]);

  useEffect(() => { load(); }, [load]);

  const counts = data?.counts || {};
  const total = Number(counts.total || 0);
  const missingAccounts = (data?.accounts || []).filter(a => !a.clabe || !a.blockchain_account_registered);
  const withdrawals = data?.withdrawals || [];
  const events = (data?.events || []).filter(e => (
    ['pending', 'processing', 'failed', 'error', 'rejected'].includes(String(e.transaction_status || '').toLowerCase())
  ));

  return (
    <section style={{
      padding: 20, border: '1px solid var(--border)', borderRadius: 14,
      background: 'var(--surface1)',
    }}>
      <SectionHeader
        title="Fondeo"
        subtitle="CLABEs, depósitos, retiros y eventos de proveedor que necesitan revisión antes de mainnet."
        right={
          <button onClick={load} className="btn-ghost" disabled={loading} style={{ fontSize: 11 }}>
            {loading ? '…' : 'Refrescar'}
          </button>
        }
      />

      {error && (
        <div style={{ marginBottom: 12, color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          Error: {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
        {[
          ['Sin CLABE', counts.missingClabe || 0],
          ['Wallet pendiente', counts.pendingWalletRegistration || 0],
          ['Retiros', counts.pendingWithdrawals || 0],
          ['Depósitos atorados', counts.stuckDeposits || 0],
          ['Eventos con error', counts.failedEvents || 0],
        ].map(([label, value]) => (
          <StatCard key={label} label={label} value={Number(value || 0).toLocaleString('es-MX')} />
        ))}
      </div>

      {!loading && total === 0 && (
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          Sin tareas de fondeo por ahora.
        </p>
      )}

      {withdrawals.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            Retiros pendientes
          </div>
          {withdrawals.map(w => (
            <div key={w.id} style={{ padding: 12, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                <span style={{ color: 'var(--text-primary)' }}>#{w.id} · @{w.username || 'usuario'}</span>
                <span style={{ color: w.status === 'provider_error' ? 'var(--red)' : 'var(--orange)' }}>{String(w.status || 'pending').toUpperCase()}</span>
              </div>
              <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                {formatFundingAmount(w.amount, w.asset)} · CLABE {w.destination_clabe || '—'}
                {w.note ? ` · ${w.note}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {missingAccounts.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            Cuentas incompletas
          </div>
          {missingAccounts.slice(0, 20).map(a => (
            <div key={a.id} style={{ padding: 12, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', marginBottom: 8 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)' }}>
                @{a.username || 'usuario'} · {a.wallet_address ? short(a.wallet_address) : 'sin wallet'}
              </div>
              <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                CLABE: {a.clabe || 'pendiente'} · wallet Juno: {a.blockchain_account_registered ? 'registrada' : 'pendiente'}
              </div>
            </div>
          ))}
        </div>
      )}

      {events.length > 0 && (
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            Eventos de proveedor
          </div>
          {events.slice(0, 20).map(e => (
            <div key={e.id} style={{ padding: 12, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                <span style={{ color: 'var(--text-primary)' }}>{e.transaction_type || e.event_type || 'evento'} · @{e.username || 'usuario'}</span>
                <span style={{ color: ['failed', 'error', 'rejected'].includes(String(e.transaction_status || '').toLowerCase()) ? 'var(--red)' : 'var(--orange)' }}>
                  {String(e.transaction_status || 'pending').toUpperCase()}
                </span>
              </div>
              <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                {formatFundingAmount(e.amount, e.asset)} · {e.tx_hash ? short(e.tx_hash) : e.clabe || 'sin referencia'}
              </div>
            </div>
          ))}
        </div>
      )}
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

      <AdminInterestPanel interest={stats.interest} />
    </section>
  );
}

// ═══ Page shell ═════════════════════════════════════════════════════════════
const ADMIN_TABS = [
  { id: 'create',   label: 'Crear mercado'   },
  { id: 'generate', label: 'Generar'         },
  { id: 'pending',  label: 'Por aprobar',     countKey: 'pending' },
  { id: 'markets',  label: 'Mercados',        countKey: 'markets' },
  { id: 'social',   label: 'Tareas sociales', countKey: 'social' },
  { id: 'funding',  label: 'Fondeo',          countKey: 'funding' },
  { id: 'stats',    label: 'Estadísticas'    },
];

export default function Admin({ username, userIsAdmin, loading, onOpenLogin }) {
  const t = useT();
  const { authenticated } = usePointsAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey(k => k + 1);
  const [adminTaskCounts, setAdminTaskCounts] = useState({
    pending: 0,
    pendingResolve: 0,
    markets: 0,
    disputed: 0,
    social: 0,
    funding: 0,
  });

  // Read initial tab + create-form seed from query string. Lets the
  // points-app news page hand off "Crear mercado de esta noticia"
  // links by deep-linking into /mvp/admin?tab=create&question=...&category=...
  const initialTab = (() => {
    if (typeof window === 'undefined') return 'create';
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get('tab');
    return ['create', 'generate', 'pending', 'markets', 'social', 'funding', 'stats'].includes(t) ? t : 'create';
  })();
  const createSeed = (() => {
    if (typeof window === 'undefined') return null;
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get('question');
    if (!q) return null;
    return {
      question: q.slice(0, 200),
      category: (sp.get('category') || '').slice(0, 32) || null,
    };
  })();

  const [tab, setTab] = useState(initialTab);

  const loadAdminTaskCounts = useCallback(async () => {
    if (!authenticated || !userIsAdmin) {
      setAdminTaskCounts({ pending: 0, pendingResolve: 0, markets: 0, disputed: 0, social: 0, funding: 0 });
      return;
    }

    const [pendingResult, resolutionResult, disputedResult, socialResult, fundingResult] = await Promise.allSettled([
      getJson('/api/protocol/admin/pending-markets?status=pending'),
      getJson('/api/protocol/admin/resolution-candidates?status=pending'),
      getJson(`/api/protocol/markets?status=disputed&chainId=${DEFAULT_CHAIN_ID}&limit=200`),
      getJson('/api/points/admin/social-tasks?status=pending'),
      getJson('/api/protocol/admin/funding-monitor'),
    ]);

    const pendingData = pendingResult.status === 'fulfilled' ? pendingResult.value : null;
    const resolutionData = resolutionResult.status === 'fulfilled' ? resolutionResult.value : null;
    const disputedData = disputedResult.status === 'fulfilled' ? disputedResult.value : null;
    const socialData = socialResult.status === 'fulfilled' ? socialResult.value : null;
    const fundingData = fundingResult.status === 'fulfilled' ? fundingResult.value : null;
    const pendingResolve = resolutionData?.ok
      ? Number(resolutionData.data?.count || 0)
      : 0;
    const disputed = disputedData?.ok && Array.isArray(disputedData.data?.markets)
      ? disputedData.data.markets.length
      : 0;

    setAdminTaskCounts({
      pending: pendingData?.ok && Array.isArray(pendingData.data?.pending)
        ? pendingData.data.pending.length
        : 0,
      pendingResolve,
      markets: pendingResolve + disputed,
      disputed,
      social: socialData?.ok && Array.isArray(socialData.data?.tasks)
        ? socialData.data.tasks.length
        : 0,
      funding: fundingData?.ok
        ? Number(fundingData.data?.counts?.total || 0)
        : 0,
    });
  }, [authenticated, userIsAdmin]);

  useEffect(() => {
    loadAdminTaskCounts();
  }, [loadAdminTaskCounts, refreshKey, tab]);

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
            const taskCount = t.countKey ? Number(adminTaskCounts[t.countKey] || 0) : 0;
            const showTaskCount = tab !== t.id && taskCount > 0;
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
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                }}
              >
                <span>{t.label}</span>
                {showTaskCount && (
                  <span
                    aria-label={`${taskCount} tareas pendientes`}
                    style={{
                      minWidth: 18,
                      height: 18,
                      padding: '0 6px',
                      borderRadius: 999,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--green)',
                      color: '#00150b',
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: 0,
                    }}
                  >
                    {taskCount > 99 ? '99+' : taskCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Active tab content */}
        {tab === 'create'   && <CreateMarketForm onCreated={bumpRefresh} prefill={createSeed} />}
        {tab === 'generate' && (
          <>
            <OnchainStatusPanel />
            <GeneratorsSection />
          </>
        )}
        {tab === 'pending'  && <PendingMarketsSection onQueueChange={loadAdminTaskCounts} />}
        {tab === 'markets'  && (
          <MarketsList
            refreshKey={refreshKey}
            bumpRefresh={bumpRefresh}
            onQueueChange={loadAdminTaskCounts}
            pendingResolveCount={adminTaskCounts.pendingResolve}
            disputedCount={adminTaskCounts.disputed}
          />
        )}
        {tab === 'social'   && <SocialTasksSection onQueueChange={loadAdminTaskCounts} />}
        {tab === 'funding'  && <FundingMonitorSection onQueueChange={loadAdminTaskCounts} />}
        {tab === 'stats'    && <StatsSection />}
      </>
    );
  }, [adminTaskCounts, authenticated, loadAdminTaskCounts, loading, onOpenLogin, refreshKey, t, tab, userIsAdmin, username]);

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <main style={{
        padding: 'clamp(20px, 4vw, 32px) clamp(14px, 4vw, 48px) 72px',
        maxWidth: 1100,
        margin: '0 auto',
      }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '0.04em', color: 'var(--text-primary)', marginBottom: 6 }}>
            Admin · MVP
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            Gestión de mercados on-chain · Turnkey · Arbitrum One · MXNB.
          </p>
        </div>
        {body}
      </main>
      <Footer />
    </>
  );
}
