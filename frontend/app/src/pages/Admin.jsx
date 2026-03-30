import React, { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import Nav from '../components/Nav.jsx';
import { getProtocolMode, setProtocolMode, isAdmin } from '../lib/protocol.js';

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

export default function Admin() {
  const { authenticated, user } = usePrivy();
  const [mode, setMode] = useState(getProtocolMode);
  const [username, setUsername] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch username for access check
  useEffect(() => {
    if (!authenticated || !user?.id) {
      setUsername(null);
      setLoading(false);
      return;
    }
    fetch(`/api/user?privyId=${encodeURIComponent(user.id)}`)
      .then(r => r.json())
      .then(data => {
        setUsername(data.username || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [authenticated, user?.id]);

  const hasAccess = authenticated && isAdmin(username);

  function handleToggle() {
    const next = mode === 'polymarket' ? 'own' : 'polymarket';
    setProtocolMode(next);
    setMode(next);
  }

  if (loading) {
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
          <FeeInfo mode={mode} />
          <ContractInfo mode={mode} />
          <CreateMarketForm mode={mode} />
          <MarketsList mode={mode} />
        </div>
      </div>
    </>
  );
}
