import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '@app/lib/i18n.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import {
  createApiKey,
  fetchApiKeys,
  publicErrorMessage,
  revokeApiKey,
} from '../lib/pointsApi.js';

const EXPIRY_OPTIONS = [
  { id: 'none', days: null },
  { id: '30d', days: 30 },
  { id: '90d', days: 90 },
];

function fmtDate(value, lang) {
  if (!value) return lang === 'en' ? 'Never' : 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(lang === 'en' ? 'en-US' : 'es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function expiryToIso(optionId) {
  const option = EXPIRY_OPTIONS.find(item => item.id === optionId);
  if (!option?.days) return null;
  const date = new Date();
  date.setDate(date.getDate() + option.days);
  return date.toISOString();
}

function permissionLabel(permissions) {
  const list = Array.isArray(permissions) ? permissions : [];
  if (list.includes('TRADE')) return 'READ + TRADE';
  return 'READ';
}

function codeSample(apiKey, apiSecret) {
  const key = apiKey || 'pk_pronos_xxx';
  const secret = apiSecret || 'pnsec_xxx';
  return `import crypto from 'node:crypto';

const apiKey = '${key}';
const apiSecret = '${secret}';
const path = '/api/v1/markets';
const method = 'GET';
const body = '';
const timestamp = Date.now().toString();
const signature = crypto
  .createHmac('sha256', apiSecret)
  .update(\`\${timestamp}\${method}\${path}\${body}\`)
  .digest('hex');

const res = await fetch(\`https://pronos.io\${path}\`, {
  headers: {
    'X-PRONOS-API-KEY': apiKey,
    'X-PRONOS-TIMESTAMP': timestamp,
    'X-PRONOS-SIGNATURE': signature,
  },
});`;
}

function CopyButton({ value, copiedId, setCopiedId, id, children }) {
  async function copy() {
    try {
      await navigator.clipboard?.writeText(String(value || ''));
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1400);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <button type="button" onClick={copy} style={smallButtonStyle}>
      {copiedId === id ? 'Copiado' : children}
    </button>
  );
}

export default function PointsDeveloper({ onOpenLogin }) {
  const lang = useLang();
  const { authenticated, loading, user } = usePointsAuth();
  const [keys, setKeys] = useState(null);
  const [access, setAccess] = useState(null);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [name, setName] = useState('Pronos API');
  const [expiry, setExpiry] = useState('90d');
  const [tradeAccess, setTradeAccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const copy = useMemo(() => (lang === 'en'
    ? {
        title: 'Developer API',
        kicker: 'Pronos for builders',
        subtitle: 'Create keys for bots, dashboards, alerts, and trading tools that act as your Pronos user.',
        login: 'Sign in to create and manage API keys.',
        loginCta: 'Log In',
        back: 'Back to user',
        createTitle: 'Create API key',
        name: 'Key name',
        expires: 'Expires',
        readOnly: 'Read markets and account data',
        trading: 'Request trading access',
        tradingNote: 'Trading keys can place orders from your account. We may ask for phone verification before higher-risk access is approved.',
        create: 'Create key',
        creating: 'Creating...',
        current: 'Current keys',
        noKeys: 'No API keys yet.',
        secretTitle: 'Copy this secret now',
        secretBody: 'The secret is shown once. Store it in your server environment, never in browser code.',
        docs: 'How to use it',
        auth: 'Authentication',
        authBody: 'Every request must include the API key, timestamp, and HMAC-SHA256 signature. The signature payload is timestamp + method + path with query + raw body.',
        endpoints: 'Endpoints',
        phone: 'Phone verification',
        phoneBody: 'For now, phone confirmation is part of the manual approval flow. Once your phone is confirmed, use this page to create a key and tell the team what you plan to build.',
        phoneRequiredTitle: 'Phone verification requested',
        phoneRequiredBody: 'The team needs your phone number before approving higher-risk account or API usage.',
        blockedTitle: 'API access blocked',
        blockedBody: 'API key creation and signed API requests are blocked for this account. Existing keys may have been revoked.',
      }
    : {
        title: 'Developer API',
        kicker: 'Pronos para builders',
        subtitle: 'Crea keys para bots, dashboards, alertas y herramientas de trading que actuan como tu usuario de Pronos.',
        login: 'Inicia sesion para crear y administrar API keys.',
        loginCta: 'Unete',
        back: 'Volver a Perfil',
        createTitle: 'Crear API key',
        name: 'Nombre de la key',
        expires: 'Expira',
        readOnly: 'Leer mercados y datos de tu cuenta',
        trading: 'Solicitar acceso de trading',
        tradingNote: 'Las keys con trading pueden operar desde tu cuenta. Podemos pedir verificacion telefonica antes de aprobar uso de mayor riesgo.',
        create: 'Crear key',
        creating: 'Creando...',
        current: 'Keys activas',
        noKeys: 'Todavia no tienes API keys.',
        secretTitle: 'Copia este secreto ahora',
        secretBody: 'El secreto se muestra una sola vez. Guardalo en el entorno de tu servidor, nunca en codigo del navegador.',
        docs: 'Como usarla',
        auth: 'Autenticacion',
        authBody: 'Cada request debe incluir API key, timestamp y firma HMAC-SHA256. La firma usa timestamp + metodo + path con query + body crudo.',
        endpoints: 'Endpoints',
        phone: 'Verificacion telefonica',
        phoneBody: 'Por ahora, la confirmacion telefonica vive en el flujo manual de aprobacion. Cuando tu telefono este confirmado, crea la key aqui y dile al equipo que quieres construir.',
        phoneRequiredTitle: 'Verificación telefónica solicitada',
        phoneRequiredBody: 'El equipo necesita tu teléfono antes de aprobar uso de mayor riesgo en tu cuenta o API.',
        blockedTitle: 'Acceso API bloqueado',
        blockedBody: 'La creación de API keys y los requests firmados están bloqueados para esta cuenta. Las keys existentes pueden haber sido revocadas.',
      }), [lang]);

  const apiBlocked = !!(access?.apiBlockedAt || user?.apiBlockedAt);
  const phoneRequired = !!(access?.phoneRequired || user?.phoneRequired);

  async function loadKeys() {
    if (!authenticated) return;
    setLoadingKeys(true);
    setErr(null);
    try {
      const result = await fetchApiKeys();
      setKeys(Array.isArray(result.keys) ? result.keys : []);
      setAccess(result.access || null);
    } catch (error) {
      setErr(publicErrorMessage(error, lang, 'default'));
      setAccess(null);
    } finally {
      setLoadingKeys(false);
    }
  }

  useEffect(() => {
    if (!loading && !authenticated) onOpenLogin?.();
  }, [loading, authenticated, onOpenLogin]);

  useEffect(() => {
    if (!loading && authenticated) loadKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, authenticated]);

  async function handleCreate(event) {
    event.preventDefault();
    if (busy) return;
    if (apiBlocked) {
      setErr(copy.blockedBody);
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    setCreated(null);
    try {
      const result = await createApiKey({
        name: name.trim() || 'Pronos API',
        permissions: tradeAccess ? ['READ', 'TRADE'] : ['READ'],
        expiresAt: expiryToIso(expiry),
      });
      setCreated(result);
      setMsg(lang === 'en' ? 'API key created.' : 'API key creada.');
      setName('Pronos API');
      setTradeAccess(false);
      await loadKeys();
    } catch (error) {
      setErr(publicErrorMessage(error, lang, 'default'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id) {
    if (!id || busy) return;
    const ok = window.confirm(lang === 'en'
      ? 'Revoke this API key? Requests signed with it will stop working.'
      : 'Revocar esta API key? Los requests firmados con ella dejaran de funcionar.');
    if (!ok) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await revokeApiKey(id);
      setMsg(lang === 'en' ? 'API key revoked.' : 'API key revocada.');
      await loadKeys();
    } catch (error) {
      setErr(publicErrorMessage(error, lang, 'default'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <p style={mutedMonoStyle}>Cargando...</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main style={{ ...pageStyle, maxWidth: 720, textAlign: 'center' }}>
        <p style={kickerStyle}>{copy.kicker}</p>
        <h1 style={titleStyle}>{copy.title}</h1>
        <p style={bodyStyle}>{copy.login}</p>
        <button type="button" className="btn-primary" onClick={onOpenLogin} style={{ padding: '12px 24px' }}>
          {copy.loginCta}
        </button>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <p style={kickerStyle}>{copy.kicker}</p>
          <h1 style={titleStyle}>{copy.title}</h1>
          <p style={bodyStyle}>{copy.subtitle}</p>
          {user?.username && (
            <p style={{ ...mutedMonoStyle, marginTop: 12 }}>@{user.username}</p>
          )}
        </div>
        <Link to="/earn" style={{ ...smallButtonStyle, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {copy.back}
        </Link>
      </div>

      {(err || msg) && (
        <div style={{
          ...noticeStyle,
          color: err ? 'var(--danger)' : 'var(--green)',
          borderColor: err ? 'rgba(239,68,68,0.4)' : 'rgba(0,232,122,0.35)',
          background: err ? 'rgba(239,68,68,0.08)' : 'rgba(0,232,122,0.08)',
        }}>
          {err || msg}
        </div>
      )}

      {apiBlocked && (
        <div style={{
          ...noticeStyle,
          color: 'var(--danger)',
          borderColor: 'rgba(239,68,68,0.4)',
          background: 'rgba(239,68,68,0.08)',
        }}>
          <strong style={{ display: 'block', marginBottom: 4 }}>{copy.blockedTitle}</strong>
          {copy.blockedBody}
        </div>
      )}

      {!apiBlocked && phoneRequired && (
        <div style={{
          ...noticeStyle,
          color: 'var(--orange)',
          borderColor: 'rgba(255,80,0,0.35)',
          background: 'rgba(255,80,0,0.08)',
        }}>
          <strong style={{ display: 'block', marginBottom: 4 }}>{copy.phoneRequiredTitle}</strong>
          {copy.phoneRequiredBody}
        </div>
      )}

      <section style={twoColumnStyle}>
        <form onSubmit={handleCreate} style={panelStyle}>
          <div style={sectionTitleStyle}>{copy.createTitle}</div>
          <label style={labelStyle}>
            <span>{copy.name}</span>
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={80}
              disabled={apiBlocked}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>{copy.expires}</span>
            <select value={expiry} onChange={event => setExpiry(event.target.value)} disabled={apiBlocked} style={inputStyle}>
              <option value="none">{lang === 'en' ? 'Never' : 'Nunca'}</option>
              <option value="30d">30 dias</option>
              <option value="90d">90 dias</option>
            </select>
          </label>
          <div style={{ display: 'grid', gap: 10, marginTop: 4 }}>
            <label style={checkRowStyle}>
              <input type="checkbox" checked readOnly />
              <span>{copy.readOnly}</span>
            </label>
            <label style={checkRowStyle}>
              <input
                type="checkbox"
                checked={tradeAccess}
                onChange={event => setTradeAccess(event.target.checked)}
                disabled={apiBlocked}
              />
              <span>{copy.trading}</span>
            </label>
          </div>
          <p style={{ ...bodyStyle, fontSize: 12, marginTop: 12 }}>{copy.tradingNote}</p>
          <button type="submit" className="btn-primary" disabled={busy || apiBlocked} style={primaryButtonStyle}>
            {busy ? copy.creating : copy.create}
          </button>
        </form>

        <section style={panelStyle}>
          <div style={sectionTitleStyle}>{copy.phone}</div>
          <p style={bodyStyle}>{copy.phoneBody}</p>
          <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
            {[
              lang === 'en' ? 'Confirm your Pronos account and phone number.' : 'Confirma tu cuenta de Pronos y tu telefono.',
              lang === 'en' ? 'Create a READ key first and keep the secret server-side.' : 'Crea primero una key READ y guarda el secreto del lado servidor.',
              lang === 'en' ? 'Ask the team to review trading usage before automating orders.' : 'Pide revision del equipo antes de automatizar ordenes.',
            ].map((step, index) => (
              <div key={step} style={stepRowStyle}>
                <strong>{index + 1}</strong>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </section>
      </section>

      {created?.apiKey && created?.apiSecret && (
        <section style={{ ...panelStyle, marginTop: 18, borderColor: 'rgba(0,232,122,0.35)' }}>
          <div style={sectionTitleStyle}>{copy.secretTitle}</div>
          <p style={bodyStyle}>{copy.secretBody}</p>
          <div style={secretGridStyle}>
            <div style={secretBoxStyle}>
              <span>API KEY</span>
              <code>{created.apiKey}</code>
              <CopyButton value={created.apiKey} copiedId={copiedId} setCopiedId={setCopiedId} id="api-key">
                Copiar key
              </CopyButton>
            </div>
            <div style={secretBoxStyle}>
              <span>API SECRET</span>
              <code>{created.apiSecret}</code>
              <CopyButton value={created.apiSecret} copiedId={copiedId} setCopiedId={setCopiedId} id="api-secret">
                Copiar secret
              </CopyButton>
            </div>
          </div>
        </section>
      )}

      <section style={{ ...panelStyle, marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <div style={sectionTitleStyle}>{copy.current}</div>
          <button type="button" onClick={loadKeys} disabled={loadingKeys} style={smallButtonStyle}>
            {loadingKeys ? '...' : 'Actualizar'}
          </button>
        </div>
        {!keys?.length ? (
          <p style={mutedMonoStyle}>{loadingKeys ? 'Cargando...' : copy.noKeys}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={tableStyle}>
              <div style={tableHeaderStyle}>
                <span>Key</span>
                <span>Permisos</span>
                <span>Creada</span>
                <span>Ultimo uso</span>
                <span>Expira</span>
                <span />
              </div>
              {keys.map(key => {
                const revoked = !!key.revokedAt;
                return (
                  <div key={key.id} style={tableRowStyle}>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {key.name || 'Pronos API'}
                      </strong>
                      <span style={{ color: 'var(--text-muted)' }}>{key.keyPrefix}...</span>
                      {revoked && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>revocada</span>}
                    </span>
                    <span>{permissionLabel(key.permissions)}</span>
                    <span>{fmtDate(key.createdAt, lang)}</span>
                    <span>{fmtDate(key.lastUsedAt, lang)}</span>
                    <span>{fmtDate(key.expiresAt, lang)}</span>
                    <button
                      type="button"
                      disabled={busy || revoked}
                      onClick={() => handleRevoke(key.id)}
                      style={{ ...smallButtonStyle, opacity: revoked ? 0.45 : 1 }}
                    >
                      Revocar
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section style={{ ...panelStyle, marginTop: 18 }}>
        <div style={sectionTitleStyle}>{copy.docs}</div>
        <div style={docsGridStyle}>
          <div>
            <h3 style={docsHeadingStyle}>{copy.auth}</h3>
            <p style={bodyStyle}>{copy.authBody}</p>
            <pre style={codeStyle}>{codeSample()}</pre>
          </div>
          <div>
            <h3 style={docsHeadingStyle}>{copy.endpoints}</h3>
            <ul style={endpointListStyle}>
              {[
                'GET /api/v1/markets',
                'GET /api/v1/market?id=123',
                'GET /api/v1/me',
                'GET /api/v1/balance',
                'GET /api/v1/positions',
                'GET /api/v1/trades',
                'POST /api/v1/trades',
              ].map(endpoint => (
                <li key={endpoint}>{endpoint}</li>
              ))}
            </ul>
            <p style={{ ...bodyStyle, marginTop: 12 }}>
              {lang === 'en'
                ? 'Use Idempotency-Key on POST /api/v1/trades so retries do not duplicate an order.'
                : 'Usa Idempotency-Key en POST /api/v1/trades para que un retry no duplique una orden.'}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

const pageStyle = {
  maxWidth: 1160,
  margin: '0 auto',
  padding: 'clamp(32px, 6vw, 72px) clamp(16px, 4vw, 32px)',
};

const kickerStyle = {
  margin: '0 0 10px',
  color: 'var(--orange)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  fontWeight: 900,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
};

const titleStyle = {
  margin: 0,
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(42px, 7vw, 78px)',
  lineHeight: 0.95,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const bodyStyle = {
  margin: 0,
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-body)',
  fontSize: 15,
  lineHeight: 1.6,
  maxWidth: 760,
};

const mutedMonoStyle = {
  margin: 0,
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  lineHeight: 1.6,
};

const twoColumnStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 18,
};

const panelStyle = {
  background: 'var(--surface1)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '22px',
};

const sectionTitleStyle = {
  margin: '0 0 14px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  fontWeight: 900,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const labelStyle = {
  display: 'grid',
  gap: 8,
  marginBottom: 14,
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const inputStyle = {
  minHeight: 44,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface2)',
  color: 'var(--text-primary)',
  padding: '0 12px',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
};

const checkRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
};

const primaryButtonStyle = {
  width: '100%',
  minHeight: 44,
  marginTop: 18,
  padding: '12px 18px',
  borderRadius: 8,
};

const smallButtonStyle = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface2)',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '9px 12px',
  cursor: 'pointer',
};

const noticeStyle = {
  marginBottom: 18,
  padding: '12px 14px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
};

const stepRowStyle = {
  display: 'grid',
  gridTemplateColumns: '28px minmax(0, 1fr)',
  gap: 10,
  alignItems: 'start',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  lineHeight: 1.5,
};

const secretGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 12,
  marginTop: 16,
};

const secretBoxStyle = {
  display: 'grid',
  gap: 9,
  minWidth: 0,
  padding: 14,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface2)',
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
};

const tableStyle = {
  display: 'grid',
  gap: 0,
  minWidth: 920,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
};

const tableHeaderStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 1.4fr) 120px 130px 130px 130px 96px',
  gap: 12,
  padding: '0 0 9px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-muted)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const tableRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 1.4fr) 120px 130px 130px 130px 96px',
  gap: 12,
  alignItems: 'center',
  padding: '12px 0',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-secondary)',
};

const docsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 20,
};

const docsHeadingStyle = {
  margin: '0 0 8px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-body)',
  fontSize: 18,
};

const codeStyle = {
  margin: '14px 0 0',
  padding: 14,
  overflowX: 'auto',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: '#050505',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  lineHeight: 1.55,
};

const endpointListStyle = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  lineHeight: 1.9,
};
