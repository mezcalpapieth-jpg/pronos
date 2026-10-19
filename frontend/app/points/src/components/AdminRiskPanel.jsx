import React, { useEffect, useRef, useState } from 'react';
import { adminListRisk, adminUpdateRiskReview } from '../lib/pointsApi.js';

// ─── Risk review ────────────────────────────────────────────────────────────
export default function RiskPanel({ profileUsername = null }) {
  const focusedUsername = String(profileUsername || '').trim();
  const requestRef = useRef(0);
  const [data, setData] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameFilter, setUsernameFilter] = useState('');
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [working, setWorking] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [expandedLoopUser, setExpandedLoopUser] = useState(profileUsername);
  const [expandedSignalUser, setExpandedSignalUser] = useState(profileUsername);

  async function load() {
    const request = ++requestRef.current;
    setErr(null);
    try {
      const r = await adminListRisk({
        status: statusFilter,
        username: focusedUsername || usernameFilter || undefined,
      });
      if (request === requestRef.current) setData(r);
    } catch (e) {
      if (request !== requestRef.current) return;
      setData(null);
      setErr(`${e.code || e.message}${e.detail ? ' · ' + e.detail : ''}`);
    }
  }

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [statusFilter, usernameFilter, focusedUsername]);

  async function setReview(username, status) {
    if (status === 'ineligible') {
      const ok = window.confirm(
        `¿Marcar @${username} como no elegible para premios?\n\n` +
        'Esto NO quita puntos ni balance, pero lo deja señalado para no entregar recompensas.'
      );
      if (!ok) return;
    }
    setWorking(`${username}:${status}`);
    setErr(null);
    setMsg(null);
    try {
      await adminUpdateRiskReview({
        username,
        status,
        reason: reviewDrafts[username] || '',
      });
      setMsg(`@${username} marcado como ${riskStatusLabel(status)}.`);
      await load();
    } catch (e) {
      setErr(`${e.code || e.message}${e.detail ? ' · ' + e.detail : ''}`);
    } finally {
      setWorking(null);
    }
  }

  const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
  const loops = Array.isArray(data?.rapidLoops) ? data.rapidLoops : [];
  const linkedSignals = Array.isArray(data?.linkedSignals) ? data.linkedSignals : [];
  const sameMarketLinks = Array.isArray(data?.sameMarketLinks) ? data.sameMarketLinks : [];
  const flags = Array.isArray(data?.flags) ? data.flags : [];
  const reviewCount = accounts.filter(row => ['watch', 'phone_required', 'under_review', 'ineligible'].includes(row.reviewStatus)).length;

  return (
    <div>
      <section style={adminPanelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={adminPanelTitle}>{focusedUsername ? `Riesgo · admin · @${focusedUsername}` : 'Revisión de riesgo'}</div>
            <p style={{ ...adminEmptyStyle, margin: 0, lineHeight: 1.6 }}>
              Solo revisión: esta pantalla no mueve balances, no borra posiciones y no quita MXNP automáticamente.
            </p>
          </div>
          <button type="button" onClick={load} className="btn-ghost" style={{ padding: '8px 12px', fontSize: 11 }}>
            Actualizar
          </button>
        </div>

        {!focusedUsername && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 16 }}>
          <RiskStatCard label="Cuentas en revisión" value={reviewCount} tone="orange" />
          <RiskStatCard label="Loops rápidos" value={loops.length} tone="red" />
          <RiskStatCard label="Señales compartidas" value={linkedSignals.length} tone="green" />
        </div>

        <div style={{
          marginTop: 14,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 10,
        }}>
          <RiskHelpCard
            title="Cómo se arma el score"
            body="El score solo ordena la revisión. Suma estado manual, loops rápidos, señales compartidas, actividad reciente y patrones de entrada/salida."
            lines={[
              'Estado: limpia +0, watch +35, teléfono requerido +55, en revisión +70, no elegible +100.',
              'Loops rápidos: +30 por mercado donde compra y sale varias veces en pocas horas.',
              'Señales: +20 por IP, dispositivo o sesión compartida con otra cuenta.',
              'Trades 30d: hasta +30 por actividad; entrada/salida balanceada suma +10.',
            ]}
          />
          <RiskHelpCard
            title="Qué significa Teléfono requerido"
            body="Sí: significa que le pediríamos verificación telefónica antes de considerarlo elegible para premios. No quita MXNP, no borra posiciones y no bloquea comprar o vender por sí solo."
            lines={[
              'Úsalo cuando el patrón merece fricción, pero todavía no amerita marcarlo como no elegible.',
              'Watch es solo observación. En revisión es una pausa interna más seria. No elegible lo deja fuera de premios.',
            ]}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 18, alignItems: 'center' }}>
          {[
            ['all', 'Todas'],
            ['clear', 'Limpias'],
            ['watch', 'Watch'],
            ['phone_required', 'Teléfono'],
            ['under_review', 'Revisión'],
            ['ineligible', 'No elegible'],
          ].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setStatusFilter(id)} style={riskFilterButtonStyle(statusFilter === id)}>
              {label}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setUsernameFilter(usernameInput.trim().toLowerCase());
            }}
            style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto', minWidth: 260 }}
          >
            <input
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="@usuario"
              style={{ ...inputStyle, height: 38, fontFamily: 'var(--font-mono)' }}
            />
            <button type="submit" className="btn-ghost" style={{ padding: '9px 12px', fontSize: 11 }}>
              Buscar
            </button>
            {usernameFilter && (
              <button
                type="button"
                onClick={() => {
                  setUsernameInput('');
                  setUsernameFilter('');
                }}
                className="btn-ghost"
                style={{ padding: '9px 12px', fontSize: 11 }}
              >
                Limpiar
              </button>
            )}
          </form>
        </div>
        </>)}
      </section>

      {err && (
        <div style={{
          marginTop: 12,
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid rgba(239,68,68,0.35)',
          color: 'var(--red, #ef4444)',
          background: 'rgba(239,68,68,0.08)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}>
          {err}
        </div>
      )}
      {msg && (
        <div style={{
          marginTop: 12,
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid rgba(16,185,129,0.35)',
          color: 'var(--green)',
          background: 'rgba(16,185,129,0.08)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}>
          {msg}
        </div>
      )}

      <section style={adminPanelStyle}>
        <div style={adminPanelTitle}>Cuentas</div>
        {!data ? (
          <p style={adminEmptyStyle}>Cargando…</p>
        ) : accounts.length === 0 ? (
          <p style={adminEmptyStyle}>Sin cuentas para este filtro.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {accounts.map(row => {
              const rowLoops = loops.filter(loop => sameRiskUsername(loop.username, row.username));
              const rowSignals = Array.isArray(row.sharedSignals) && row.sharedSignals.length > 0
                ? row.sharedSignals
                : linkedSignals.filter(signal => asRiskUsernames(signal.usernames).some(username => sameRiskUsername(username, row.username)));
              const loopsOpen = expandedLoopUser === row.username;
              const signalsOpen = expandedSignalUser === row.username;

              return (
              <div key={row.username} style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 14,
                background: 'rgba(255,255,255,0.02)',
                display: 'grid',
                gap: 12,
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(140px, 1fr) minmax(120px, auto) minmax(120px, auto) minmax(120px, auto)',
                  gap: 12,
                  alignItems: 'center',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <a
                      href={`/points/u/${encodeURIComponent(row.username)}`}
                      style={{
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-body)',
                        fontSize: 17,
                        fontWeight: 800,
                        textDecoration: 'none',
                      }}
                    >
                      @{row.username}
                    </a>
                    <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10, marginTop: 4 }}>
                      Alta {adminDateTime(row.createdAt)} · Último trade {adminDateTime(row.lastTradeAt)}
                    </div>
                  </div>
                  <RiskNumber label="Score" value={adminNumber(row.riskScore)} color={riskScoreColor(row.riskScore)} />
                  <RiskNumber label="Balance" value={adminMxnp(row.balance)} color="var(--green)" />
                  <div style={riskBadgeStyle(row.reviewStatus)}>{riskStatusLabel(row.reviewStatus)}</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  <RiskMetric label="Teléfono" value={row.phoneNumber || 'Sin teléfono'} />
                  <RiskMetric label="Trades 30d" value={adminNumber(row.tradeCount)} />
                  <RiskMetric label="Mercados" value={adminNumber(row.marketCount)} />
                  <RiskMetric label="Compras" value={adminMxnp(row.buyVolume)} />
                  <RiskMetric label="Salidas" value={adminMxnp(row.exitVolume)} />
                  <RiskMetric
                    label="Loops"
                    value={`${adminNumber(row.loopCount)} mercados`}
                    onClick={row.loopCount > 0 ? () => setExpandedLoopUser(loopsOpen ? null : row.username) : undefined}
                    active={loopsOpen}
                  />
                  <RiskMetric
                    label="Señales"
                    value={`${adminNumber(row.sharedSignalCount)} compartidas`}
                    onClick={row.sharedSignalCount > 0 ? () => setExpandedSignalUser(signalsOpen ? null : row.username) : undefined}
                    active={signalsOpen}
                  />
                </div>

                <RiskScoreBreakdown row={row} />

                {loopsOpen && (
                  <RiskInlineEvidence
                    title={`Loops de @${row.username}`}
                    empty="No se cargaron detalles de loops para este usuario en la ventana actual."
                    rows={rowLoops}
                    renderRow={(loop) => <RiskLoopEvidenceRow key={`${loop.username}-${loop.marketId}`} row={loop} />}
                  />
                )}

                {signalsOpen && (
                  <RiskInlineEvidence
                    title={`Señales de @${row.username}`}
                    empty="No hay señales compartidas para este usuario."
                    rows={rowSignals}
                    renderRow={(signal) => (
                      <RiskSignalEvidenceRow
                        key={`${signal.signalType}-${signal.signalKey}-${row.username}`}
                        row={signal}
                        focusUsername={row.username}
                      />
                    )}
                  />
                )}

                {row.reviewReason && <p style={{ ...adminEmptyStyle, margin: 0, lineHeight: 1.5 }}>Nota: {row.reviewReason}</p>}

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 10, alignItems: 'center' }}>
                  <input
                    value={reviewDrafts[row.username] ?? row.reviewReason ?? ''}
                    onChange={(e) => setReviewDrafts(prev => ({ ...prev, [row.username]: e.target.value }))}
                    placeholder="Nota interna de revisión"
                    style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                  />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setReview(row.username, 'phone_required')}
                      disabled={working === `${row.username}:phone_required`}
                      title="Pide verificación telefónica y lo muestra en Perfil."
                      style={riskReviewButtonStyle('phone_required', row.reviewStatus === 'phone_required')}
                    >
                      {working === `${row.username}:phone_required` ? '...' : 'Pedir teléfono'}
                    </button>
                    {['clear', 'watch', 'under_review', 'ineligible'].map(status => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setReview(row.username, status)}
                        disabled={working === `${row.username}:${status}`}
                        style={riskReviewButtonStyle(status, row.reviewStatus === status)}
                      >
                        {working === `${row.username}:${status}` ? '...' : riskStatusLabel(status)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </section>

      <RiskEvidencePanel
        title="Loops rápidos"
        empty="Sin loops rápidos detectados."
        rows={loops}
        renderRow={(row) => <RiskLoopEvidenceRow key={`${row.username}-${row.marketId}`} row={row} />}
      />

      <RiskEvidencePanel
        title="Señales compartidas"
        empty="Sin IP/device/sesión compartida entre cuentas."
        rows={linkedSignals}
        renderRow={(row) => <RiskSignalEvidenceRow key={`${row.signalType}-${row.signalKey}`} row={row} />}
      />

      <RiskEvidencePanel
        title="Cruces en el mismo mercado"
        empty="Sin cuentas enlazadas operando el mismo mercado en ventana corta."
        rows={sameMarketLinks}
        renderRow={(row) => (
          <div key={`${row.marketId}-${row.signalType}-${row.usernameA}-${row.usernameB}`} style={riskEvidenceRowStyle}>
            <span style={riskEvidenceLinkStyle}>@{row.usernameA} / @{row.usernameB}</span>
            <a href={`/points/market/${row.marketId}`} style={riskEvidenceMainStyle}>{row.question || `Mercado #${row.marketId}`}</a>
            <span style={riskEvidenceMetaStyle}>{riskSignalLabel(row.signalType)} · {row.overlapCount} cruces</span>
            <span style={{ ...riskEvidenceMetaStyle, textAlign: 'right' }}>{adminDateTime(row.lastSeenAt)}</span>
          </div>
        )}
      />

      <RiskEvidencePanel
        title="Flags manuales"
        empty="Sin flags manuales abiertos."
        rows={flags}
        renderRow={(row) => (
          <div key={row.id} style={riskEvidenceRowStyle}>
            <a href={`/points/u/${encodeURIComponent(row.username)}`} style={riskEvidenceLinkStyle}>@{row.username}</a>
            <span style={riskEvidenceMainStyle}>{row.flagType}</span>
            <span style={riskEvidenceMetaStyle}>Severidad {row.severity}</span>
            <span style={{ ...riskEvidenceMetaStyle, textAlign: 'right' }}>{adminDateTime(row.createdAt)}</span>
          </div>
        )}
      />
    </div>
  );
}

function RiskNumber({ label, value, color }) {
  return (
    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
      {label}
      <div style={{ color, fontSize: 16, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function RiskStatCard({ label, value, tone = 'green' }) {
  const color = tone === 'red' ? 'var(--red, #ef4444)' : tone === 'orange' ? 'var(--orange)' : 'var(--green)';
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '13px 14px', background: 'rgba(255,255,255,0.025)', fontFamily: 'var(--font-mono)' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color, fontSize: 26, fontWeight: 900, marginTop: 4 }}>{adminNumber(value)}</div>
    </div>
  );
}

function RiskHelpCard({ title, body, lines = [] }) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '12px 14px',
      background: 'rgba(255,255,255,0.02)',
      fontFamily: 'var(--font-mono)',
      minWidth: 0,
    }}>
      <div style={{ color: 'var(--orange)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>
        {title}
      </div>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.55 }}>
        {body}
      </p>
      {lines.length > 0 && (
        <div style={{ display: 'grid', gap: 5, marginTop: 9 }}>
          {lines.map(line => (
            <div key={line} style={{ color: 'var(--text-muted)', fontSize: 10, lineHeight: 1.45 }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RiskMetric({ label, value, onClick, active = false }) {
  const interactive = typeof onClick === 'function';
  const style = {
    border: `1px solid ${active ? 'rgba(255,90,0,0.65)' : 'var(--border)'}`,
    borderRadius: 8,
    padding: '10px 11px',
    background: active ? 'rgba(255,90,0,0.08)' : 'rgba(255,255,255,0.02)',
    minWidth: 0,
    textAlign: 'left',
    fontFamily: 'var(--font-mono)',
    cursor: interactive ? 'pointer' : 'default',
  };
  const content = (
    <>
      <div style={{ color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    </>
  );

  if (interactive) {
    return (
      <button type="button" onClick={onClick} style={style}>
        {content}
      </button>
    );
  }

  return (
    <div style={style}>
      {content}
    </div>
  );
}

function RiskInlineEvidence({ title, empty, rows, renderRow }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return (
    <div style={{
      border: '1px dashed var(--border)',
      borderRadius: 8,
      padding: 10,
      background: 'rgba(255,255,255,0.012)',
      display: 'grid',
      gap: 8,
      overflowX: 'auto',
    }}>
      <div style={{ color: 'var(--orange)', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {title}
      </div>
      {safeRows.length === 0 ? (
        <p style={{ ...adminEmptyStyle, margin: 0 }}>{empty}</p>
      ) : (
        safeRows.map(renderRow)
      )}
    </div>
  );
}

function RiskLoopEvidenceRow({ row }) {
  const [open, setOpen] = useState(false);
  const trades = Array.isArray(row.trades) ? row.trades : [];
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: 10,
      background: 'rgba(255,255,255,0.02)',
      fontFamily: 'var(--font-mono)',
      display: 'grid',
      gap: 8,
      minWidth: 780,
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, 0.35fr) minmax(240px, 1fr) minmax(150px, auto) minmax(130px, auto)',
        gap: 10,
        alignItems: 'center',
      }}>
        <a href={`/points/u/${encodeURIComponent(row.username)}`} style={riskEvidenceLinkStyle}>@{row.username}</a>
        <a href={`/points/market/${row.marketId}`} style={riskEvidenceMainStyle}>{row.question || `Mercado #${row.marketId}`}</a>
        <span style={riskEvidenceMetaStyle}>{row.buyCount} compras · {row.sellCount} ventas · {formatAdminDuration(row.spanSeconds)}</span>
        <button
          type="button"
          onClick={() => setOpen(prev => !prev)}
          className="btn-ghost"
          style={{ padding: '6px 9px', fontSize: 10, justifySelf: 'end', whiteSpace: 'nowrap' }}
        >
          {open ? 'Ocultar' : 'Ver'} · {adminNumber(trades.length || row.tradeCount)} trades
        </button>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>
        {adminMxnp(row.buyCollateral)} comprado · {adminMxnp(row.sellCollateral)} vendido · {adminNumber(row.outcomesTouched)} resultados tocados
      </div>
      {open && <RiskTradeSequence trades={trades} />}
    </div>
  );
}

function RiskTradeSequence({ trades }) {
  const safeTrades = Array.isArray(trades) ? trades : [];
  if (safeTrades.length === 0) {
    return <p style={{ ...adminEmptyStyle, margin: 0 }}>Sin detalle de trades para este loop.</p>;
  }
  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      paddingTop: 8,
      display: 'grid',
      gap: 5,
    }}>
      {safeTrades.map((trade, index) => {
        const isSell = trade.side === 'sell';
        return (
          <div
            key={trade.id || index}
            style={{
              display: 'grid',
              gridTemplateColumns: '70px minmax(120px, 1fr) minmax(100px, auto) minmax(100px, auto) minmax(70px, auto) minmax(120px, auto)',
              gap: 10,
              alignItems: 'center',
              color: 'var(--text-muted)',
              fontSize: 10,
            }}
          >
            <span style={{ color: isSell ? 'var(--red, #ef4444)' : 'var(--green)', fontWeight: 900 }}>{riskTradeSideLabel(trade.side)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trade.outcomeLabel || `Resultado ${trade.outcomeIndex ?? '-'}`}</span>
            <span style={{ color: isSell ? 'var(--red, #ef4444)' : 'var(--green)' }}>{adminMxnp(trade.collateral)}</span>
            <span>{adminNumber(trade.shares, { maximumFractionDigits: 2 })} acc.</span>
            <span style={{ color: 'var(--text-secondary)' }}>{formatRiskPrice(trade.price)}</span>
            <span style={{ textAlign: 'right' }}>{adminDateTime(trade.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}

function RiskSignalEvidenceRow({ row, focusUsername = null }) {
  const usernames = asRiskUsernames(row.usernames);
  const directLinkedUsernames = asRiskUsernames(row.linkedUsernames);
  const linkedUsernames = focusUsername
    ? directLinkedUsernames.concat(
        usernames.filter(username => !sameRiskUsername(username, focusUsername) && !directLinkedUsernames.some(linked => sameRiskUsername(linked, username)))
      )
    : usernames;
  const displayUsernames = linkedUsernames.length > 0 ? linkedUsernames : usernames;
  const uniqueDisplayUsernames = Array.from(new Set(displayUsernames.map(username => username.toLowerCase()))).map(lower => (
    displayUsernames.find(username => username.toLowerCase() === lower) || lower
  ));
  const signalText = focusUsername
    ? `@${focusUsername} comparte señal con ${uniqueDisplayUsernames.map(username => `@${username}`).join(' · ')}`
    : uniqueDisplayUsernames.map(username => `@${username}`).join(' · ');
  return (
    <div style={riskEvidenceRowStyle}>
      <span style={riskEvidenceLinkStyle}>{riskSignalLabel(row.signalType)} · {row.signalKey}</span>
      <span style={riskEvidenceSignalMainStyle} title={signalText}>
        {signalText}
      </span>
      <span style={riskEvidenceMetaStyle}>{adminNumber(row.userCount)} cuentas · {adminNumber(row.eventCount)} eventos</span>
      <span style={{ ...riskEvidenceMetaStyle, textAlign: 'right' }}>{adminDateTime(row.lastSeenAt)}</span>
    </div>
  );
}

function RiskScoreBreakdown({ row }) {
  const pieces = riskScoreBreakdown(row);
  const total = pieces.reduce((sum, piece) => sum + piece.points, 0);
  return (
    <div style={{
      border: '1px dashed var(--border)',
      borderRadius: 8,
      padding: '9px 10px',
      background: 'rgba(255,255,255,0.015)',
      fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Desglose del score
        </span>
        <span style={{ color: riskScoreColor(total), fontSize: 11, fontWeight: 900 }}>
          {adminNumber(total)} calculado
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {pieces.map(piece => (
          <span
            key={piece.key}
            title={piece.help}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              border: '1px solid var(--border)',
              borderRadius: 999,
              padding: '5px 8px',
              background: piece.points > 0 ? 'rgba(255,90,0,0.08)' : 'rgba(255,255,255,0.02)',
              color: piece.points > 0 ? 'var(--orange)' : 'var(--text-muted)',
              fontSize: 10,
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
            }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>{piece.label}</strong>
            +{adminNumber(piece.points)}
          </span>
        ))}
      </div>
    </div>
  );
}

function RiskEvidencePanel({ title, empty, rows, renderRow }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return (
    <section style={adminPanelStyle}>
      <div style={adminPanelTitle}>{title}</div>
      {safeRows.length === 0 ? (
        <p style={adminEmptyStyle}>{empty}</p>
      ) : (
        <div style={{ display: 'grid', gap: 8, overflowX: 'auto' }}>{safeRows.map(renderRow)}</div>
      )}
    </section>
  );
}

function riskStatusLabel(status) {
  const labels = {
    clear: 'Limpia',
    watch: 'Watch',
    phone_required: 'Teléfono requerido',
    under_review: 'En revisión',
    ineligible: 'No elegible',
  };
  return labels[status] || status || 'Limpia';
}

function riskStatusPoints(status) {
  const points = {
    clear: 0,
    watch: 35,
    phone_required: 55,
    under_review: 70,
    ineligible: 100,
  };
  return points[status] || 0;
}

function riskScoreBreakdown(row = {}) {
  const tradeCount = Number(row.tradeCount || 0);
  const loopCount = Number(row.loopCount || 0);
  const sharedSignalCount = Number(row.sharedSignalCount || 0);
  const buyVolume = Number(row.buyVolume || 0);
  const exitVolume = Number(row.exitVolume || 0);
  const balancedExit =
    buyVolume > 0 &&
    exitVolume > 0 &&
    Math.abs(buyVolume - exitVolume) / Math.max(buyVolume, 1) < 0.15;

  return [
    {
      key: 'status',
      label: `Estado ${riskStatusLabel(row.reviewStatus)}`,
      points: riskStatusPoints(row.reviewStatus),
      help: 'Peso del estado manual que marcó admin.',
    },
    {
      key: 'loops',
      label: `${adminNumber(loopCount)} loops`,
      points: loopCount * 30,
      help: '+30 por mercado con compras y salidas rápidas.',
    },
    {
      key: 'signals',
      label: `${adminNumber(sharedSignalCount)} señales`,
      points: sharedSignalCount * 20,
      help: '+20 por IP, dispositivo o sesión compartida con otra cuenta.',
    },
    {
      key: 'trades',
      label: `${adminNumber(tradeCount)} trades`,
      points: Math.min(tradeCount, 30),
      help: 'Actividad reciente, limitado a +30.',
    },
    {
      key: 'flow',
      label: 'Entrada/salida',
      points: balancedExit ? 10 : 0,
      help: '+10 cuando compras y salidas quedan casi balanceadas.',
    },
  ];
}

function riskSignalLabel(type) {
  const labels = { ip: 'IP', device: 'Dispositivo', session: 'Sesión' };
  return labels[type] || type || 'Señal';
}

function sameRiskUsername(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function asRiskUsernames(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(username => String(username)) : [];
}

function riskTradeSideLabel(side) {
  if (side === 'buy') return 'COMPRÓ';
  if (side === 'sell') return 'VENDIÓ';
  return String(side || 'TRADE').toUpperCase();
}

function formatRiskPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const cents = n <= 1 ? n * 100 : n;
  return `${adminNumber(cents, { maximumFractionDigits: 0 })}c`;
}

function riskScoreColor(score) {
  const n = Number(score || 0);
  if (n >= 90) return 'var(--red, #ef4444)';
  if (n >= 45) return 'var(--orange)';
  return 'var(--green)';
}

function riskBadgeStyle(status) {
  const color = riskScoreColor(status === 'ineligible' ? 100 : status === 'under_review' ? 70 : status === 'phone_required' ? 55 : status === 'watch' ? 45 : 0);
  return {
    justifySelf: 'end',
    border: `1px solid ${color}`,
    borderRadius: 999,
    color,
    background: 'rgba(255,255,255,0.025)',
    padding: '7px 11px',
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };
}

function riskFilterButtonStyle(active) {
  return {
    border: `1px solid ${active ? 'var(--orange)' : 'var(--border)'}`,
    background: active ? 'rgba(255,90,0,0.12)' : 'transparent',
    color: active ? 'var(--orange)' : 'var(--text-muted)',
    borderRadius: 999,
    padding: '8px 13px',
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fontWeight: active ? 800 : 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  };
}

function riskReviewButtonStyle(status, active) {
  const color = riskScoreColor(status === 'ineligible' ? 100 : status === 'under_review' ? 70 : status === 'phone_required' ? 55 : status === 'watch' ? 45 : 0);
  return {
    border: `1px solid ${active ? color : 'var(--border)'}`,
    background: active ? 'rgba(255,255,255,0.04)' : 'transparent',
    color: active ? color : 'var(--text-muted)',
    borderRadius: 8,
    padding: '8px 9px',
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  };
}

const riskEvidenceRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(150px, 0.45fr) minmax(260px, 1fr) minmax(140px, auto) minmax(120px, auto)',
  gap: 12,
  alignItems: 'center',
  minWidth: 850,
  padding: '10px 0',
  borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
};

const riskEvidenceLinkStyle = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--orange)',
  textDecoration: 'none',
  fontWeight: 800,
};

const riskEvidenceMainStyle = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--text-primary)',
  textDecoration: 'none',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  fontWeight: 700,
};

const riskEvidenceSignalMainStyle = {
  ...riskEvidenceMainStyle,
  overflow: 'visible',
  textOverflow: 'clip',
  whiteSpace: 'normal',
  lineHeight: 1.45,
};

const riskEvidenceMetaStyle = {
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
};

function adminNumber(value, options = {}) {
  return Number(value || 0).toLocaleString('es-MX', options);
}

function adminMxnp(value) {
  return `${adminNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXNP`;
}

function adminDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAdminDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  if (total < 60) return `${Math.round(total)}s`;
  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours > 0) return `${hours}h ${remMinutes}m`;
  return `${minutes}m`;
}

const inputStyle = {
  width: '100%',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  color: 'var(--text-primary)',
  outline: 'none',
};

const adminPanelStyle = {
  marginTop: 20,
  background: 'var(--surface1)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 20,
};

const adminPanelTitle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.1em',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  marginBottom: 12,
};

const adminEmptyStyle = {
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
};
