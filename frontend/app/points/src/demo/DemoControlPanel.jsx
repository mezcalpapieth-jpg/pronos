/**
 * Fabian's control panel.
 *
 * Written for someone opening the app for the first time: Spanish labels,
 * one obvious control per thing, and a Reset that puts everything back the
 * way it started so a bad take costs nothing.
 *
 * Ctrl/Cmd + Shift + D hides the panel *and* its launcher button, so nothing
 * belonging to this file can end up in a frame.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  applyProbabilities,
  exportDemoState,
  getDemoState,
  importDemoState,
  renameDemoUser,
  resetDemoState,
  subscribeDemoState,
  updateDemoSettings,
  updateDemoState,
} from './demoStore.js';
import { reservesForProbabilities, pricesFromReserves } from './demoSeed.js';
import { emitPointsRefresh } from '../lib/pointsLiveRefresh.js';

const ORANGE = '#FF5500';
const PANEL_BG = '#101013';
const BORDER = '1px solid rgba(255,255,255,0.10)';

const CATEGORIES = ['deportes', 'mexico', 'politica', 'finanzas', 'crypto', 'musica', 'world-cup', 'general'];

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </label>
  );
}

const inputStyle = {
  width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.05)',
  border: BORDER, borderRadius: 8, color: '#fff', fontSize: 13,
  fontFamily: "'DM Sans', sans-serif", outline: 'none', boxSizing: 'border-box',
};

function Button({ children, onClick, tone = 'default', style }) {
  const bg = tone === 'primary' ? ORANGE : tone === 'danger' ? '#7f1d1d' : 'rgba(255,255,255,0.08)';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 12px', background: bg, color: '#fff', border: 'none',
        borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        fontFamily: "'DM Sans', sans-serif", ...style,
      }}
    >
      {children}
    </button>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: BORDER }}>
      <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: ORANGE, marginBottom: 10, fontWeight: 700 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

const BLANK_MARKET = {
  question: '',
  category: 'deportes',
  outcomes: 'Sí, No',
  probability: 60,
  volume: 1500000,
  endsInDays: 30,
  featured: true,
};

export default function DemoControlPanel() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [, forceRender] = useState(0);
  const [draft, setDraft] = useState(BLANK_MARKET);
  const [editingId, setEditingId] = useState(null);
  const [notice, setNotice] = useState('');

  const state = getDemoState();

  // Held locally and committed on blur/Enter — renaming on every keystroke
  // would walk the account through empty and half-typed names, and each one
  // would drag the leaderboard row along with it.
  const [nameDraft, setNameDraft] = useState(state.user.username);

  useEffect(() => subscribeDemoState(() => forceRender(n => n + 1)), []);

  // Resync when the store changes the name out from under the input — Reset
  // and Cargar archivo both do. Typing can't trigger this, since the store
  // only learns the new name on blur.
  useEffect(() => { setNameDraft(state.user.username); }, [state.user.username]);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setHidden(h => !h);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const editing = useMemo(
    () => (editingId ? state.markets.find(m => m.id === editingId) : null),
    [editingId, state.markets],
  );

  function flash(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2200);
  }

  function commitName() {
    const result = renameDemoUser(nameDraft);
    if (result.ok) {
      if (nameDraft.trim() !== state.user.username) flash('Nombre actualizado.');
      return;
    }
    flash(result.error);
    setNameDraft(state.user.username);
  }

  function setMarketVolume(market, total) {
    updateDemoState(s => {
      const target = s.markets.find(m => m.id === market.id);
      // The card reads volume + tradeVolume while the detail page reads
      // tradeVolume alone. Writing both keeps the two screens consistent.
      const seed = Math.round(total * 0.35);
      target.volume = seed;
      target.seedLiquidity = seed;
      target.tradeVolume = Math.max(0, total - seed);
    });
    emitPointsRefresh();
  }

  function setMarketProbability(market, percent) {
    updateDemoState(s => {
      const target = s.markets.find(m => m.id === market.id);
      const first = Math.max(2, Math.min(98, percent)) / 100;
      const rest = target.prices.slice(1);
      const restSum = rest.reduce((sum, p) => sum + p, 0) || 1;
      const next = [first, ...rest.map(p => (1 - first) * (p / restSum))];
      applyProbabilities(target, next);
      target.anchorProbs = [...target.prices];
    });
    emitPointsRefresh();
  }

  function createOrUpdateMarket() {
    const outcomes = draft.outcomes.split(',').map(s => s.trim()).filter(Boolean);
    if (!draft.question.trim()) return flash('Escribe una pregunta.');
    if (outcomes.length < 2) return flash('Necesitas al menos 2 opciones.');

    const first = Math.max(2, Math.min(98, Number(draft.probability) || 50)) / 100;
    const remainder = (1 - first) / Math.max(1, outcomes.length - 1);
    const probs = [first, ...Array.from({ length: outcomes.length - 1 }, () => remainder)];
    const total = Math.max(0, Number(draft.volume) || 0);
    const seed = Math.round(total * 0.35);
    const depth = Math.max(500, Math.round(total / 900));

    updateDemoState(s => {
      if (editingId) {
        const target = s.markets.find(m => m.id === editingId);
        target.question = draft.question.trim();
        target.category = draft.category;
        target.categoryTags = [draft.category];
        target.outcomes = outcomes;
        target.reserves = reservesForProbabilities(probs, depth);
        target.prices = pricesFromReserves(target.reserves);
        target.anchorProbs = [...target.prices];
        target.volume = seed;
        target.seedLiquidity = seed;
        target.tradeVolume = Math.max(0, total - seed);
        target.featured = !!draft.featured;
        target.endTime = new Date(Date.now() + Number(draft.endsInDays) * 86400000).toISOString();
        return;
      }

      const reserves = reservesForProbabilities(probs, depth);
      const nextId = Math.max(900000, ...s.markets.map(m => m.id)) + 1;
      s.markets.unshift({
        ...s.markets[0],
        id: nextId,
        question: draft.question.trim(),
        category: draft.category,
        categoryTags: [draft.category],
        outcomes,
        reserves,
        prices: pricesFromReserves(reserves),
        anchorProbs: pricesFromReserves(reserves),
        seedLiquidity: seed,
        volume: seed,
        tradeVolume: Math.max(0, total - seed),
        featured: !!draft.featured,
        trending: true,
        status: 'active',
        outcome: null,
        resolvedAt: null,
        sport: null,
        league: null,
        endTime: new Date(Date.now() + Number(draft.endsInDays) * 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      });
      delete s.history[nextId];
    });

    flash(editingId ? 'Mercado actualizado.' : 'Mercado creado. Recarga para verlo en la portada.');
    setEditingId(null);
    setDraft(BLANK_MARKET);
    emitPointsRefresh();
  }

  function deleteMarket(id) {
    updateDemoState(s => {
      s.markets = s.markets.filter(m => m.id !== id);
      s.positions = s.positions.filter(p => p.marketId !== id);
    });
    if (editingId === id) { setEditingId(null); setDraft(BLANK_MARKET); }
    flash('Mercado borrado.');
    emitPointsRefresh();
  }

  function startEditing(market) {
    setEditingId(market.id);
    setDraft({
      question: market.question,
      category: market.category,
      outcomes: market.outcomes.join(', '),
      probability: Math.round((market.prices[0] || 0.5) * 100),
      volume: Number(market.volume || 0) + Number(market.tradeVolume || 0),
      endsInDays: Math.max(1, Math.round((new Date(market.endTime) - Date.now()) / 86400000)),
      featured: !!market.featured,
    });
    setOpen(true);
  }

  function handleExport() {
    const blob = new Blob([exportDemoState()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pronos-demo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importDemoState(String(reader.result));
        flash('Escenario cargado. Recarga la página.');
      } catch (err) {
        flash(err.message || 'No se pudo leer el archivo.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  if (hidden) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Panel de grabación (Ctrl+Shift+D para esconder todo)"
        style={{
          position: 'fixed', right: 18, bottom: 18, zIndex: 100000,
          width: 48, height: 48, borderRadius: '50%', border: 'none',
          background: ORANGE, color: '#fff', fontSize: 20, cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
        }}
      >
        ●
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed', right: 18, bottom: 18, zIndex: 100000,
      width: 360, maxHeight: '82vh', overflowY: 'auto',
      background: PANEL_BG, border: BORDER, borderRadius: 14,
      boxShadow: '0 18px 50px rgba(0,0,0,0.6)', color: '#fff',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: BORDER, position: 'sticky', top: 0,
        background: PANEL_BG, zIndex: 1,
      }}>
        <strong style={{ fontSize: 13, letterSpacing: '0.04em' }}>PANEL DE GRABACIÓN</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button onClick={() => setHidden(true)}>Esconder</Button>
          <Button onClick={() => setOpen(false)}>✕</Button>
        </div>
      </div>

      {notice && (
        <div style={{ padding: '8px 16px', background: 'rgba(255,85,0,0.15)', fontSize: 12, color: '#ffd0b8' }}>
          {notice}
        </div>
      )}

      <Section title="Cuenta">
        <Field label="Tu nombre de usuario">
          <input
            style={inputStyle}
            value={nameDraft}
            placeholder="fabian"
            onChange={e => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </Field>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: '-4px 0 12px', lineHeight: 1.5 }}>
          Es el que sale en la tabla del torneo como “(tú)”.
        </p>
        <Field label="Balance en MXNP">
          <input
            type="number"
            style={inputStyle}
            value={Math.round(state.user.balance)}
            onChange={e => updateDemoState(s => { s.user.balance = Number(e.target.value) || 0; })}
          />
        </Field>
      </Section>

      <Section title="Gráficas en vivo">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={!!state.settings.driftEnabled}
            onChange={e => updateDemoSettings({ driftEnabled: e.target.checked })}
          />
          Mover los porcentajes solos
        </label>
        <Field label={`Velocidad: ${state.settings.driftSpeed}`}>
          <input
            type="range" min="1" max="10" style={{ width: '100%' }}
            value={state.settings.driftSpeed}
            onChange={e => updateDemoSettings({ driftSpeed: Number(e.target.value) })}
          />
        </Field>
      </Section>

      <Section title="Compras y ventas">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={!!state.settings.tradeFlowEnabled}
            onChange={e => updateDemoSettings({ tradeFlowEnabled: e.target.checked })}
          />
          Que entren órdenes solas
        </label>
        <Field label={`Cuántas: ${state.settings.tradeFlowIntensity}`}>
          <input
            type="range" min="1" max="10" style={{ width: '100%' }}
            value={state.settings.tradeFlowIntensity}
            onChange={e => updateDemoSettings({ tradeFlowIntensity: Number(e.target.value) })}
          />
        </Field>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: '-4px 0 0', lineHeight: 1.5 }}>
          Sube el volumen, mueve las barras de actividad y mantiene el
          “último movimiento” en ahora.
        </p>
      </Section>

      <Section title="Tabla del torneo">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={!!state.settings.leaderboardShuffleEnabled}
            onChange={e => updateDemoSettings({ leaderboardShuffleEnabled: e.target.checked })}
          />
          Mover posiciones solas
        </label>
        <Field label={`Cambia cada ${state.settings.leaderboardShuffleSeconds}s`}>
          <input
            type="range" min="1" max="15" style={{ width: '100%' }}
            value={state.settings.leaderboardShuffleSeconds}
            onChange={e => updateDemoSettings({ leaderboardShuffleSeconds: Number(e.target.value) })}
          />
        </Field>
      </Section>

      <Section title={editingId ? 'Editar mercado' : 'Crear mercado'}>
        <Field label="Pregunta">
          <input
            style={inputStyle}
            value={draft.question}
            placeholder="¿Ganará México el próximo partido?"
            onChange={e => setDraft({ ...draft, question: e.target.value })}
          />
        </Field>
        <Field label="Opciones (separadas por coma)">
          <input
            style={inputStyle}
            value={draft.outcomes}
            onChange={e => setDraft({ ...draft, outcomes: e.target.value })}
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Categoría">
            <select
              style={inputStyle}
              value={draft.category}
              onChange={e => setDraft({ ...draft, category: e.target.value })}
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="% primera opción">
            <input
              type="number" style={inputStyle}
              value={draft.probability}
              onChange={e => setDraft({ ...draft, probability: e.target.value })}
            />
          </Field>
          <Field label="Volumen MXNP">
            <input
              type="number" style={inputStyle}
              value={draft.volume}
              onChange={e => setDraft({ ...draft, volume: e.target.value })}
            />
          </Field>
          <Field label="Cierra en (días)">
            <input
              type="number" style={inputStyle}
              value={draft.endsInDays}
              onChange={e => setDraft({ ...draft, endsInDays: e.target.value })}
            />
          </Field>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '4px 0 12px' }}>
          <input
            type="checkbox"
            checked={draft.featured}
            onChange={e => setDraft({ ...draft, featured: e.target.checked })}
          />
          Destacado en la portada
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button tone="primary" onClick={createOrUpdateMarket} style={{ flex: 1 }}>
            {editingId ? 'Guardar cambios' : 'Crear mercado'}
          </Button>
          {editingId && (
            <Button onClick={() => { setEditingId(null); setDraft(BLANK_MARKET); }}>Cancelar</Button>
          )}
        </div>
      </Section>

      <Section title={`Mercados (${state.markets.length})`}>
        {state.markets.map(market => {
          const total = Number(market.volume || 0) + Number(market.tradeVolume || 0);
          return (
            <div key={market.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 12, marginBottom: 6, lineHeight: 1.35 }}>{market.question}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <input
                  type="number"
                  title="Volumen total en MXNP"
                  style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}
                  value={Math.round(total)}
                  onChange={e => setMarketVolume(market, Number(e.target.value) || 0)}
                />
                <input
                  type="number"
                  title="Porcentaje de la primera opción"
                  style={{ ...inputStyle, padding: '5px 8px', fontSize: 12, width: 78 }}
                  value={Math.round((market.prices[0] || 0) * 100)}
                  onChange={e => setMarketProbability(market, Number(e.target.value) || 0)}
                />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button onClick={() => startEditing(market)} style={{ fontSize: 11, padding: '5px 9px' }}>Editar</Button>
                <Button tone="danger" onClick={() => deleteMarket(market.id)} style={{ fontSize: 11, padding: '5px 9px' }}>Borrar</Button>
              </div>
            </div>
          );
        })}
      </Section>

      <Section title="Escenario">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={handleExport}>Guardar a archivo</Button>
          <label>
            <input type="file" accept="application/json" onChange={handleImport} style={{ display: 'none' }} />
            <span style={{
              display: 'inline-block', padding: '8px 12px', background: 'rgba(255,255,255,0.08)',
              borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              Cargar archivo
            </span>
          </label>
          <Button
            tone="danger"
            onClick={() => {
              if (window.confirm('¿Volver todo a como estaba al principio?')) {
                resetDemoState();
                flash('Listo. Recarga la página.');
              }
            }}
          >
            Reset
          </Button>
        </div>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 10, lineHeight: 1.5 }}>
          Ctrl+Shift+D esconde el panel y el botón para grabar limpio. La misma
          combinación lo trae de vuelta.
        </p>
      </Section>
    </div>
  );
}
