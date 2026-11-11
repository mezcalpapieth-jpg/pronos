import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { createHip4Pilot } from '../lib/hip4Pilot.js';
import './Hip4PilotPage.css';

const BUSY_MESSAGE = {
  status: 'Consultando HyperCore testnet…',
  approvals: 'Verificando autorizaciones…',
  agent: 'Firmando la autorización de la clave de trading…',
  builder: 'Firmando la autorización de la comisión Pronos…',
  order: 'Enviando orden a HyperCore testnet…',
  withdrawal: 'Enviando retiro de USDC de prueba…',
};

function accepted(result) {
  const exchange = result?.status ? result : result?.response;
  if (exchange?.status !== 'ok') {
    throw new Error(typeof exchange?.response === 'string'
      ? exchange.response : 'HyperCore no confirmó la solicitud.');
  }
  return exchange.response?.data;
}

function orderNotice(result, requestedSize) {
  const order = accepted(result)?.statuses?.[0];
  if (order?.error) throw new Error(order.error);
  if (order?.filled) {
    const { totalSz, avgPx, oid } = order.filled;
    const fill = Number(totalSz) < Number(requestedSize) ? 'Ejecución parcial' : 'Ejecución completa';
    return {
      text: `${fill} de ${totalSz} participaciones a ${avgPx} USDC en promedio.`,
      reference: `Orden ${oid} · ID de cliente ${result.cloid}`,
    };
  }
  return { text: 'HyperCore aceptó la solicitud. Revisa el estado de la orden con su identificador.', reference: result.cloid };
}

function PilotAccount({ address, suborgId }) {
  const pilot = useMemo(() => createHip4Pilot({ address, suborgId }), [address, suborgId]);
  const [account, setAccount] = useState(null);
  const [busy, setBusy] = useState('status');
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [notice, setNotice] = useState(null);
  const [withdrawal, setWithdrawal] = useState(null);
  const withdrawalForm = useRef(null);
  const inFlight = useRef(false);

  const run = useCallback(async (stage, action) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(stage);
    setStatusError('');
    try {
      if (action) {
        setError('');
        setNotice(null);
        try {
          setNotice(await action());
        } catch (err) {
          setError(err?.message || 'La solicitud falló.');
        }
      }
      setAccount(await pilot.status());
    } catch (err) {
      setAccount(null);
      setStatusError(err?.message || 'Intenta nuevamente.');
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }, [pilot]);

  useEffect(() => { void run('status'); }, [run]);

  const canTrade = account?.activated && account.agentApproved && account.builderApproved;
  const hasUsdc = Number(account?.usdc) > 0;

  function enableTrading() {
    void run('approvals', async () => {
      await pilot.enableTrading({ onProgress: setBusy });
      return { text: 'Se enviaron las autorizaciones de trading.' };
    });
  }

  function submitOrder(event) {
    event.preventDefault();
    if (busy || !canTrade) return;
    const data = new FormData(event.currentTarget);
    const order = {
      coin: data.get('coin').trim(),
      side: data.get('side'),
      price: data.get('price'),
      size: data.get('size'),
    };
    void run('order', async () => orderNotice(await pilot.order(order), order.size));
  }

  function reviewWithdrawal(event) {
    event.preventDefault();
    if (busy || !account?.activated || !hasUsdc) return;
    const data = new FormData(event.currentTarget);
    const amount = data.get('amount');
    setError('');
    setNotice(null);
    if (Number(amount) > Number(account.usdc)) {
      setError('El monto supera el saldo disponible.');
      return;
    }
    setWithdrawal({ amount });
  }

  function confirmWithdrawal() {
    if (busy || !withdrawal || !account?.activated || Number(withdrawal.amount) > Number(account.usdc)) return;
    void run('withdrawal', async () => {
      const result = await pilot.withdraw(withdrawal);
      accepted(result);
      withdrawalForm.current?.reset();
      setWithdrawal(null);
      return {
        text: 'Retiro enviado. Confirma el abono en HyperEVM testnet.',
        reference: result.nonce == null ? '' : `Nonce ${result.nonce}`,
      };
    });
  }

  return (
    <>
      <div aria-live="polite" className="hip4-pilot-status">
        {busy && <p role="status">{BUSY_MESSAGE[busy]}</p>}
        {error && <p role="alert">{error}</p>}
        {statusError && <p role="alert">No se pudo actualizar el estado. {statusError}</p>}
        {notice && <p role="status">{notice.text} {notice.reference && <code>{notice.reference}</code>}</p>}
      </div>

      <div className="hip4-pilot-grid">
        <section className="hip4-pilot-card" aria-labelledby="hip4-funding">
          <h2 id="hip4-funding">Fondeo y saldo</h2>
          <p>Transfiere USDC de prueba desde otra cuenta fondeada en HyperCore testnet a tu dirección Pronos.</p>
          <code className="hip4-pilot-address">{address}</code>
          <p>Cuenta HyperCore {account ? (account.activated ? 'activa' : 'pendiente de activación') : 'sin verificar'}</p>
          <p>Saldo disponible <strong>{account ? `${account.usdc} USDC de prueba` : '—'}</strong></p>
          <button type="button" className="btn-ghost" disabled={Boolean(busy)} onClick={() => void run('status')}>Actualizar saldo y estado</button>
        </section>

        <section className="hip4-pilot-card" aria-labelledby="hip4-approvals">
          <h2 id="hip4-approvals">Autorizaciones</h2>
          <ol>
            <li>Clave de trading temporal <strong>{account ? (account.agentApproved ? 'autorizada' : 'pendiente') : 'sin verificar'}</strong></li>
            <li>Comisión Pronos de 25 pb (0.25%) <strong>{account ? (account.builderApproved ? 'autorizada' : 'pendiente') : 'sin verificar'}</strong></li>
          </ol>
          {account?.builderAddress && <p>Cuenta receptora de la comisión <code className="hip4-pilot-address">{account.builderAddress}</code></p>}
          <p>La clave de trading es temporal. Si recargas la página, tendrás que autorizar una nueva.</p>
          <button type="button" className="btn-primary" disabled={Boolean(busy) || !account?.activated || canTrade} onClick={enableTrading}>
            Autorizar trading
          </button>
        </section>

        <section className="hip4-pilot-card" aria-labelledby="hip4-order">
          <h2 id="hip4-order">Comprar o vender</h2>
          <p>Orden límite inmediata (IOC). HyperCore cancela la parte sin cruce. Comisión Pronos de 25 pb (0.25%) en las ejecuciones donde HyperCore la cobre.</p>
          <p>Hasta 250 participaciones por orden y 25 USDC de prueba por compra.</p>
          <p>Las compras requieren un mercado NFL de Flip con reglas 50/50 verificadas.</p>
          <p><strong>Cancelación definitiva sin resultado oficial.</strong> Si HyperCore liquida 50/50, cada participación paga 0.50 USDC de prueba antes de la comisión de liquidación. Los aplazamientos y resultados oficiales siguen las reglas de cada mercado.</p>
          <form onSubmit={submitOrder}>
            <fieldset disabled={Boolean(busy) || !canTrade} aria-label="Datos de la orden">
              <label>ID del activo en testnet <input name="coin" pattern="#[1-9][0-9]{0,7}[01]" required /></label>
              <label>Operación <select name="side"><option value="buy">Comprar</option><option value="sell">Vender</option></select></label>
              <label>Precio límite (USDC) <input name="price" type="number" min="0.00001" max="0.99999" step="0.00001" required /></label>
              <label>Participaciones <input name="size" type="number" min="1" max="250" step="1" required /></label>
              <button type="submit" className="btn-primary">Enviar orden</button>
            </fieldset>
          </form>
        </section>

        <section className="hip4-pilot-card" aria-labelledby="hip4-withdrawal">
          <h2 id="hip4-withdrawal">Retirar a HyperEVM testnet</h2>
          <p>Envía USDC de prueba de HyperCore testnet a tu misma dirección Pronos en HyperEVM testnet.</p>
          <code className="hip4-pilot-address">{address}</code>
          <form ref={withdrawalForm} onSubmit={reviewWithdrawal} hidden={Boolean(withdrawal)}>
            <fieldset disabled={Boolean(busy) || !account?.activated || !hasUsdc} aria-label="Datos del retiro">
              <label>Monto (USDC de prueba) <input name="amount" type="number" min="0.000001" step="0.000001" required /></label>
              <button type="submit" className="btn-ghost">Revisar retiro</button>
            </fieldset>
          </form>
          {withdrawal && (
            <div className="hip4-pilot-confirm" aria-label="Confirmación de retiro" role="group">
              <p>Confirma el retiro de <strong>{withdrawal.amount} USDC de prueba</strong> a la dirección de arriba en HyperEVM testnet.</p>
              <div>
                <button type="button" className="btn-ghost" disabled={Boolean(busy)} onClick={() => setWithdrawal(null)}>Volver</button>
                <button type="button" className="btn-primary" disabled={Boolean(busy) || !account?.activated || Number(withdrawal.amount) > Number(account.usdc)} onClick={confirmWithdrawal}>Confirmar retiro</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export default function Hip4PilotPage({ onOpenLogin }) {
  const { authenticated, loading, user } = usePointsAuth();
  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <main className="hip4-pilot">
        <header>
          <p className="hip4-pilot-eyebrow">HyperCore testnet · USDC de prueba</p>
          <h1>Piloto HIP-4</h1>
        </header>
        {loading ? <p role="status">Cargando tu cuenta Pronos…</p> : authenticated ? (
          user?.walletAddress && user?.suborgId ? (
            <PilotAccount key={`${user.walletAddress}:${user.suborgId}`} address={user.walletAddress} suborgId={user.suborgId} />
          ) : <p role="alert">Tu cuenta Pronos aún no tiene una cartera disponible para el piloto.</p>
        ) : <button type="button" className="btn-primary" onClick={onOpenLogin}>Iniciar sesión en Pronos</button>}
      </main>
      <Footer />
    </>
  );
}
