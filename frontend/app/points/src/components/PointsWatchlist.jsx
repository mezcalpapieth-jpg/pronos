import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Bookmark } from 'lucide-react';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useT } from '@app/lib/i18n.js';
import { fetchPointsWatchlist, setPointsWatchlistMarket } from '../lib/pointsApi.js';
import './points-browse.css';

const WatchlistContext = createContext(null);

export function PointsWatchlistProvider({ children, onOpenLogin }) {
  const { authenticated, user } = usePointsAuth();
  const account = authenticated ? user?.suborgId || user?.username || 'signed-in' : null;
  const [state, setState] = useState(null);
  const pending = useRef(new Set());
  const version = useRef(0);
  const t = useT();
  const markets = state?.account === account ? state?.markets || [] : [];
  const status = state?.account === account ? state.status : authenticated ? 'loading' : 'ready';
  const saveFailed = state?.account === account && state.saveFailed;

  const refresh = useCallback(async () => {
    if (!account || pending.current.size) return;
    const request = ++version.current;
    try {
      const result = await fetchPointsWatchlist();
      if (request === version.current) {
        setState(previous => ({ account, status: 'ready', markets: result.markets, saveFailed: previous?.account === account && previous.saveFailed }));
      }
    } catch {
      if (request === version.current) {
        setState(previous => previous?.account === account && previous.status === 'ready'
          ? previous
          : { account, status: 'error', markets: [] });
      }
    }
  }, [account]);

  useEffect(() => {
    pending.current = new Set();
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      ++version.current;
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const savedIds = new Set(markets.map(market => String(market.id)));

  async function toggle(market) {
    if (!authenticated) {
      onOpenLogin();
      return;
    }
    if (status !== 'ready') {
      refresh();
      return;
    }

    const id = String(market.id);
    const pendingForAccount = pending.current;
    if (pendingForAccount.has(id)) return;
    const previous = markets.find(row => String(row.id) === id);
    const previousIndex = markets.indexOf(previous);

    pendingForAccount.add(id);
    ++version.current;
    setState(current => ({
      ...current,
      saveFailed: false,
      markets: previous ? current.markets.filter(row => String(row.id) !== id) : [market, ...current.markets],
    }));
    try {
      await setPointsWatchlistMarket(market.id, !previous);
    } catch {
      if (pending.current !== pendingForAccount) return;
      setState(current => {
        if (current.account !== account) return current;
        const restored = current.markets.filter(row => String(row.id) !== id);
        if (previous) restored.splice(previousIndex, 0, previous);
        return { ...current, markets: restored, saveFailed: true };
      });
    } finally {
      pendingForAccount.delete(id);
    }
  }

  return (
    <WatchlistContext.Provider value={{ authenticated, markets, savedIds, status, toggle, refresh, onOpenLogin }}>
      {children}
      {saveFailed && <div className="points-watchlist-error" role="status">{t('points.watchlist.saveError')}</div>}
    </WatchlistContext.Provider>
  );
}

export function usePointsWatchlist() {
  return useContext(WatchlistContext);
}

export function PointsBookmark({ market, showLabel = false }) {
  const t = useT();
  const watchlist = usePointsWatchlist();
  if (!watchlist) return null;
  const saved = watchlist.savedIds.has(String(market.id));
  const label = t(saved ? 'points.watchlist.remove' : 'points.watchlist.add');

  return (
    <button
      type="button"
      className="points-bookmark"
      title={label}
      aria-label={label}
      aria-pressed={saved}
      disabled={watchlist.status === 'loading'}
      onClick={event => {
        event.stopPropagation();
        watchlist.toggle(market);
      }}
    >
      <Bookmark size={18} aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
      {showLabel && <span>{t(saved ? 'points.watchlist.saved' : 'points.watchlist.save')}</span>}
    </button>
  );
}
