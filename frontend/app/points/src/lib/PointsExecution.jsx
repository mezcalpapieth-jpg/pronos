import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { pointsExecution, publicErrorMessage } from './pointsApi.js';
import { onPointsRefresh } from './pointsLiveRefresh.js';

const ExecutionContext = createContext({ mode: 'points', enabled: false });
export const usePointsExecution = () => useContext(ExecutionContext);

export function PointsExecutionProvider({ children }) {
  const { user, authenticated } = usePointsAuth();
  const [state, setState] = useState({ loading: true, enabled: false, mode: 'points', error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let canceled = false;
    pointsExecution.config().then(config => {
      if (!canceled) setState({ ...config, loading: false, mode: pointsExecution.getMode(), error: null });
    }).catch(error => { if (!canceled) setState(prev => ({ ...prev, loading: false, error })); });
    return () => { canceled = true; };
  }, [attempt]);
  if (state.loading) return <p role="status" style={{ padding: 32 }}>Cargando…</p>;
  if (state.error) return <div role="alert" style={{ padding: 32 }}>
    <p>No pudimos cargar el modo de operación.</p>
    <button onClick={() => { setState(prev => ({ ...prev, loading: true, error: null })); setAttempt(n => n + 1); }}>Reintentar</button>
  </div>;
  const setMode = async next => {
    await pointsExecution.setMode(next);
    setState(prev => ({ ...prev, mode: next }));
  };
  return <ExecutionContext.Provider value={{ ...state, setMode }}>
    <React.Fragment key={`${state.mode}:${authenticated ? user?.username || '' : ''}`}>{children}</React.Fragment>
  </ExecutionContext.Provider>;
}

// Auth's balance remains the Points balance for both apps. Read the token only
// when the current view explicitly needs it; no private data is cached globally.
export function useExecutionBalance(requestedMode) {
  const execution = usePointsExecution();
  const mode = requestedMode || execution.mode;
  const { user, authenticated } = usePointsAuth();
  const [state, setState] = useState({ owner: null, balance: null, loading: true, error: null });
  const owner = user?.walletAddress || user?.username || null;
  useEffect(() => {
    if (mode !== 'onchain' || !authenticated) return undefined;
    let canceled = false;
    let sequence = 0;
    async function load() {
      const current = ++sequence;
      try {
        const result = await pointsExecution.balance();
        if (!canceled && current === sequence) setState({ owner, balance: Number(result.balance), loading: false, error: null });
      } catch (error) {
        if (!canceled && current === sequence) setState({ owner, balance: null, loading: false, error: publicErrorMessage(error) });
      }
    }
    setState({ owner, balance: null, loading: true, error: null });
    load();
    const remove = onPointsRefresh(load);
    const interval = window.setInterval(load, 25000);
    return () => { canceled = true; remove(); window.clearInterval(interval); };
  }, [mode, authenticated, owner]);
  if (mode !== 'onchain') return { balance: Number(user?.balance || 0), loading: false, error: null };
  if (!authenticated) return { balance: null, loading: false, error: null };
  if (state.owner !== owner) return { balance: null, loading: true, error: null };
  return state;
}
