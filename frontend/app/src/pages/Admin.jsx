import React, { useState, useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import Nav from '../components/Nav.jsx';
import { getProtocolMode, setProtocolMode, isAdmin, getContracts } from '../lib/protocol.js';
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

function MarketsList({ mode }) {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch curated markets from lib/markets.js
    import('../lib/markets.js').then(mod => {
      const all = mod.PINNED_MARKETS || mod.default || [];
      setMarkets(all);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  function handleAction(market, action) {
    if (mode === 'polymarket') {
      alert('Acciones de mercado solo disponibles en modo protocolo propio');
      return;
    }
    // TODO: Call contract functions
    alert(`${action} mercado: ${market.title || market.question} (pendiente)`);
  }

  if (loading) return <div className="admin-card"><p>Cargando mercados...</p></div>;

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h3>Mercados activos</h3>
        <span className="admin-count">{markets.length}</span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Mercado</th>
              <th>Categoria</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m, i) => (
              <tr key={m.slug || i}>
                <td className="admin-market-title">{m.title || m.question}</td>
                <td>
                  <span className="admin-cat-badge">{m.category || '-'}</span>
                </td>
                <td>
                  <span className={`admin-badge ${m._resolved ? 'badge-resolved' : m.active === false ? 'badge-paused' : 'badge-active'}`}>
                    {m._resolved ? 'Resuelto' : m.active === false ? 'Pausado' : 'Activo'}
                  </span>
                </td>
                <td className="admin-actions">
                  {!m._resolved && (
                    <>
                      <button
                        className="btn-admin-sm"
                        onClick={() => handleAction(m, 'pausar')}
                        disabled={mode === 'polymarket'}
                      >
                        Pausar
                      </button>
                      <button
                        className="btn-admin-sm btn-admin-resolve"
                        onClick={() => handleAction(m, 'resolver')}
                        disabled={mode === 'polymarket'}
                      >
                        Resolver
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContractInfo({ mode }) {
  if (mode !== 'own') return null;

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h3>Contratos desplegados</h3>
        <span className="admin-badge badge-testnet">Base Sepolia</span>
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
  const [chainId, setChainId] = useState(84532); // default Base Sepolia
  const [safeAddrs, setSafeAddrs] = useState(getSafeAddresses(84532));
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
            <option value={84532}>Base Sepolia</option>
            <option value={8453}>Base Mainnet</option>
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

export default function Admin({ username, loading }) {
  const { authenticated, ready } = usePrivy();
  const [mode, setMode] = useState(getProtocolMode);

  const hasAccess = authenticated && isAdmin(username);

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
          <MarketsList mode={mode} />
        </div>
      </div>
    </>
  );
}
