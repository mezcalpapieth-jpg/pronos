import React, { useState, useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import Nav from '../components/Nav.jsx';
import { getProtocolMode, setProtocolMode, isAdmin, getContracts } from '../lib/protocol.js';
import { resolveMarket, fetchResolutions } from '../lib/resolutions.js';
import { fetchGeneratedMarkets, updateGeneratedMarket } from '../lib/generatedMarkets.js';
import { gmFetchMarkets } from '../lib/gamma.js';
import {
  getSafeAddresses, setSafeAddresses,
  createSafe, proposeTransaction, confirmTransaction, executeTransaction,
  getPendingTransactions, getSafeInfo,
  encodeResolveMarket, encodePauseMarket, encodeDistributeFees,
} from '../lib/safe.js';

const MARKET_CATEGORIES = [
  { value: 'deportes', label: 'Deportes' },
  { value: 'politica', label: 'Politica' },
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
          ? 'Los mercados se enrutan a traves de Polymarket CLOB. Cambiar a protocolo propio para usar tus contratos en Base.'
          : 'Los mercados usan tus contratos AMM en Base. Cambiar a Polymarket para el modo agregador.'}
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

function CreateMarketForm({ mode }) {
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState('deportes');
  const [endDate, setEndDate] = useState('');
  const [resolutionSource, setResolutionSource] = useState('');
  const [seedAmount, setSeedAmount] = useState('');
  const [status, setStatus] = useState(null);

  function handleSubmit(e) {
    e.preventDefault();
    if (mode === 'polymarket') {
      setStatus({ type: 'info', msg: 'En modo Polymarket, los mercados se agregan en lib/markets.js. Cambia a protocolo propio para crear mercados on-chain.' });
      return;
    }
    // TODO: Call MarketFactory.createMarket() via ethers
    setStatus({ type: 'success', msg: `Mercado creado: "${question}" (pendiente integracion con contrato)` });
  }

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h3>Crear mercado</h3>
      </div>
      <form onSubmit={handleSubmit} className="admin-form">
        <label>
          <span>Pregunta</span>
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Ej: Mexico ganara el Mundial 2026?"
            required
          />
        </label>
        <label>
          <span>Categoria</span>
          <select value={category} onChange={e => setCategory(e.target.value)}>
            {MARKET_CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Fecha de cierre</span>
          <input
            type="datetime-local"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            required
          />
        </label>
        <label>
          <span>Fuente de resolucion</span>
          <input
            type="text"
            value={resolutionSource}
            onChange={e => setResolutionSource(e.target.value)}
            placeholder="Ej: Resultados oficiales FIFA"
            required
          />
        </label>
        {mode === 'own' && (
          <label>
            <span>Liquidez inicial (USDC)</span>
            <input
              type="number"
              value={seedAmount}
              onChange={e => setSeedAmount(e.target.value)}
              placeholder="Ej: 10000"
              min="100"
              required
            />
          </label>
        )}
        <button type="submit" className="btn-admin-primary">
          {mode === 'own' ? 'Crear mercado on-chain' : 'Agregar mercado curado'}
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

function ResolveModal({ market, onClose, onResolved, privyId }) {
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
    if (!outcome || !winner) { setError('Selecciona un resultado'); return; }
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
          <h3 style={{ fontFamily:'var(--font-display)',fontSize:24,letterSpacing:'0.03em',color:'var(--text-primary)' }}>RESOLVER MERCADO</h3>
          <button onClick={onClose} style={{ background:'none',border:'none',color:'var(--text-muted)',fontSize:22,cursor:'pointer' }}>&times;</button>
        </div>

        <p style={{ fontSize:14,color:'var(--text-secondary)',marginBottom:20,lineHeight:1.5 }}>{market.title}</p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-muted)',letterSpacing:'0.1em',display:'block',marginBottom:8 }}>RESULTADO GANADOR</label>
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
            <label style={{ fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-muted)',letterSpacing:'0.1em',display:'block',marginBottom:4 }}>RESUELTO POR</label>
            <input type="text" value={resolvedBy} onChange={e => setResolvedBy(e.target.value)} placeholder="Ej: Resultados oficiales FIFA"
              style={{ width:'100%',background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 14px',color:'var(--text-primary)',fontFamily:'var(--font-body)',fontSize:13 }} />
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={{ fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-muted)',letterSpacing:'0.1em',display:'block',marginBottom:4 }}>DESCRIPCION (OPCIONAL)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Detalles adicionales sobre la resolución..."
              style={{ width:'100%',background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 14px',color:'var(--text-primary)',fontFamily:'var(--font-body)',fontSize:13,resize:'vertical' }} />
          </div>

          {error && <div style={{ color:'var(--red)',fontSize:13,marginBottom:12 }}>{error}</div>}

          <div style={{ display:'flex',gap:12 }}>
            <button type="button" onClick={onClose} style={{ flex:1,padding:'12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text-secondary)',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:14 }}>
              Cancelar
            </button>
            <button type="submit" disabled={submitting || !outcome} style={{ flex:1,padding:'12px',borderRadius:8,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontFamily:'var(--font-display)',fontSize:16,letterSpacing:'0.04em',opacity:(!outcome||submitting)?0.5:1 }}>
              {submitting ? 'RESOLVIENDO...' : 'CONFIRMAR'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MarketsList({ mode, privyId }) {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolvedIds, setResolvedIds] = useState(new Set());
  const [resolveTarget, setResolveTarget] = useState(null);
  const [sourceFilter, setSourceFilter] = useState('all'); // all | local | polymarket

  useEffect(() => {
    async function load() {
      // Load every source the public site shows so the admin sees the full
      // catalogue (including English-titled live Polymarket markets that
      // used to be invisible because admin only loaded the hardcoded list).
      const [marketsModule, live, resolutions] = await Promise.all([
        import('../lib/markets.js'),
        gmFetchMarkets({ limit: 100 }).catch(() => []),
        fetchResolutions().catch(() => []),
      ]);
      const local = marketsModule.PINNED_MARKETS || marketsModule.default || [];
      // Dedup: hardcoded entries that already exist on Polymarket (matched
      // by slug/id) defer to the live version so the admin doesn't see two
      // rows for the same market.
      const liveIds = new Set((live || []).map(m => m.id));
      const localOnly = local.filter(m => !liveIds.has(m.id));
      const all = [...(live || []), ...localOnly];
      const rIds = new Set(resolutions.map(r => r.market_id));
      setResolvedIds(rIds);
      setMarkets(all);
      setLoading(false);
    }
    load();
  }, []);

  // Source filter — flips the table between hardcoded local markets and
  // live Polymarket so admins can find what they're looking for.
  const filtered = markets.filter(m => {
    if (sourceFilter === 'all') return true;
    if (sourceFilter === 'local') return m._source !== 'polymarket' || !m._polyId;
    if (sourceFilter === 'polymarket') return m._source === 'polymarket' && m._polyId;
    return true;
  });

  function handleResolved(marketId) {
    setResolvedIds(prev => new Set([...prev, marketId]));
  }

  if (loading) return <div className="admin-card"><p>Cargando mercados...</p></div>;

  const sourceCounts = {
    all: markets.length,
    polymarket: markets.filter(m => m._source === 'polymarket' && m._polyId).length,
    local: markets.filter(m => m._source !== 'polymarket' || !m._polyId).length,
  };

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h3>Mercados</h3>
        <span className="admin-count">{filtered.length}</span>
      </div>

      {/* Source filter — admins can flip between live Polymarket and local */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        {[
          { key: 'all',        label: `Todos (${sourceCounts.all})` },
          { key: 'polymarket', label: `Polymarket (${sourceCounts.polymarket})` },
          { key: 'local',      label: `Locales (${sourceCounts.local})` },
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
              <th>Mercado</th>
              <th>Fuente</th>
              <th>Categoria</th>
              <th>Fecha limite</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m, i) => {
              const isResolved = m._resolved || resolvedIds.has(m.id);
              const isPoly = m._source === 'polymarket' && m._polyId;
              return (
                <tr key={m.id || i}>
                  <td className="admin-market-title">{m.title || m.question}</td>
                  <td>
                    <span className={`admin-badge ${isPoly ? 'badge-poly' : 'badge-own'}`}>
                      {isPoly ? 'Polymarket' : 'Local'}
                    </span>
                  </td>
                  <td>
                    <span className="admin-cat-badge">{m.category || '-'}</span>
                  </td>
                  <td style={{ fontFamily:'var(--font-mono)',fontSize:12,color:'var(--text-muted)',whiteSpace:'nowrap' }}>{m.deadline || '—'}</td>
                  <td>
                    <span className={`admin-badge ${isResolved ? 'badge-resolved' : 'badge-active'}`}>
                      {isResolved ? 'Resuelto' : 'Activo'}
                    </span>
                  </td>
                  <td className="admin-actions">
                    {!isResolved && (
                      <button
                        className="btn-admin-sm btn-admin-resolve"
                        onClick={() => setResolveTarget(m)}
                      >
                        Resolver
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
          onClose={() => setResolveTarget(null)}
          onResolved={handleResolved}
        />
      )}
    </div>
  );
}

function ContractInfo({ mode }) {
  if (mode !== 'own') return null;

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h3>Contratos desplegados</h3>
        <span className="admin-badge badge-testnet">Arbitrum Sepolia</span>
      </div>
      <div className="admin-contracts">
        <div className="admin-contract-row">
          <span className="contract-label">MarketFactory</span>
          <span className="contract-addr">Pendiente de deploy</span>
        </div>
        <div className="admin-contract-row">
          <span className="contract-label">PronosToken (ERC-1155)</span>
          <span className="contract-addr">Pendiente de deploy</span>
        </div>
        <div className="admin-contract-row">
          <span className="contract-label">USDC</span>
          <code className="contract-addr">0x036C...3dCF7e</code>
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
        <div className="fee-equation">fee = 5 &times; (1 - P) %</div>
        <div className="fee-examples">
          <div className="fee-example">
            <span>50/50</span>
            <strong>2.5%</strong>
          </div>
          <div className="fee-example">
            <span>90/10</span>
            <strong>0.5%</strong>
          </div>
          <div className="fee-example">
            <span>99/1</span>
            <strong>0.05%</strong>
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
function GeneratedMarketsReview({ privyId }) {
  const [tab, setTab] = useState('pending');
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchGeneratedMarkets(tab, tab === 'pending' ? privyId : undefined);
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
      await updateGeneratedMarket({ privyId, id, action });
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
  const { authenticated, ready, user } = usePrivy();
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
          <CreateMarketForm mode={mode} />
          <MarketsList mode={mode} privyId={privyId} />
          <GeneratedMarketsReview privyId={privyId} />
        </div>
      </div>
    </>
  );
}
